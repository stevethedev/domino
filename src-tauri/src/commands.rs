//! Tauri commands: the webview's only door to config, secrets and Jira.
//! Every error is a plain message; none of them contain secret values.

use crate::config::{BackendKind, ConfigHandle, DominoConfig, SiteConfig};
use crate::jira::http::HttpBackend;
use crate::jira::mock::MockBackend;
use crate::jira::oauth::{self, OAuth};
use crate::jira::JiraBackend;
use crate::secrets::SecretStore;
use serde::Serialize;
use serde_json::Value;
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, State};
use tauri_plugin_opener::OpenerExt;

pub struct AppState {
    pub config: Arc<ConfigHandle>,
    pub secrets: Arc<dyn SecretStore>,
    pub oauth: Arc<OAuth>,
    pub mock: Arc<MockBackend>,
    pub http: Arc<HttpBackend>,
}

impl AppState {
    fn backend(&self) -> Arc<dyn JiraBackend> {
        match self.config.get().backend {
            BackendKind::Mock => self.mock.clone(),
            BackendKind::Jira => self.http.clone(),
        }
    }

    fn site(&self, site_id: &str, require_enabled: bool) -> Result<SiteConfig, String> {
        let site = self.config.site(site_id).ok_or_else(|| format!("Unknown site \"{site_id}\""))?;
        if require_enabled && !site.enabled {
            return Err(format!("{} is disabled", site.label));
        }
        Ok(site)
    }
}

#[tauri::command]
pub fn get_config(state: State<'_, AppState>) -> DominoConfig {
    state.config.get()
}

#[tauri::command]
pub fn save_config(state: State<'_, AppState>, config: DominoConfig) -> Result<DominoConfig, String> {
    let saved = state.config.replace(config)?;
    log::info!("config saved ({} sites, backend {:?})", saved.sites.len(), saved.backend);
    Ok(saved)
}

#[tauri::command]
pub async fn site_health(state: State<'_, AppState>, site_id: String) -> Result<(), String> {
    let site = state.site(&site_id, false)?;
    state.backend().health(&site).await
}

#[tauri::command]
pub async fn fetch_by_jql(
    state: State<'_, AppState>,
    site_id: String,
    jql: String,
    max_results: Option<usize>,
) -> Result<Vec<Value>, String> {
    let site = state.site(&site_id, true)?;
    state.backend().search(&site, &jql, max_results).await
}

#[tauri::command]
pub async fn fetch_epic(
    state: State<'_, AppState>,
    site_id: String,
    key: String,
    filter: Option<String>,
) -> Result<Value, String> {
    let site = state.site(&site_id, true)?;
    state.backend().epic(&site, &key, filter.as_deref()).await
}

#[tauri::command]
pub async fn fetch_issue(state: State<'_, AppState>, site_id: String, key: String) -> Result<Value, String> {
    let site = state.site(&site_id, true)?;
    state.backend().issue(&site, &key).await
}

#[tauri::command]
pub async fn fetch_remote_links(state: State<'_, AppState>, site_id: String, key: String) -> Result<Vec<Value>, String> {
    let site = state.site(&site_id, true)?;
    state.backend().remote_links(&site, &key).await
}

#[tauri::command]
pub async fn fetch_link_types(state: State<'_, AppState>, site_id: String) -> Result<Value, String> {
    let site = state.site(&site_id, true)?;
    state.backend().link_types(&site).await
}

#[tauri::command]
pub async fn fetch_status_history(
    state: State<'_, AppState>,
    site_id: String,
    issue_ids: Vec<String>,
) -> Result<Value, String> {
    let site = state.site(&site_id, true)?;
    state.backend().status_history(&site, &issue_ids).await
}

#[tauri::command]
pub async fn fetch_myself(state: State<'_, AppState>, site_id: String) -> Result<Value, String> {
    let site = state.site(&site_id, true)?;
    state.backend().myself(&site).await
}

#[tauri::command]
pub async fn fetch_statuses(state: State<'_, AppState>, site_id: String) -> Result<Value, String> {
    let site = state.site(&site_id, true)?;
    state.backend().statuses(&site).await
}

/// Write-only: stores a secret in the OS keychain. An empty value clears it.
#[tauri::command]
pub fn set_secret(state: State<'_, AppState>, secret_ref: String, value: String) -> Result<(), String> {
    if secret_ref == oauth::REFRESH_TOKEN_REF {
        return Err("That secret is managed by Connect/Disconnect".into());
    }
    state.secrets.set(&secret_ref, &value)?;
    log::info!("secret {secret_ref} updated");
    Ok(())
}

/// Reports whether a secret exists, never its value.
#[tauri::command]
pub fn secret_status(state: State<'_, AppState>, secret_ref: String) -> bool {
    state.secrets.is_set(&secret_ref)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OAuthStatus {
    app_configured: bool,
    connected: bool,
}

#[tauri::command]
pub fn oauth_status(state: State<'_, AppState>) -> OAuthStatus {
    OAuthStatus {
        app_configured: state.secrets.is_set(oauth::CLIENT_ID_REF) && state.secrets.is_set(oauth::CLIENT_SECRET_REF),
        connected: state.oauth.is_connected(),
    }
}

/// Runs the 3LO sign-in in the system browser, then fills in cloudIds for OAuth sites.
/// Returns the Atlassian sites the account can access.
#[tauri::command]
pub async fn oauth_connect(app: AppHandle, state: State<'_, AppState>) -> Result<Vec<String>, String> {
    let st = oauth::random_state()?;
    let url = state.oauth.authorize_url(&st)?;
    let listener = oauth::bind_callback().await?;
    app.opener().open_url(url, None::<&str>).map_err(|e| format!("Could not open the browser: {e}"))?;
    let code = oauth::wait_for_callback(listener, &st, Duration::from_secs(300)).await?;
    state.oauth.exchange_code(&code).await?;
    let resources = state.oauth.accessible_resources().await?;
    for site in state.config.get().sites.iter().filter(|s| matches!(s.auth, crate::config::SiteAuth::OAuth3lo)) {
        if let Some(id) = oauth::cloud_id_for(&site.base_url, &resources) {
            state.config.set_cloud_id(&site.base_url, &id)?;
        }
    }
    log::info!("OAuth connected ({} accessible sites)", resources.len());
    Ok(resources.into_iter().map(|r| r.url).collect())
}

#[tauri::command]
pub async fn oauth_disconnect(state: State<'_, AppState>) -> Result<(), String> {
    state.oauth.disconnect().await
}
