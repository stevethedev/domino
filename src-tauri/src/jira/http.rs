//! Phase 2 backend: Jira Cloud REST API v3.
//!
//! - API token: Basic auth against the site's own base URL.
//! - OAuth 3LO: Bearer token against `https://api.atlassian.com/ex/jira/{cloudId}`; the cloudId is
//!   discovered via accessible-resources on first use and saved back into the config.
//! - Search pages through `POST /rest/api/3/search/jql` with `nextPageToken`, asking only for the
//!   fields Domino renders. 429/503 are retried honoring Retry-After.
//! - Error messages never include credentials or request headers.

use super::oauth::{cloud_id_for, truncate, OAuth};
use super::{and_filter, is_issue_key, JiraBackend, JiraResult};
use crate::config::{ConfigHandle, SiteAuth, SiteConfig};
use crate::secrets::SecretStore;
use async_trait::async_trait;
use base64::Engine;
use reqwest::{Method, StatusCode};
use serde_json::{json, Value};
use std::sync::Arc;
use std::time::Duration;

/// `customfield_10014` is the legacy "Epic Link" field, a fallback for epics on older company-managed projects.
pub const FIELDS: &[&str] =
    &["summary", "issuetype", "status", "assignee", "customfield_10016", "customfield_10014", "parent", "issuelinks"];
const PAGE_SIZE: usize = 100;
const MAX_RETRIES: u32 = 3;
const MAX_RETRY_WAIT: Duration = Duration::from_secs(30);

pub struct HttpBackend {
    http: reqwest::Client,
    secrets: Arc<dyn SecretStore>,
    oauth: Arc<OAuth>,
    config: Arc<ConfigHandle>,
    /// Base for retry backoff; shortened in tests.
    backoff: Duration,
}

struct Target {
    base: String,
    auth: String, // full Authorization header value
}

pub fn http_client() -> reqwest::Client {
    reqwest::Client::builder()
        .user_agent(concat!("Domino/", env!("CARGO_PKG_VERSION")))
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(60))
        .https_only(true)
        .build()
        .expect("HTTP client builds")
}

impl HttpBackend {
    pub fn new(http: reqwest::Client, secrets: Arc<dyn SecretStore>, oauth: Arc<OAuth>, config: Arc<ConfigHandle>) -> Self {
        Self { http, secrets, oauth, config, backoff: Duration::from_secs(1) }
    }

    #[cfg(test)]
    fn with_backoff(mut self, d: Duration) -> Self {
        self.backoff = d;
        self
    }

    async fn target(&self, site: &SiteConfig) -> JiraResult<Target> {
        match &site.auth {
            SiteAuth::ApiToken { email, secret_ref } => {
                let token = self.secrets.get(secret_ref)?;
                let basic = base64::engine::general_purpose::STANDARD.encode(format!("{email}:{token}"));
                Ok(Target { base: site.base_url.trim_end_matches('/').into(), auth: format!("Basic {basic}") })
            }
            SiteAuth::OAuth3lo => {
                let token = self.oauth.access_token().await?;
                let cloud_id = match self.config.site(&site.id).and_then(|s| s.cloud_id).or_else(|| site.cloud_id.clone()) {
                    Some(id) => id,
                    None => self.discover_cloud_id(site).await?,
                };
                Ok(Target { base: format!("{}/ex/jira/{cloud_id}", self.oauth.api_base()), auth: format!("Bearer {token}") })
            }
        }
    }

    async fn discover_cloud_id(&self, site: &SiteConfig) -> JiraResult<String> {
        let resources = self.oauth.accessible_resources().await?;
        let id = cloud_id_for(&site.base_url, &resources).ok_or_else(|| {
            format!("Your Atlassian account has no access to {} (or the OAuth app lacks Jira scopes)", site.base_url)
        })?;
        self.config.set_cloud_id(&site.base_url, &id)?;
        log::info!("discovered cloudId for {}", site.id);
        Ok(id)
    }

    async fn send(&self, site: &SiteConfig, method: Method, path: &str, body: Option<&Value>) -> JiraResult<Value> {
        let target = self.target(site).await?;
        let url = format!("{}{path}", target.base);
        let mut attempt = 0;
        loop {
            let mut req = self
                .http
                .request(method.clone(), &url)
                .header(reqwest::header::AUTHORIZATION, &target.auth)
                .header(reqwest::header::ACCEPT, "application/json");
            if let Some(b) = body {
                req = req.json(b);
            }
            let res = req.send().await.map_err(|e| {
                if e.is_timeout() {
                    format!("{} timed out", site.label)
                } else {
                    format!("Could not reach {}: {}", site.base_url, e.without_url())
                }
            })?;
            let status = res.status();
            if status.is_success() {
                return if status == StatusCode::NO_CONTENT {
                    Ok(Value::Null)
                } else {
                    res.json().await.map_err(|_| format!("{} returned a response Domino couldn't read", site.label))
                };
            }
            if (status == StatusCode::TOO_MANY_REQUESTS || status == StatusCode::SERVICE_UNAVAILABLE) && attempt < MAX_RETRIES {
                let wait = res
                    .headers()
                    .get(reqwest::header::RETRY_AFTER)
                    .and_then(|v| v.to_str().ok())
                    .and_then(|v| v.trim().parse::<u64>().ok())
                    .map(Duration::from_secs)
                    .unwrap_or(self.backoff * 2u32.pow(attempt))
                    .min(MAX_RETRY_WAIT);
                attempt += 1;
                log::warn!("{} rate limited ({}), retry {attempt} in {wait:?}", site.id, status.as_u16());
                tokio::time::sleep(wait).await;
                continue;
            }
            let detail: Value = res.json().await.unwrap_or(Value::Null);
            return Err(describe_error(site, status, &detail));
        }
    }

    async fn search_all(&self, site: &SiteConfig, jql: &str, max: Option<usize>) -> JiraResult<Vec<Value>> {
        let limit = max.unwrap_or(usize::MAX);
        let mut out = Vec::new();
        let mut next: Option<String> = None;
        loop {
            let want = PAGE_SIZE.min(limit - out.len());
            let mut body = json!({ "jql": jql, "fields": FIELDS, "maxResults": want });
            if let Some(tok) = &next {
                body["nextPageToken"] = json!(tok);
            }
            let page = self.send(site, Method::POST, "/rest/api/3/search/jql", Some(&body)).await?;
            let issues = page["issues"].as_array().cloned().unwrap_or_default();
            let empty = issues.is_empty();
            out.extend(issues);
            let prev = next.take();
            next = page["nextPageToken"].as_str().map(String::from);
            let last = page["isLast"].as_bool().unwrap_or(next.is_none());
            // An empty page or a repeated token would otherwise page forever.
            if last || empty || next.is_none() || next == prev || out.len() >= limit {
                break;
            }
        }
        out.truncate(limit);
        Ok(out)
    }
}

fn describe_error(site: &SiteConfig, status: StatusCode, detail: &Value) -> String {
    let mut msgs: Vec<String> = detail["errorMessages"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|m| m.as_str().map(String::from))
        .collect();
    if let Some(errs) = detail["errors"].as_object() {
        msgs.extend(errs.iter().filter_map(|(k, v)| v.as_str().map(|v| format!("{k}: {v}"))));
    }
    let jira = if msgs.is_empty() { String::new() } else { format!(": {}", truncate(&msgs.join("; "), 300)) };
    let hint = match status {
        StatusCode::UNAUTHORIZED => match site.auth {
            SiteAuth::ApiToken { .. } => " (check the email and API token)",
            SiteAuth::OAuth3lo => " (reconnect with Atlassian in Settings)",
        },
        StatusCode::FORBIDDEN => " (your account lacks permission)",
        StatusCode::TOO_MANY_REQUESTS => " (rate limited; try again shortly)",
        _ => "",
    };
    format!("{} returned {}{hint}{jira}", site.label, status.as_u16())
}

fn check_key(key: &str) -> JiraResult<()> {
    if is_issue_key(key) {
        Ok(())
    } else {
        Err(format!("\"{key}\" is not a valid issue key"))
    }
}

#[async_trait]
impl JiraBackend for HttpBackend {
    async fn search(&self, site: &SiteConfig, jql: &str, max_results: Option<usize>) -> JiraResult<Vec<Value>> {
        self.search_all(site, jql, max_results).await
    }

    async fn epic(&self, site: &SiteConfig, key: &str, filter: Option<&str>) -> JiraResult<Value> {
        let epic = self.issue(site, key).await?;
        // `parent` covers team-managed and (since 2024) company-managed epics on Jira Cloud.
        let children = self.search_all(site, &and_filter(&format!("parent = {key}"), filter), None).await?;
        Ok(json!({ "epic": epic, "children": children }))
    }

    async fn issue(&self, site: &SiteConfig, key: &str) -> JiraResult<Value> {
        check_key(key)?;
        self.send(site, Method::GET, &format!("/rest/api/3/issue/{key}?fields={}", FIELDS.join(",")), None).await
    }

    async fn remote_links(&self, site: &SiteConfig, key: &str) -> JiraResult<Vec<Value>> {
        check_key(key)?;
        let v = self.send(site, Method::GET, &format!("/rest/api/3/issue/{key}/remotelink"), None).await?;
        Ok(v.as_array().cloned().unwrap_or_default())
    }

    async fn link_types(&self, site: &SiteConfig) -> JiraResult<Value> {
        self.send(site, Method::GET, "/rest/api/3/issueLinkType", None).await
    }

    async fn health(&self, site: &SiteConfig) -> JiraResult<()> {
        self.send(site, Method::GET, "/rest/api/3/myself", None).await.map(|_| ())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::{ConfigFile, DominoConfig, SEED_CONFIG};
    use crate::jira::oauth::{CLIENT_ID_REF, CLIENT_SECRET_REF, REFRESH_TOKEN_REF};
    use crate::secrets::MemorySecrets;
    use wiremock::matchers::{body_partial_json, header, method, path, query_param};
    use wiremock::{Mock, MockServer, Request, Respond, ResponseTemplate};

    struct Fixture {
        server: MockServer,
        backend: HttpBackend,
        config: Arc<ConfigHandle>,
        _dir: tempfile::TempDir,
    }

    async fn fixture() -> Fixture {
        let server = MockServer::start().await;
        let dir = tempfile::tempdir().unwrap();
        // Seed a config whose sites point at the mock server (validation requires https, so write it directly).
        let mut cfg: DominoConfig = serde_json::from_str(SEED_CONFIG).unwrap();
        cfg.sites[0].base_url = server.uri();
        let file = ConfigFile::new(dir.path());
        file.save(&cfg).unwrap();
        let config = Arc::new(ConfigHandle::load_unvalidated(file).unwrap());
        let secrets = Arc::new(MemorySecrets::default());
        secrets.set("DOMINO_ACME_TOKEN", "tok-123").unwrap();
        secrets.set(CLIENT_ID_REF, "cid").unwrap();
        secrets.set(CLIENT_SECRET_REF, "csecret").unwrap();
        secrets.set(REFRESH_TOKEN_REF, "rt").unwrap();
        let http = reqwest::Client::new();
        let oauth = Arc::new(OAuth::with_endpoints(http.clone(), secrets.clone(), &server.uri(), &server.uri()));
        let backend = HttpBackend::new(http, secrets, oauth, config.clone()).with_backoff(Duration::from_millis(1));
        Fixture { server, backend, config, _dir: dir }
    }

    fn acme(f: &Fixture) -> SiteConfig {
        f.config.site("acme").unwrap()
    }

    fn issue(key: &str) -> Value {
        json!({ "id": key, "key": key, "fields": { "summary": key } })
    }

    #[tokio::test]
    async fn api_token_search_pages_with_next_page_token() {
        let f = fixture().await;
        // "acme@example:tok-123"-style Basic header built from the config email + keychain token.
        let basic = format!("Basic {}", base64::engine::general_purpose::STANDARD.encode("bot@acme.example:tok-123"));
        Mock::given(method("POST"))
            .and(path("/rest/api/3/search/jql"))
            .and(header("authorization", basic.as_str()))
            .and(body_partial_json(json!({ "jql": "project = CORE", "nextPageToken": "p2" })))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({ "issues": [issue("CORE-3")], "isLast": true })))
            .mount(&f.server)
            .await;
        Mock::given(method("POST"))
            .and(path("/rest/api/3/search/jql"))
            .and(header("authorization", basic.as_str()))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({
                "issues": [issue("CORE-1"), issue("CORE-2")], "nextPageToken": "p2", "isLast": false
            })))
            .mount(&f.server)
            .await;
        let got = f.backend.search(&acme(&f), "project = CORE", None).await.unwrap();
        let keys: Vec<_> = got.iter().map(|i| i["key"].as_str().unwrap().to_string()).collect();
        assert_eq!(keys, ["CORE-1", "CORE-2", "CORE-3"]);

        let reqs = f.server.received_requests().await.unwrap();
        let first: Value = serde_json::from_slice(&reqs[0].body).unwrap();
        assert_eq!(first["fields"], json!(FIELDS));
        assert!(first.get("nextPageToken").is_none());
    }

    #[tokio::test]
    async fn search_stops_at_max_results() {
        let f = fixture().await;
        Mock::given(method("POST"))
            .and(path("/rest/api/3/search/jql"))
            .and(body_partial_json(json!({ "maxResults": 2 })))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({
                "issues": [issue("A-1"), issue("A-2")], "nextPageToken": "more", "isLast": false
            })))
            .expect(1)
            .mount(&f.server)
            .await;
        assert_eq!(f.backend.search(&acme(&f), "project = A", Some(2)).await.unwrap().len(), 2);
    }

    #[tokio::test]
    async fn search_stops_on_empty_page_even_with_a_token() {
        let f = fixture().await;
        Mock::given(method("POST"))
            .and(path("/rest/api/3/search/jql"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({ "issues": [], "nextPageToken": "same", "isLast": false })))
            .expect(1)
            .mount(&f.server)
            .await;
        assert!(f.backend.search(&acme(&f), "project = A", None).await.unwrap().is_empty());
    }

    struct RateLimitOnce(std::sync::atomic::AtomicBool);
    impl Respond for RateLimitOnce {
        fn respond(&self, _: &Request) -> ResponseTemplate {
            if self.0.swap(false, std::sync::atomic::Ordering::SeqCst) {
                ResponseTemplate::new(429).insert_header("Retry-After", "0")
            } else {
                ResponseTemplate::new(200).set_body_json(json!([{ "id": 1, "relationship": "blocks", "object": { "url": "https://x/browse/A-1" } }]))
            }
        }
    }

    #[tokio::test]
    async fn retries_after_429() {
        let f = fixture().await;
        Mock::given(method("GET"))
            .and(path("/rest/api/3/issue/CORE-1/remotelink"))
            .respond_with(RateLimitOnce(true.into()))
            .expect(2)
            .mount(&f.server)
            .await;
        assert_eq!(f.backend.remote_links(&acme(&f), "CORE-1").await.unwrap().len(), 1);
    }

    #[tokio::test]
    async fn errors_are_descriptive_and_never_contain_the_token() {
        let f = fixture().await;
        Mock::given(method("GET"))
            .and(path("/rest/api/3/myself"))
            .respond_with(ResponseTemplate::new(401).set_body_json(json!({ "errorMessages": ["Client must be authenticated"] })))
            .mount(&f.server)
            .await;
        let err = f.backend.health(&acme(&f)).await.unwrap_err();
        assert!(err.contains("401") && err.contains("API token") && err.contains("Client must be authenticated"), "{err}");
        assert!(!err.contains("tok-123"));
    }

    #[tokio::test]
    async fn rejects_invalid_keys_before_any_request() {
        let f = fixture().await;
        assert!(f.backend.issue(&acme(&f), "../admin").await.is_err());
        assert!(f.backend.remote_links(&acme(&f), "A-1/../../x").await.is_err());
        assert!(f.server.received_requests().await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn issue_requests_only_needed_fields() {
        let f = fixture().await;
        Mock::given(method("GET"))
            .and(path("/rest/api/3/issue/CORE-7"))
            .and(query_param("fields", FIELDS.join(",").as_str()))
            .respond_with(ResponseTemplate::new(200).set_body_json(issue("CORE-7")))
            .mount(&f.server)
            .await;
        assert_eq!(f.backend.issue(&acme(&f), "CORE-7").await.unwrap()["key"], "CORE-7");
    }

    #[tokio::test]
    async fn oauth_site_discovers_and_persists_cloud_id_then_uses_gateway() {
        let f = fixture().await;
        Mock::given(method("POST"))
            .and(path("/oauth/token"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({ "access_token": "at", "expires_in": 3600, "refresh_token": "rt2" })))
            .mount(&f.server)
            .await;
        Mock::given(method("GET"))
            .and(path("/oauth/token/accessible-resources"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!([{ "id": "cloud-9", "url": "https://partner.atlassian.net", "name": "p" }])))
            .expect(1)
            .mount(&f.server)
            .await;
        Mock::given(method("GET"))
            .and(path("/ex/jira/cloud-9/rest/api/3/myself"))
            .and(header("authorization", "Bearer at"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({ "accountId": "me" })))
            .expect(2)
            .mount(&f.server)
            .await;
        let partner = f.config.site("partner").unwrap();
        f.backend.health(&partner).await.unwrap();
        assert_eq!(f.config.site("partner").unwrap().cloud_id.as_deref(), Some("cloud-9"));
        f.backend.health(&partner).await.unwrap(); // second call: cached cloudId, no discovery
    }

    #[tokio::test]
    async fn epic_uses_parent_jql() {
        let f = fixture().await;
        Mock::given(method("GET"))
            .and(path("/rest/api/3/issue/CORE-1"))
            .respond_with(ResponseTemplate::new(200).set_body_json(issue("CORE-1")))
            .mount(&f.server)
            .await;
        Mock::given(method("POST"))
            .and(path("/rest/api/3/search/jql"))
            .and(body_partial_json(json!({ "jql": "parent = CORE-1 AND (project = CORE)" })))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({ "issues": [issue("CORE-10")], "isLast": true })))
            .mount(&f.server)
            .await;
        let v = f.backend.epic(&acme(&f), "CORE-1", Some("project = CORE")).await.unwrap();
        assert_eq!(v["children"][0]["key"], "CORE-10");
    }
}
