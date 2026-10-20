//! GitHub's GraphQL API, on github.com (`https://api.github.com/graphql`) or GitHub Enterprise
//! Server (`{host}/api/graphql`), with a personal access token from the keychain.
//!
//! - Searches page with cursors; issues by key are fetched in aliased batches.
//! - 429, 502, 503 and rate-limited 403s are retried, honoring Retry-After and x-ratelimit-reset.
//! - Error messages never include the token or request headers.

use super::{
    check_key, issues_query, issues_variables, search_query, sub_issues_query, viewer_query, GitHubBackend, GitHubResult, IssueRef,
    KEY_BATCH,
};
use crate::config::{SiteAuth, SiteConfig, SiteKind};
use crate::jira::oauth::truncate;
use crate::secrets::SecretStore;
use async_trait::async_trait;
use reqwest::header::HeaderMap;
use reqwest::StatusCode;
use serde_json::{json, Value};
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

/// Search results per page. Each result brings its links along, so pages are kept smallish.
const PAGE_SIZE: usize = 50;
/// A runaway pager stops here (GitHub's search returns at most 1000 results anyway).
const MAX_PAGES: usize = 40;
const MAX_RETRIES: u32 = 3;
const MAX_RETRY_WAIT: Duration = Duration::from_secs(30);

pub(crate) struct GitHubHttp {
    http: reqwest::Client,
    secrets: Arc<dyn SecretStore>,
    /// Base for retry backoff; shortened in tests.
    backoff: Duration,
}

/// Where a site's GraphQL API lives: github.com's is on its own host, Enterprise Server's under /api.
fn endpoint(site: &SiteConfig) -> String {
    let base = site.base_url.trim_end_matches('/');
    if base.eq_ignore_ascii_case("https://github.com") {
        "https://api.github.com/graphql".to_owned()
    } else {
        format!("{base}/api/graphql")
    }
}

/// How long GitHub asks us to wait, if it says: Retry-After, or (with no requests left) until x-ratelimit-reset.
fn requested_wait(headers: &HeaderMap) -> Option<Duration> {
    let header = |name: &str| headers.get(name).and_then(|v| v.to_str().ok()).and_then(|v| v.trim().parse::<u64>().ok());
    if let Some(secs) = header("retry-after") {
        return Some(Duration::from_secs(secs));
    }
    if header("x-ratelimit-remaining") == Some(0) {
        let now = SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_secs());
        return header("x-ratelimit-reset").map(|reset| Duration::from_secs(reset.saturating_sub(now)));
    }
    None
}

impl GitHubHttp {
    pub(crate) fn new(http: reqwest::Client, secrets: Arc<dyn SecretStore>) -> Self {
        Self { http, secrets, backoff: Duration::from_secs(1) }
    }

    #[cfg(test)]
    const fn with_backoff(mut self, d: Duration) -> Self {
        self.backoff = d;
        self
    }

    fn token(&self, site: &SiteConfig) -> GitHubResult<String> {
        match (&site.kind, &site.auth) {
            (SiteKind::GitHub, SiteAuth::GitHubToken { secret_ref }) => self.secrets.get(secret_ref),
            _ => Err(format!("{} is not a GitHub site", site.label)),
        }
    }

    /// Runs one query and returns its `data`. With `allow_missing`, errors that only say something
    /// wasn't found (a deleted issue, a repo the token can't see) leave that field null instead of failing.
    async fn graphql(&self, site: &SiteConfig, query: &str, variables: Value, allow_missing: bool) -> GitHubResult<Value> {
        let token = self.token(site)?;
        let url = endpoint(site);
        let body = json!({ "query": query, "variables": variables });
        let mut attempt = 0;
        loop {
            let res = self
                .http
                .post(&url)
                .bearer_auth(&token)
                .header(reqwest::header::ACCEPT, "application/json")
                .json(&body)
                .send()
                .await
                .map_err(|e| {
                    if e.is_timeout() {
                        format!("{} timed out", site.label)
                    } else {
                        format!("Could not reach {}: {}", site.base_url, e.without_url())
                    }
                })?;
            let status = res.status();
            let wait = requested_wait(res.headers());
            let retryable = matches!(status, StatusCode::TOO_MANY_REQUESTS | StatusCode::BAD_GATEWAY | StatusCode::SERVICE_UNAVAILABLE)
                || (status == StatusCode::FORBIDDEN && wait.is_some());
            if retryable && attempt < MAX_RETRIES {
                let wait = wait.unwrap_or_else(|| self.backoff * 2_u32.pow(attempt)).min(MAX_RETRY_WAIT);
                attempt += 1;
                log::warn!("{} rate limited ({}), retry {attempt} in {wait:?}", site.id, status.as_u16());
                tokio::time::sleep(wait).await;
                continue;
            }
            let reply: Value = res.json().await.unwrap_or(Value::Null);
            if !status.is_success() {
                return Err(describe_error(site, status, &reply));
            }
            return data_of(site, reply, allow_missing);
        }
    }

    async fn search_all(&self, site: &SiteConfig, q: &str, max: Option<usize>) -> GitHubResult<Vec<Value>> {
        let limit = max.unwrap_or(usize::MAX);
        let query = search_query();
        let mut out = Vec::new();
        let mut after: Option<String> = None;
        for _ in 0..MAX_PAGES {
            let first = PAGE_SIZE.min(limit - out.len());
            let data = self.graphql(site, &query, json!({ "q": q, "first": first, "after": after }), false).await?;
            let conn = data.get("search").unwrap_or(&Value::Null);
            let nodes = nodes_of(conn);
            let empty = nodes.is_empty();
            out.extend(nodes);
            let prev = after.take();
            after = next_cursor(conn);
            if empty || after.is_none() || after == prev || out.len() >= limit {
                break;
            }
        }
        out.truncate(limit);
        Ok(out)
    }
}

/// The non-null nodes of a connection (search results can include nulls for things we can't see).
fn nodes_of(conn: &Value) -> Vec<Value> {
    conn.get("nodes").and_then(Value::as_array).into_iter().flatten().filter(|n| n.is_object()).cloned().collect()
}

/// The cursor for the next page, while there is one.
fn next_cursor(conn: &Value) -> Option<String> {
    let page = conn.get("pageInfo")?;
    if page.get("hasNextPage").and_then(Value::as_bool) != Some(true) {
        return None;
    }
    page.get("endCursor").and_then(Value::as_str).map(String::from)
}

/// `data` from a 200 reply, unless it carries errors (other than not-found ones, when allowed).
fn data_of(site: &SiteConfig, reply: Value, allow_missing: bool) -> GitHubResult<Value> {
    let errors: Vec<&Value> = reply.get("errors").and_then(Value::as_array).into_iter().flatten().collect();
    let fatal: Vec<&str> = errors
        .iter()
        .filter(|e| !(allow_missing && e.get("type").and_then(Value::as_str) == Some("NOT_FOUND")))
        .map(|e| e.get("message").and_then(Value::as_str).unwrap_or("unknown error"))
        .collect();
    if !fatal.is_empty() {
        return Err(format!("{} returned an error: {}", site.label, truncate(&fatal.join("; "), 300)));
    }
    match reply {
        Value::Object(mut fields) => fields.remove("data").filter(Value::is_object),
        _ => None,
    }
    .ok_or_else(|| {
        log::warn!("{}: reply had no data", site.id);
        format!("{} returned a response Domino couldn't read", site.label)
    })
}

fn describe_error(site: &SiteConfig, status: StatusCode, detail: &Value) -> String {
    let message = detail.get("message").and_then(Value::as_str).map(|m| format!(": {}", truncate(m, 300))).unwrap_or_default();
    let hint = match status {
        StatusCode::UNAUTHORIZED => " (check the GitHub token)",
        StatusCode::FORBIDDEN => " (the token lacks permission, or is rate limited)",
        StatusCode::TOO_MANY_REQUESTS => " (rate limited; try again shortly)",
        _ => "",
    };
    format!("{} returned {}{hint}{message}", site.label, status.as_u16())
}

#[async_trait]
impl GitHubBackend for GitHubHttp {
    async fn search(&self, site: &SiteConfig, query: &str, max_results: Option<usize>) -> GitHubResult<Vec<Value>> {
        self.search_all(site, query, max_results).await
    }

    async fn issues(&self, site: &SiteConfig, keys: &[String]) -> GitHubResult<Vec<Value>> {
        let refs = keys.iter().map(|k| check_key(k)).collect::<GitHubResult<Vec<IssueRef<'_>>>>()?;
        let mut out = Vec::new();
        for batch in refs.chunks(KEY_BATCH) {
            let data = self.graphql(site, &issues_query(batch.len()), issues_variables(batch), true).await?;
            for i in 0..batch.len() {
                if let Some(node) = data.pointer(&format!("/k{i}/issueOrPullRequest")).filter(|n| n.is_object()) {
                    out.push(node.clone());
                }
            }
        }
        Ok(out)
    }

    async fn sub_issues(&self, site: &SiteConfig, key: &str) -> GitHubResult<Vec<Value>> {
        let r = check_key(key)?;
        let query = sub_issues_query();
        let mut out = Vec::new();
        let mut after: Option<String> = None;
        for _ in 0..MAX_PAGES {
            let vars = json!({ "owner": r.owner, "repo": r.repo, "number": r.number, "after": after });
            let data = self.graphql(site, &query, vars, false).await?;
            let conn = data.pointer("/repository/issue/subIssues").unwrap_or(&Value::Null);
            let nodes = nodes_of(conn);
            let empty = nodes.is_empty();
            out.extend(nodes);
            let prev = after.take();
            after = next_cursor(conn);
            if empty || after.is_none() || after == prev {
                break;
            }
        }
        Ok(out)
    }

    async fn viewer(&self, site: &SiteConfig) -> GitHubResult<Value> {
        let data = self.graphql(site, viewer_query(), json!({}), false).await?;
        data.get("viewer").cloned().ok_or_else(|| format!("{} didn't say who the token belongs to", site.label))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::secrets::MemorySecrets;
    use wiremock::matchers::{body_partial_json, header, method, path};
    use wiremock::{Mock, MockServer, Request, Respond, ResponseTemplate};

    struct Fixture {
        server: MockServer,
        backend: GitHubHttp,
        site: SiteConfig,
    }

    async fn fixture() -> Fixture {
        let server = MockServer::start().await;
        let secrets: Arc<dyn SecretStore> = Arc::new(MemorySecrets::default());
        secrets.set("DOMINO_GITHUB_TOKEN", "ghp-secret").unwrap();
        // A GitHub Enterprise-style site (GraphQL under /api) on the plain-http mock server.
        let site: SiteConfig = serde_json::from_value(json!({
            "id": "gh", "kind": "github", "label": "GitHub", "baseUrl": server.uri(), "color": "#24292f", "enabled": true,
            "auth": { "type": "githubToken", "secretRef": "DOMINO_GITHUB_TOKEN" }
        }))
        .unwrap();
        let backend = GitHubHttp::new(reqwest::Client::new(), secrets).with_backoff(Duration::from_millis(1));
        Fixture { server, backend, site }
    }

    fn node(key: &str) -> Value {
        let (repo, number) = key.split_once('#').unwrap();
        json!({ "__typename": "Issue", "number": number.parse::<u32>().unwrap(), "title": key, "repository": { "nameWithOwner": repo } })
    }

    fn page(nodes: &[Value], next: Option<&str>) -> Value {
        json!({ "data": { "search": { "nodes": nodes, "pageInfo": { "hasNextPage": next.is_some(), "endCursor": next } } } })
    }

    #[test]
    fn github_com_uses_the_api_host() {
        let mut site: SiteConfig = serde_json::from_value(json!({
            "id": "gh", "kind": "github", "label": "GitHub", "baseUrl": "https://github.com", "color": "#24292f", "enabled": true,
            "auth": { "type": "githubToken", "secretRef": "T" }
        }))
        .unwrap();
        assert_eq!(endpoint(&site), "https://api.github.com/graphql");
        site.base_url = "https://ghe.acme.example".into();
        assert_eq!(endpoint(&site), "https://ghe.acme.example/api/graphql");
    }

    #[tokio::test]
    async fn search_pages_with_cursors_and_a_bearer_token() {
        let f = fixture().await;
        Mock::given(method("POST"))
            .and(path("/api/graphql"))
            .and(header("authorization", "Bearer ghp-secret"))
            .and(body_partial_json(json!({ "variables": { "q": "org:acme", "after": "c2" } })))
            .respond_with(ResponseTemplate::new(200).set_body_json(page(&[node("acme/web#3")], None)))
            .mount(&f.server)
            .await;
        Mock::given(method("POST"))
            .and(path("/api/graphql"))
            .and(body_partial_json(json!({ "variables": { "q": "org:acme", "after": null } })))
            .respond_with(
                ResponseTemplate::new(200).set_body_json(page(&[node("acme/web#1"), Value::Null, node("acme/web#2")], Some("c2"))),
            )
            .mount(&f.server)
            .await;
        let got = f.backend.search(&f.site, "org:acme", None).await.unwrap();
        let titles: Vec<_> = got.iter().map(|n| n["title"].as_str().unwrap().to_owned()).collect();
        assert_eq!(titles, ["acme/web#1", "acme/web#2", "acme/web#3"]);

        let reqs = f.server.received_requests().await.unwrap();
        let first: Value = serde_json::from_slice(&reqs[0].body).unwrap();
        assert!(first["query"].as_str().unwrap().starts_with("query Search("));
        assert_eq!(first["variables"]["first"], PAGE_SIZE);
    }

    #[tokio::test]
    async fn search_stops_at_max_results() {
        let f = fixture().await;
        Mock::given(method("POST"))
            .and(body_partial_json(json!({ "variables": { "first": 2 } })))
            .respond_with(ResponseTemplate::new(200).set_body_json(page(&[node("a/b#1"), node("a/b#2")], Some("more"))))
            .expect(1)
            .mount(&f.server)
            .await;
        assert_eq!(f.backend.search(&f.site, "repo:a/b", Some(2)).await.unwrap().len(), 2);
    }

    #[tokio::test]
    async fn issues_skip_missing_ones_but_fail_on_other_errors() {
        let f = fixture().await;
        Mock::given(method("POST"))
            .and(body_partial_json(json!({ "variables": { "o0": "acme", "r0": "web", "n0": 42, "r1": "gone", "n1": 1 } })))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({
                "data": { "k0": { "issueOrPullRequest": node("acme/web#42") }, "k1": null },
                "errors": [{ "type": "NOT_FOUND", "message": "Could not resolve to a Repository with the name 'acme/gone'." }]
            })))
            .mount(&f.server)
            .await;
        let got = f.backend.issues(&f.site, &["acme/web#42".into(), "acme/gone#1".into()]).await.unwrap();
        assert_eq!(got, vec![node("acme/web#42")]);

        Mock::given(method("POST"))
            .and(body_partial_json(json!({ "variables": { "r0": "bad" } })))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({
                "data": null, "errors": [{ "type": "INSUFFICIENT_SCOPES", "message": "Your token has not been granted the required scopes." }]
            })))
            .mount(&f.server)
            .await;
        let err = f.backend.issues(&f.site, &["acme/bad#1".into()]).await.unwrap_err();
        assert!(err.contains("required scopes"), "{err}");
    }

    #[tokio::test]
    async fn issues_are_fetched_in_batches() {
        let f = fixture().await;
        Mock::given(method("POST"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({ "data": {} })))
            .expect(2)
            .mount(&f.server)
            .await;
        let keys: Vec<String> = (1..=KEY_BATCH + 1).map(|n| format!("acme/web#{n}")).collect();
        assert!(f.backend.issues(&f.site, &keys).await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn sub_issues_page_through_the_connection() {
        let f = fixture().await;
        let conn = |nodes: &[Value], next: Option<&str>| json!({ "data": { "repository": { "issue": { "subIssues": { "nodes": nodes, "pageInfo": { "hasNextPage": next.is_some(), "endCursor": next } } } } } });
        Mock::given(method("POST"))
            .and(body_partial_json(json!({ "variables": { "owner": "acme", "repo": "web", "number": 1, "after": "p2" } })))
            .respond_with(ResponseTemplate::new(200).set_body_json(conn(&[node("acme/web#3")], None)))
            .mount(&f.server)
            .await;
        Mock::given(method("POST"))
            .and(body_partial_json(json!({ "variables": { "after": null } })))
            .respond_with(ResponseTemplate::new(200).set_body_json(conn(&[node("acme/web#2")], Some("p2"))))
            .mount(&f.server)
            .await;
        assert_eq!(f.backend.sub_issues(&f.site, "acme/web#1").await.unwrap(), vec![node("acme/web#2"), node("acme/web#3")]);
    }

    struct LimitedOnce(std::sync::atomic::AtomicBool, u16);
    impl Respond for LimitedOnce {
        fn respond(&self, _: &Request) -> ResponseTemplate {
            if self.0.swap(false, std::sync::atomic::Ordering::SeqCst) {
                ResponseTemplate::new(self.1).insert_header("Retry-After", "0")
            } else {
                ResponseTemplate::new(200).set_body_json(json!({ "data": { "viewer": { "login": "octocat" } } }))
            }
        }
    }

    #[tokio::test]
    async fn retries_rate_limits() {
        for status in [429, 403] {
            let f = fixture().await;
            Mock::given(method("POST")).respond_with(LimitedOnce(true.into(), status)).expect(2).mount(&f.server).await;
            assert_eq!(f.backend.viewer(&f.site).await.unwrap()["login"], "octocat", "{status}");
        }
    }

    #[tokio::test]
    async fn a_forbidden_reply_without_a_wait_is_not_retried() {
        let f = fixture().await;
        Mock::given(method("POST"))
            .respond_with(
                ResponseTemplate::new(403).set_body_json(json!({ "message": "Resource not accessible by personal access token" })),
            )
            .expect(1)
            .mount(&f.server)
            .await;
        let err = f.backend.viewer(&f.site).await.unwrap_err();
        assert!(err.contains("403") && err.contains("not accessible"), "{err}");
    }

    #[tokio::test]
    async fn errors_are_descriptive_and_never_contain_the_token() {
        let f = fixture().await;
        Mock::given(method("POST"))
            .respond_with(ResponseTemplate::new(401).set_body_json(json!({ "message": "Bad credentials" })))
            .mount(&f.server)
            .await;
        let err = f.backend.health(&f.site).await.unwrap_err();
        assert!(err.contains("401") && err.contains("GitHub token") && err.contains("Bad credentials"), "{err}");
        assert!(!err.contains("ghp-secret"));
    }

    #[tokio::test]
    async fn rejects_invalid_keys_and_jira_sites_before_any_request() {
        let f = fixture().await;
        f.backend.issues(&f.site, &["acme/web#1".into(), "../admin".into()]).await.unwrap_err();
        f.backend.sub_issues(&f.site, "acme/web#1/../x").await.unwrap_err();
        let mut jira = f.site.clone();
        jira.kind = SiteKind::Jira;
        assert!(f.backend.viewer(&jira).await.unwrap_err().contains("not a GitHub site"));
        assert!(f.server.received_requests().await.unwrap().is_empty());
    }
}
