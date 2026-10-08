mod cache;
mod commands;
mod config;
mod jira;
mod secrets;

use cache::TicketCache;
use commands::AppState;
use config::{ConfigFile, ConfigHandle};
use jira::http::{http_client, HttpBackend};
use jira::mock::MockBackend;
use jira::oauth::OAuth;
use secrets::{CachedSecrets, Keychain, SecretStore};
use std::sync::Arc;
use tauri::Manager;

/// The mobile entry point: runs the app, logging why it stopped if it fails.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    if let Err(e) = try_run() {
        log::error!("Domino stopped: {e}");
    }
}

/// Runs the app until it quits.
///
/// # Errors
///
/// When Tauri fails to start or run the app.
#[allow(
    clippy::large_stack_frames,
    clippy::exit,
    reason = "tauri::generate_context! embeds the app's assets and config, and Tauri's event loop exits the process; both vary by platform"
)]
pub fn try_run() -> tauri::Result<()> {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(tauri_plugin_log::Builder::default().level(log::LevelFilter::Info).build())?;
            }
            // In-app updates: checks the latest GitHub release's latest.json, verified against the
            // public key in tauri.conf.json (plugins.updater).
            #[cfg(desktop)]
            app.handle().plugin(tauri_plugin_updater::Builder::new().build())?;
            let dir = app.path().app_config_dir()?;
            let config = Arc::new(ConfigHandle::load(ConfigFile::new(&dir)));
            log::info!("config: {}", dir.join("domino.config.json").display());
            if let Some(problem) = config.problem() {
                log::error!("config not loaded, starting empty: {problem}");
            }
            let secrets: Arc<dyn SecretStore> = Arc::new(CachedSecrets::new(Keychain));
            let http = http_client()?;
            let oauth = Arc::new(OAuth::new(http.clone(), Arc::clone(&secrets)));
            let http_backend = Arc::new(HttpBackend::new(http, Arc::clone(&secrets), Arc::clone(&oauth), Arc::clone(&config)));
            let cache = Arc::new(TicketCache::new(app.path().app_data_dir()?.join("ticket-cache"), Arc::clone(&secrets)));
            cache.prune(std::time::SystemTime::now());
            app.manage(AppState {
                config,
                secrets,
                oauth,
                mock: Arc::new(MockBackend::from_env()?),
                http: http_backend,
                cache,
                oauth_cancel: Arc::new(tokio::sync::Notify::new()),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_config,
            commands::save_config,
            commands::site_health,
            commands::fetch_by_jql,
            commands::fetch_epic,
            commands::config_status,
            commands::reload_config,
            commands::start_fresh_config,
            commands::reveal_config,
            commands::fetch_issue,
            commands::fetch_description,
            commands::fetch_remote_links,
            commands::fetch_link_types,
            commands::fetch_status_history,
            commands::fetch_statuses,
            commands::fetch_priorities,
            commands::cache_get,
            commands::cache_put,
            commands::cache_clear,
            commands::fetch_myself,
            commands::set_secret,
            commands::secret_status,
            commands::oauth_status,
            commands::oauth_connect,
            commands::oauth_cancel,
            commands::oauth_disconnect,
        ])
        .run(tauri::generate_context!())
}
