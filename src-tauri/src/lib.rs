mod commands;
mod config;
mod jira;
mod secrets;

use commands::AppState;
use config::{ConfigFile, ConfigHandle};
use jira::http::{http_client, HttpBackend};
use jira::mock::MockBackend;
use jira::oauth::OAuth;
use secrets::{CachedSecrets, Keychain, SecretStore};
use std::sync::Arc;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(tauri_plugin_log::Builder::default().level(log::LevelFilter::Info).build())?;
            }
            let dir = app.path().app_config_dir()?;
            let config = Arc::new(ConfigHandle::load(ConfigFile::new(&dir)).map_err(|e| -> Box<dyn std::error::Error> { e.into() })?);
            log::info!("config: {}", dir.join("domino.config.json").display());
            let secrets: Arc<dyn SecretStore> = Arc::new(CachedSecrets::new(Keychain));
            let http = http_client();
            let oauth = Arc::new(OAuth::new(http.clone(), secrets.clone()));
            let http_backend = Arc::new(HttpBackend::new(http, secrets.clone(), oauth.clone(), config.clone()));
            app.manage(AppState { config, secrets, oauth, mock: Arc::new(MockBackend::from_env()), http: http_backend });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_config,
            commands::save_config,
            commands::site_health,
            commands::fetch_by_jql,
            commands::fetch_epic,
            commands::fetch_issue,
            commands::fetch_remote_links,
            commands::fetch_link_types,
            commands::fetch_status_history,
            commands::fetch_statuses,
            commands::set_secret,
            commands::secret_status,
            commands::oauth_status,
            commands::oauth_connect,
            commands::oauth_disconnect,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Domino");
}
