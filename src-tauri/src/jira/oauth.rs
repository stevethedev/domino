//! Atlassian OAuth 2.0 (3LO) for a desktop app.
//!
//! - The client id/secret are entered by the user and kept in the keychain (never compiled in).
//! - Sign-in: open the system browser to the consent page, receive the code on a one-shot
//!   loopback listener, verify `state`, exchange it for tokens.
//! - Atlassian rotates refresh tokens, so every refresh stores the new one; refreshes are
//!   serialized so two concurrent requests can't invalidate each other's token.

use crate::secrets::SecretStore;
use serde::Deserialize;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use tokio::sync::Mutex;

pub const CLIENT_ID_REF: &str = "DOMINO_OAUTH_CLIENT_ID";
pub const CLIENT_SECRET_REF: &str = "DOMINO_OAUTH_CLIENT_SECRET";
pub const REFRESH_TOKEN_REF: &str = "DOMINO_OAUTH_REFRESH_TOKEN";
pub const CALLBACK_ADDR: &str = "127.0.0.1:53682";
pub const REDIRECT_URI: &str = "http://127.0.0.1:53682/callback";
const SCOPES: &str = "read:jira-work read:jira-user offline_access";

#[derive(Debug, Clone, Deserialize, PartialEq)]
pub struct AccessibleResource {
    pub id: String,
    pub url: String,
    #[serde(default)]
    pub name: String,
}

#[derive(Deserialize)]
struct TokenResponse {
    access_token: String,
    #[serde(default)]
    expires_in: Option<u64>,
    #[serde(default)]
    refresh_token: Option<String>,
}

pub struct OAuth {
    http: reqwest::Client,
    secrets: Arc<dyn SecretStore>,
    auth_base: String, // https://auth.atlassian.com
    api_base: String,  // https://api.atlassian.com
    token: Mutex<Option<(String, Instant)>>,
}

impl OAuth {
    pub fn new(http: reqwest::Client, secrets: Arc<dyn SecretStore>) -> Self {
        Self::with_endpoints(http, secrets, "https://auth.atlassian.com", "https://api.atlassian.com")
    }

    pub fn with_endpoints(http: reqwest::Client, secrets: Arc<dyn SecretStore>, auth_base: &str, api_base: &str) -> Self {
        Self {
            http,
            secrets,
            auth_base: auth_base.trim_end_matches('/').into(),
            api_base: api_base.trim_end_matches('/').into(),
            token: Mutex::new(None),
        }
    }

    pub fn api_base(&self) -> &str {
        &self.api_base
    }

    pub fn is_connected(&self) -> bool {
        self.secrets.is_set(REFRESH_TOKEN_REF)
    }

    fn client_creds(&self) -> Result<(String, String), String> {
        let id = self.secrets.get(CLIENT_ID_REF).map_err(|_| "OAuth app not configured: add the client ID in Settings".to_string())?;
        let secret =
            self.secrets.get(CLIENT_SECRET_REF).map_err(|_| "OAuth app not configured: add the client secret in Settings".to_string())?;
        Ok((id, secret))
    }

    pub fn authorize_url(&self, state: &str) -> Result<String, String> {
        let (client_id, _) = self.client_creds()?;
        let mut u = url::Url::parse(&format!("{}/authorize", self.auth_base)).map_err(|e| e.to_string())?;
        u.query_pairs_mut()
            .append_pair("audience", "api.atlassian.com")
            .append_pair("client_id", &client_id)
            .append_pair("scope", SCOPES)
            .append_pair("redirect_uri", REDIRECT_URI)
            .append_pair("state", state)
            .append_pair("response_type", "code")
            .append_pair("prompt", "consent");
        Ok(u.into())
    }

    async fn token_request(&self, body: serde_json::Value) -> Result<TokenResponse, String> {
        let res = self
            .http
            .post(format!("{}/oauth/token", self.auth_base))
            .json(&body)
            .send()
            .await
            .map_err(|e| format!("Could not reach Atlassian auth: {}", e.without_url()))?;
        let status = res.status();
        if !status.is_success() {
            // Atlassian returns { error, error_description }; never echo request bodies (they hold secrets).
            let detail: serde_json::Value = res.json().await.unwrap_or_default();
            let desc = detail["error_description"].as_str().or(detail["error"].as_str()).unwrap_or("request rejected");
            return Err(format!("Atlassian auth failed ({}): {}", status.as_u16(), truncate(desc, 200)));
        }
        res.json().await.map_err(|_| "Atlassian auth returned an unexpected response".into())
    }

    fn remember(&self, t: &TokenResponse) -> Result<(String, Instant), String> {
        if let Some(rt) = &t.refresh_token {
            self.secrets.set(REFRESH_TOKEN_REF, rt)?;
        }
        // Refresh a minute early so in-flight requests don't race expiry.
        let ttl = t.expires_in.unwrap_or(3600).saturating_sub(60).max(30);
        Ok((t.access_token.clone(), Instant::now() + Duration::from_secs(ttl)))
    }

    pub async fn exchange_code(&self, code: &str) -> Result<(), String> {
        let (client_id, client_secret) = self.client_creds()?;
        let t = self
            .token_request(serde_json::json!({
                "grant_type": "authorization_code",
                "client_id": client_id,
                "client_secret": client_secret,
                "code": code,
                "redirect_uri": REDIRECT_URI,
            }))
            .await?;
        if t.refresh_token.is_none() {
            return Err("Atlassian did not return a refresh token; add the offline_access scope to the app".into());
        }
        let entry = self.remember(&t)?;
        *self.token.lock().await = Some(entry);
        Ok(())
    }

    /// A valid access token, refreshing (and rotating the refresh token) when needed.
    pub async fn access_token(&self) -> Result<String, String> {
        let mut guard = self.token.lock().await;
        if let Some((tok, exp)) = guard.as_ref() {
            if Instant::now() < *exp {
                return Ok(tok.clone());
            }
        }
        let refresh = self.secrets.get(REFRESH_TOKEN_REF).map_err(|_| "Not connected to Atlassian: click Connect in Settings".to_string())?;
        let (client_id, client_secret) = self.client_creds()?;
        let t = self
            .token_request(serde_json::json!({
                "grant_type": "refresh_token",
                "client_id": client_id,
                "client_secret": client_secret,
                "refresh_token": refresh,
            }))
            .await
            .map_err(|e| format!("{e}. Try Connect again in Settings."))?;
        let entry = self.remember(&t)?;
        let tok = entry.0.clone();
        *guard = Some(entry);
        Ok(tok)
    }

    pub async fn accessible_resources(&self) -> Result<Vec<AccessibleResource>, String> {
        let token = self.access_token().await?;
        let res = self
            .http
            .get(format!("{}/oauth/token/accessible-resources", self.api_base))
            .bearer_auth(token)
            .send()
            .await
            .map_err(|e| format!("Could not reach Atlassian: {}", e.without_url()))?;
        if !res.status().is_success() {
            return Err(format!("Could not list accessible sites ({})", res.status().as_u16()));
        }
        res.json().await.map_err(|_| "Unexpected accessible-resources response".into())
    }

    pub async fn disconnect(&self) -> Result<(), String> {
        *self.token.lock().await = None;
        self.secrets.set(REFRESH_TOKEN_REF, "")
    }
}

/// Finds the cloudId for a site by matching its base URL against accessible resources.
pub fn cloud_id_for(base_url: &str, resources: &[AccessibleResource]) -> Option<String> {
    let want = base_url.trim_end_matches('/').to_ascii_lowercase();
    resources.iter().find(|r| r.url.trim_end_matches('/').to_ascii_lowercase() == want).map(|r| r.id.clone())
}

pub fn random_state() -> Result<String, String> {
    let mut buf = [0u8; 24];
    getrandom::fill(&mut buf).map_err(|e| format!("No randomness available: {e}"))?;
    Ok(buf.iter().map(|b| format!("{b:02x}")).collect())
}

pub async fn bind_callback() -> Result<TcpListener, String> {
    TcpListener::bind(CALLBACK_ADDR)
        .await
        .map_err(|e| format!("Could not listen on {CALLBACK_ADDR} for the OAuth callback (is another sign-in open?): {e}"))
}

/// Serves the loopback redirect until a request with the expected `state` arrives. Returns the code.
pub async fn wait_for_callback(listener: TcpListener, expected_state: &str, timeout: Duration) -> Result<String, String> {
    let fut = async {
        loop {
            let (mut sock, _) = listener.accept().await.map_err(|e| e.to_string())?;
            let mut buf = vec![0u8; 8192];
            // A connection that never sends must not block the real browser redirect behind it.
            let n = match tokio::time::timeout(Duration::from_secs(5), sock.read(&mut buf)).await {
                Ok(Ok(n)) => n,
                _ => continue,
            };
            let req = String::from_utf8_lossy(&buf[..n]);
            let target = req.lines().next().and_then(|l| l.split_whitespace().nth(1)).unwrap_or("");
            let parsed = url::Url::parse(&format!("http://localhost{target}")).ok();
            let Some(u) = parsed.filter(|u| u.path() == "/callback") else {
                respond(&mut sock, "404 Not Found", "Not found").await;
                continue;
            };
            let q: std::collections::HashMap<String, String> = u.query_pairs().into_owned().collect();
            if q.get("state").map(String::as_str) != Some(expected_state) {
                respond(&mut sock, "400 Bad Request", "Sign-in request did not match. Close this tab and try again from Domino.").await;
                continue; // ignore stray or forged requests; keep waiting for the real one
            }
            if let Some(err) = q.get("error") {
                let msg = q.get("error_description").unwrap_or(err);
                respond(&mut sock, "200 OK", "Sign-in was cancelled. You can close this tab.").await;
                return Err(format!("Atlassian sign-in failed: {}", truncate(msg, 200)));
            }
            let Some(code) = q.get("code").cloned() else {
                respond(&mut sock, "400 Bad Request", "Missing authorization code.").await;
                continue;
            };
            respond(&mut sock, "200 OK", "Domino is connected to Atlassian. You can close this tab.").await;
            return Ok(code);
        }
    };
    tokio::time::timeout(timeout, fut).await.map_err(|_| "Timed out waiting for Atlassian sign-in".to_string())?
}

async fn respond(sock: &mut tokio::net::TcpStream, status: &str, text: &str) {
    let body = format!(
        "<!doctype html><meta charset=utf-8><title>Domino</title><body style=\"font:16px system-ui;padding:40px\"><p>{text}</p>"
    );
    let res = format!(
        "HTTP/1.1 {status}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\nCache-Control: no-store\r\n\r\n{body}",
        body.len()
    );
    let _ = sock.write_all(res.as_bytes()).await;
    let _ = sock.shutdown().await;
}

pub fn truncate(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        s.to_string()
    } else {
        format!("{}…", s.chars().take(max).collect::<String>())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::secrets::MemorySecrets;
    use wiremock::matchers::{body_partial_json, header, method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    fn secrets() -> Arc<MemorySecrets> {
        let s = Arc::new(MemorySecrets::default());
        s.set(CLIENT_ID_REF, "cid").unwrap();
        s.set(CLIENT_SECRET_REF, "csecret").unwrap();
        s
    }

    #[test]
    fn authorize_url_has_required_params() {
        let o = OAuth::new(reqwest::Client::new(), secrets());
        let u = url::Url::parse(&o.authorize_url("abc").unwrap()).unwrap();
        let q: std::collections::HashMap<_, _> = u.query_pairs().into_owned().collect();
        assert_eq!(u.host_str(), Some("auth.atlassian.com"));
        assert_eq!(q["client_id"], "cid");
        assert_eq!(q["state"], "abc");
        assert_eq!(q["redirect_uri"], REDIRECT_URI);
        assert!(q["scope"].contains("offline_access"));
        assert!(!u.as_str().contains("csecret"));
    }

    #[tokio::test]
    async fn refresh_rotates_token_and_caches_access_token() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/oauth/token"))
            .and(body_partial_json(serde_json::json!({ "grant_type": "refresh_token", "refresh_token": "rt-1" })))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "access_token": "at-1", "expires_in": 3600, "refresh_token": "rt-2"
            })))
            .expect(1)
            .mount(&server)
            .await;
        let s = secrets();
        s.set(REFRESH_TOKEN_REF, "rt-1").unwrap();
        let o = OAuth::with_endpoints(reqwest::Client::new(), s.clone(), &server.uri(), &server.uri());
        assert_eq!(o.access_token().await.unwrap(), "at-1");
        assert_eq!(o.access_token().await.unwrap(), "at-1"); // cached, no second call
        assert_eq!(s.get(REFRESH_TOKEN_REF).unwrap(), "rt-2");
    }

    #[tokio::test]
    async fn failed_refresh_reports_without_leaking_secrets() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/oauth/token"))
            .respond_with(ResponseTemplate::new(403).set_body_json(serde_json::json!({ "error": "invalid_grant", "error_description": "Unknown or invalid refresh token." })))
            .mount(&server)
            .await;
        let s = secrets();
        s.set(REFRESH_TOKEN_REF, "rt-secret").unwrap();
        let o = OAuth::with_endpoints(reqwest::Client::new(), s, &server.uri(), &server.uri());
        let err = o.access_token().await.unwrap_err();
        assert!(err.contains("invalid refresh token"), "{err}");
        assert!(!err.contains("rt-secret") && !err.contains("csecret"));
    }

    #[tokio::test]
    async fn not_connected_without_refresh_token() {
        let o = OAuth::new(reqwest::Client::new(), secrets());
        assert!(!o.is_connected());
        assert!(o.access_token().await.unwrap_err().contains("Not connected"));
    }

    #[tokio::test]
    async fn accessible_resources_and_cloud_id_matching() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/oauth/token/accessible-resources"))
            .and(header("authorization", "Bearer at-1"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!([
                { "id": "c-1", "url": "https://partner.atlassian.net", "name": "partner", "scopes": [] },
                { "id": "c-2", "url": "https://other.atlassian.net", "name": "other", "scopes": [] }
            ])))
            .mount(&server)
            .await;
        let o = OAuth::with_endpoints(reqwest::Client::new(), secrets(), &server.uri(), &server.uri());
        *o.token.lock().await = Some(("at-1".into(), Instant::now() + Duration::from_secs(600)));
        let res = o.accessible_resources().await.unwrap();
        assert_eq!(cloud_id_for("https://Partner.atlassian.net/", &res).as_deref(), Some("c-1"));
        assert_eq!(cloud_id_for("https://acme.atlassian.net", &res), None);
    }

    #[tokio::test]
    async fn callback_ignores_wrong_state_then_accepts_right_one() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let waiter = tokio::spawn(wait_for_callback(listener, "good", Duration::from_secs(15)));
        let _idle = tokio::net::TcpStream::connect(addr).await.unwrap(); // connects, never sends
        let get = |target: String| async move {
            let mut s = tokio::net::TcpStream::connect(addr).await.unwrap();
            s.write_all(format!("GET {target} HTTP/1.1\r\nHost: x\r\n\r\n").as_bytes()).await.unwrap();
            let mut out = String::new();
            s.read_to_string(&mut out).await.unwrap();
            out
        };
        assert!(get("/callback?code=evil&state=bad".into()).await.starts_with("HTTP/1.1 400"));
        assert!(get("/favicon.ico".into()).await.starts_with("HTTP/1.1 404"));
        assert!(get("/callback?code=the-code&state=good".into()).await.starts_with("HTTP/1.1 200"));
        assert_eq!(waiter.await.unwrap().unwrap(), "the-code");
    }

    #[test]
    fn random_state_is_long_and_unique() {
        let (a, b) = (random_state().unwrap(), random_state().unwrap());
        assert_eq!(a.len(), 48);
        assert_ne!(a, b);
    }
}
