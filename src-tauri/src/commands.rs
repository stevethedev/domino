//! Tauri commands: the webview's only door to config, secrets and Jira.
//! Every error is a plain message; none of them contain secret values.
#![allow(
    clippy::unreachable,
    clippy::let_underscore_must_use,
    reason = "#[tauri::command] expands async commands to code using unreachable! and `let _ =`; which of them appears varies by Tauri version and platform"
)]
#![expect(clippy::needless_pass_by_value, reason = "Tauri deserializes command arguments, and injects State, by value")]

use crate::cache::{CachedScope, PutEntry, TicketCache};
use crate::config::{BackendKind, ConfigHandle, DominoConfig, SiteAuth, SiteConfig};
use crate::jira::http::HttpBackend;
use crate::jira::mock::MockBackend;
use crate::jira::oauth::{self, OAuth};
use crate::jira::JiraBackend;
use crate::secrets::SecretStore;
use serde::Serialize;
use serde_json::Value;
use std::sync::Arc;
use std::time::{Duration, SystemTime};
use tauri::{AppHandle, State};
use tauri_plugin_opener::OpenerExt;

pub(crate) struct AppState {
    pub config: Arc<ConfigHandle>,
    pub secrets: Arc<dyn SecretStore>,
    pub oauth: Arc<OAuth>,
    pub mock: Arc<MockBackend>,
    pub http: Arc<HttpBackend>,
    pub cache: Arc<TicketCache>,
    /// Wakes a waiting Atlassian sign-in so it gives up (see `oauth_cancel`).
    pub oauth_cancel: Arc<tokio::sync::Notify>,
}

impl AppState {
    fn backend(&self) -> Arc<dyn JiraBackend> {
        match self.config.get().backend {
            BackendKind::Mock => Arc::clone(&self.mock) as Arc<dyn JiraBackend>,
            BackendKind::Jira => Arc::clone(&self.http) as Arc<dyn JiraBackend>,
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
pub(crate) fn get_config(state: State<'_, AppState>) -> DominoConfig {
    state.config.get()
}

#[tauri::command]
pub(crate) fn save_config(state: State<'_, AppState>, config: DominoConfig) -> Result<DominoConfig, String> {
    let old = state.config.get();
    let saved = state.config.replace(config)?;
    log::info!("config saved ({} sites, backend {:?})", saved.sites.len(), saved.backend);
    // Removed sites, and sites now loading from another backend, address or account, lose their cached tickets.
    state.cache.invalidate_changed(&old, &saved);
    Ok(saved)
}

/// Whether the config file could be used (if not, the app is running on an empty config) and where it is.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ConfigStatus {
    problem: Option<String>,
    path: String,
}

#[tauri::command]
pub(crate) fn config_status(state: State<'_, AppState>) -> ConfigStatus {
    ConfigStatus { problem: state.config.problem(), path: state.config.path().display().to_string() }
}

/// Reads the config file again, after the user fixed it by hand.
#[tauri::command]
pub(crate) fn reload_config(state: State<'_, AppState>) -> Result<DominoConfig, String> {
    let old = state.config.get();
    let loaded = state.config.reload()?;
    state.cache.invalidate_changed(&old, &loaded);
    Ok(loaded)
}

/// A fresh, empty config, and where the unusable file was set aside (if there was one).
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FreshStart {
    config: DominoConfig,
    set_aside: Option<String>,
}

/// Sets a broken config file aside and starts with an empty one.
#[tauri::command]
pub(crate) fn start_fresh_config(state: State<'_, AppState>) -> Result<FreshStart, String> {
    let (config, aside) = state.config.start_fresh()?;
    // Every earlier site is gone, including the broken file's (the empty fallback in memory never
    // knew them): forget all cached tickets, so a site added again with the same id starts clean.
    state.cache.forget_sites(|_| true);
    Ok(FreshStart { config, set_aside: aside.map(|p| p.display().to_string()) })
}

/// Shows the config file in the system file manager. Only that file: the webview names no path.
#[tauri::command]
pub(crate) fn reveal_config(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    app.opener().reveal_item_in_dir(state.config.path()).map_err(|e| format!("Could not show the file: {e}"))
}

/// The cached tickets for a scope, if any are still valid (see `TicketCache::get`).
#[tauri::command]
pub(crate) async fn cache_get(state: State<'_, AppState>, scope_key: String) -> Result<Option<CachedScope>, String> {
    let cache = Arc::clone(&state.cache);
    let cfg = state.config.get();
    tauri::async_runtime::spawn_blocking(move || cache.get(&scope_key, &cfg, SystemTime::now()))
        .await
        .map_err(|e| format!("Could not read the ticket cache: {e}"))
}

#[tauri::command]
pub(crate) async fn cache_put(state: State<'_, AppState>, entry: PutEntry) -> Result<(), String> {
    let cache = Arc::clone(&state.cache);
    let cfg = state.config.get();
    tauri::async_runtime::spawn_blocking(move || cache.put(entry, &cfg, SystemTime::now()))
        .await
        .map_err(|e| format!("Could not write the ticket cache: {e}"))?
}

/// Deletes every cached ticket and replaces the cache key.
#[tauri::command]
pub(crate) async fn cache_clear(state: State<'_, AppState>) -> Result<(), String> {
    let cache = Arc::clone(&state.cache);
    tauri::async_runtime::spawn_blocking(move || cache.clear()).await.map_err(|e| format!("Could not clear the ticket cache: {e}"))?
}

/// Forgets the cached tickets of OAuth sites: signing in or out can switch the Atlassian account.
fn forget_oauth_sites(state: &AppState) {
    let cfg = state.config.get();
    state.cache.forget_sites(|id| cfg.site(id).is_some_and(|s| matches!(s.auth, SiteAuth::OAuth3lo)));
}

#[tauri::command]
pub(crate) async fn site_health(state: State<'_, AppState>, site_id: String) -> Result<(), String> {
    let site = state.site(&site_id, false)?;
    state.backend().health(&site).await
}

#[tauri::command]
pub(crate) async fn fetch_by_jql(
    state: State<'_, AppState>,
    site_id: String,
    jql: String,
    max_results: Option<usize>,
) -> Result<Vec<Value>, String> {
    let site = state.site(&site_id, true)?;
    state.backend().search(&site, &jql, max_results).await
}

#[tauri::command]
pub(crate) async fn fetch_epic(state: State<'_, AppState>, site_id: String, key: String, filter: Option<String>) -> Result<Value, String> {
    let site = state.site(&site_id, true)?;
    state.backend().epic(&site, &key, filter.as_deref()).await
}

#[tauri::command]
pub(crate) async fn fetch_issue(state: State<'_, AppState>, site_id: String, key: String) -> Result<Value, String> {
    let site = state.site(&site_id, true)?;
    state.backend().issue(&site, &key).await
}

#[tauri::command]
pub(crate) async fn fetch_description(state: State<'_, AppState>, site_id: String, key: String) -> Result<Value, String> {
    let site = state.site(&site_id, true)?;
    state.backend().description(&site, &key).await
}

#[tauri::command]
pub(crate) async fn fetch_remote_links(state: State<'_, AppState>, site_id: String, key: String) -> Result<Vec<Value>, String> {
    let site = state.site(&site_id, true)?;
    state.backend().remote_links(&site, &key).await
}

#[tauri::command]
pub(crate) async fn fetch_link_types(state: State<'_, AppState>, site_id: String) -> Result<Value, String> {
    let site = state.site(&site_id, true)?;
    state.backend().link_types(&site).await
}

#[tauri::command]
pub(crate) async fn fetch_priorities(state: State<'_, AppState>, site_id: String) -> Result<Vec<Value>, String> {
    let site = state.site(&site_id, true)?;
    state.backend().priorities(&site).await
}

#[tauri::command]
pub(crate) async fn fetch_status_history(state: State<'_, AppState>, site_id: String, issue_ids: Vec<String>) -> Result<Value, String> {
    let site = state.site(&site_id, true)?;
    state.backend().status_history(&site, &issue_ids).await
}

#[tauri::command]
pub(crate) async fn fetch_myself(state: State<'_, AppState>, site_id: String) -> Result<Value, String> {
    let site = state.site(&site_id, true)?;
    state.backend().myself(&site).await
}

#[tauri::command]
pub(crate) async fn fetch_statuses(state: State<'_, AppState>, site_id: String) -> Result<Value, String> {
    let site = state.site(&site_id, true)?;
    state.backend().statuses(&site).await
}

/// Write-only: stores a secret in the OS keychain. An empty value clears it.
#[tauri::command]
pub(crate) fn set_secret(state: State<'_, AppState>, secret_ref: String, value: String) -> Result<(), String> {
    if secret_ref == oauth::REFRESH_TOKEN_REF {
        return Err("That secret is managed by Connect/Disconnect".into());
    }
    state.secrets.set(&secret_ref, &value)?;
    log::info!("secret {secret_ref} updated");
    // A new token can belong to another account: forget what the sites using it cached.
    let cfg = state.config.get();
    state
        .cache
        .forget_sites(|id| cfg.site(id).is_some_and(|s| matches!(&s.auth, SiteAuth::ApiToken { secret_ref: r, .. } if *r == secret_ref)));
    Ok(())
}

/// Reports whether a secret exists, never its value.
#[tauri::command]
pub(crate) fn secret_status(state: State<'_, AppState>, secret_ref: String) -> bool {
    state.secrets.is_set(&secret_ref)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct OAuthStatus {
    app_configured: bool,
    connected: bool,
}

#[tauri::command]
pub(crate) fn oauth_status(state: State<'_, AppState>) -> OAuthStatus {
    OAuthStatus {
        app_configured: state.secrets.is_set(oauth::CLIENT_ID_REF) && state.secrets.is_set(oauth::CLIENT_SECRET_REF),
        connected: state.oauth.is_connected(),
    }
}

/// What a cancelled sign-in fails with (the UI shows it as a plain note, not an error).
const SIGN_IN_CANCELLED: &str = "Sign-in cancelled";

/// How long a sign-in waits for the browser before giving up (the UI says so, and can cancel sooner).
const OAUTH_WAIT: Duration = Duration::from_secs(300);

/// Stops a sign-in that's waiting for the browser; it fails with "Sign-in cancelled".
#[tauri::command]
pub(crate) fn oauth_cancel(state: State<'_, AppState>) {
    state.oauth_cancel.notify_waiters();
}

/// Runs the 3LO sign-in in the system browser, then fills in cloudIds for OAuth sites.
/// Returns the Atlassian sites the account can access.
#[tauri::command]
pub(crate) async fn oauth_connect(app: AppHandle, state: State<'_, AppState>) -> Result<Vec<String>, String> {
    // Listening for Cancel from the start, so a click while the browser opens isn't lost. It
    // covers only the wait for the browser: once the code is back, the exchange runs to the end,
    // so a late cancel can't leave tokens stored behind a "cancelled" message.
    let cancelled = state.oauth_cancel.notified();
    tokio::pin!(cancelled);
    cancelled.as_mut().enable();
    let browser = async {
        let st = oauth::random_state()?;
        let url = state.oauth.authorize_url(&st)?;
        let listener = oauth::bind_callback().await?;
        app.opener().open_url(url, None::<&str>).map_err(|e| format!("Could not open the browser: {e}"))?;
        oauth::wait_for_callback(listener, &st, OAUTH_WAIT).await
    };
    let code = tokio::select! {
        code = browser => code?,
        () = cancelled => return Err(SIGN_IN_CANCELLED.to_owned()),
    };
    state.oauth.exchange_code(&code).await?;
    let resources = state.oauth.accessible_resources().await?;
    forget_oauth_sites(&state);
    for site in state.config.get().sites.iter().filter(|s| matches!(s.auth, SiteAuth::OAuth3lo)) {
        if let Some(id) = oauth::cloud_id_for(&site.base_url, &resources) {
            state.config.set_cloud_id(&site.base_url, &id)?;
        }
    }
    log::info!("OAuth connected ({} accessible sites)", resources.len());
    Ok(resources.into_iter().map(|r| r.url).collect())
}

#[tauri::command]
pub(crate) async fn oauth_disconnect(state: State<'_, AppState>) -> Result<(), String> {
    state.oauth.disconnect().await?;
    forget_oauth_sites(&state);
    Ok(())
}
