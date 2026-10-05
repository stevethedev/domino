//! Site configuration: serde model, validation, and atomic persistence to
//! `domino.config.json` in the app config directory. Secrets are never stored
//! here; `secretRef` only names a keychain entry.

use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

pub(crate) const SEED_CONFIG: &str = include_str!("../../fixtures/mock/config.json");

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type")]
pub(crate) enum SiteAuth {
    #[serde(rename = "apiToken", rename_all = "camelCase")]
    ApiToken { email: String, secret_ref: String },
    #[serde(rename = "oauth3lo")]
    OAuth3lo,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SiteConfig {
    pub id: String,
    pub label: String,
    pub base_url: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cloud_id: Option<String>,
    pub auth: SiteAuth,
    pub color: String,
    pub enabled: bool,
    /// Always `ANDed` onto every search on this site (e.g. `project = CHANGE`).
    /// Older configs called this `defaultJql`; it is read under either name.
    #[serde(default, skip_serializing_if = "Option::is_none", alias = "defaultJql")]
    pub base_jql: Option<String>,
}

/// Where Jira data comes from: bundled fixtures, or live Jira REST v3.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum BackendKind {
    #[default]
    Mock,
    Jira,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DominoConfig {
    pub sites: Vec<SiteConfig>,
    #[serde(default)]
    pub default_site_ids: Vec<String>,
    #[serde(default)]
    pub backend: BackendKind,
}

fn is_slug(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 40
        && s.chars().next().is_some_and(|c| c.is_ascii_lowercase() || c.is_ascii_digit())
        && s.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
}

pub(crate) fn is_secret_ref(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 100
        && s.chars().next().is_some_and(|c| c.is_ascii_uppercase())
        && s.chars().all(|c| c.is_ascii_uppercase() || c.is_ascii_digit() || c == '_')
}

fn is_hex_color(s: &str) -> bool {
    s.strip_prefix('#').is_some_and(|hex| hex.len() == 6 && hex.chars().all(|c| c.is_ascii_hexdigit()))
}

/// Canonical origin, e.g. `https://acme.atlassian.net`.
pub(crate) fn normalize_base_url(s: &str) -> Result<String, String> {
    let u = url::Url::parse(s.trim()).map_err(|e| format!("\"{s}\" is not a valid URL ({e})"))?;
    if u.scheme() != "https" {
        return Err(format!("\"{s}\" must use https"));
    }
    let host = u.host_str().filter(|h| h.contains('.')).ok_or_else(|| format!("\"{s}\" has no valid host"))?;
    if (u.path() != "/" && !u.path().is_empty()) || u.query().is_some() || u.fragment().is_some() {
        return Err(format!("\"{s}\" must not include a path"));
    }
    if !u.username().is_empty() || u.password().is_some() {
        return Err(format!("\"{s}\" must not include credentials"));
    }
    let host = host.to_lowercase();
    Ok(u.port().map_or_else(|| format!("https://{host}"), |p| format!("https://{host}:{p}")))
}

impl DominoConfig {
    /// Validates and normalizes (trims labels, canonicalizes URLs, drops unknown default ids).
    pub(crate) fn validated(mut self) -> Result<Self, String> {
        let mut ids = HashSet::new();
        let mut urls = HashSet::new();
        for s in &mut self.sites {
            if !is_slug(&s.id) {
                return Err(format!("Site id \"{}\" must be a lowercase slug", s.id));
            }
            if !ids.insert(s.id.clone()) {
                return Err(format!("Site id \"{}\" is used more than once", s.id));
            }
            s.label = s.label.trim().to_owned();
            if s.label.is_empty() || s.label.len() > 40 {
                return Err(format!("Site \"{}\" needs a label of 1-40 characters", s.id));
            }
            s.base_url = normalize_base_url(&s.base_url)?;
            if !urls.insert(s.base_url.clone()) {
                return Err(format!("Base URL {} is used by more than one site", s.base_url));
            }
            if !is_hex_color(&s.color) {
                return Err(format!("Site \"{}\" color must look like #7c3aed", s.id));
            }
            if let SiteAuth::ApiToken { email, secret_ref } = &s.auth {
                if !email.contains('@') {
                    return Err(format!("Site \"{}\" needs a valid email", s.id));
                }
                if !is_secret_ref(secret_ref) {
                    return Err(format!("Site \"{}\" secretRef must be UPPER_SNAKE_CASE", s.id));
                }
                // The keychain entry the ticket cache keeps its key in: a site token there would clobber it.
                if secret_ref == crate::cache::KEY_REF {
                    return Err(format!("Site \"{}\" secretRef {secret_ref} is reserved by Domino; pick another name", s.id));
                }
            }
        }
        self.default_site_ids.retain(|id| ids.contains(id));
        Ok(self)
    }

    pub(crate) fn site(&self, id: &str) -> Option<&SiteConfig> {
        self.sites.iter().find(|s| s.id == id)
    }
}

/// The live config plus its file, shared by commands and the HTTP backend.
pub(crate) struct ConfigHandle {
    file: ConfigFile,
    current: Mutex<DominoConfig>,
}

impl ConfigHandle {
    pub(crate) fn load(file: ConfigFile) -> Result<Self, String> {
        let current = Mutex::new(file.load()?);
        Ok(Self { file, current })
    }

    /// Test-only: loads without validation (lets sites point at plain-http mock servers).
    #[cfg(test)]
    pub(crate) fn load_unvalidated(file: ConfigFile) -> Result<Self, String> {
        let text = fs::read_to_string(&file.path).map_err(|e| e.to_string())?;
        let cfg = serde_json::from_str(&text).map_err(|e| e.to_string())?;
        Ok(Self { file, current: Mutex::new(cfg) })
    }

    pub(crate) fn get(&self) -> DominoConfig {
        self.current.lock().unwrap_or_else(std::sync::PoisonError::into_inner).clone()
    }

    pub(crate) fn site(&self, id: &str) -> Option<SiteConfig> {
        self.get().site(id).cloned()
    }

    /// Validates, persists, then swaps in the new config. Keeps any cloudIds the caller didn't know about.
    pub(crate) fn replace(&self, next: DominoConfig) -> Result<DominoConfig, String> {
        let mut guard = self.current.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
        let mut next = next.validated()?;
        for s in &mut next.sites {
            if s.cloud_id.is_none() {
                if let Some(old) = guard.site(&s.id).filter(|o| o.base_url == s.base_url) {
                    s.cloud_id = old.cloud_id.clone();
                }
            }
        }
        self.file.save(&next)?;
        *guard = next.clone();
        drop(guard); // held through the save, so the file and memory can't disagree
        Ok(next)
    }

    /// Records a discovered cloudId on every site with this base URL.
    pub(crate) fn set_cloud_id(&self, base_url: &str, cloud_id: &str) -> Result<(), String> {
        let mut guard = self.current.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
        let mut next = guard.clone();
        let mut changed = false;
        for s in next.sites.iter_mut().filter(|s| s.base_url == base_url) {
            if s.cloud_id.as_deref() != Some(cloud_id) {
                s.cloud_id = Some(cloud_id.to_owned());
                changed = true;
            }
        }
        if changed {
            self.file.save(&next)?;
            *guard = next;
        }
        drop(guard);
        Ok(())
    }
}

pub(crate) struct ConfigFile {
    path: PathBuf,
}

impl ConfigFile {
    pub(crate) fn new(dir: &Path) -> Self {
        Self { path: dir.join("domino.config.json") }
    }

    /// Loads the config, seeding it from the bundled mock config on first run.
    pub(crate) fn load(&self) -> Result<DominoConfig, String> {
        match fs::read_to_string(&self.path) {
            Ok(text) => {
                serde_json::from_str::<DominoConfig>(&text).map_err(|e| format!("{} is invalid: {e}", self.path.display()))?.validated()
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                let seed: DominoConfig = serde_json::from_str(SEED_CONFIG).map_err(|e| e.to_string())?;
                let seed = seed.validated()?;
                self.save(&seed)?;
                Ok(seed)
            }
            Err(e) => Err(format!("Could not read {}: {e}", self.path.display())),
        }
    }

    pub(crate) fn save(&self, config: &DominoConfig) -> Result<(), String> {
        let mut body = serde_json::to_string_pretty(config).map_err(|e| e.to_string())?;
        body.push('\n');
        write_atomic(&self.path, body.as_bytes()).map_err(|e| format!("Could not write config: {e}"))
    }
}

/// Writes `bytes` to a temp file next to `path` (readable by this user only, on unix), fsyncs,
/// then renames it over `path`, so readers see the old file or the new one, never a partial one.
pub(crate) fn write_atomic(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let dir = path.parent().ok_or("path has no parent")?;
    fs::create_dir_all(dir).map_err(|e| format!("could not create {}: {e}", dir.display()))?;
    let mut tmp = path.as_os_str().to_owned();
    tmp.push(".tmp");
    let tmp = PathBuf::from(tmp);
    {
        let mut options = fs::OpenOptions::new();
        options.write(true).create(true).truncate(true);
        #[cfg(unix)]
        std::os::unix::fs::OpenOptionsExt::mode(&mut options, 0o600);
        let mut f = options.open(&tmp).map_err(|e| e.to_string())?;
        f.write_all(bytes).map_err(|e| e.to_string())?;
        f.sync_all().map_err(|e| e.to_string())?;
    }
    fs::rename(&tmp, path).map_err(|e| format!("could not replace {}: {e}", path.display()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn seed() -> DominoConfig {
        serde_json::from_str(SEED_CONFIG).unwrap()
    }

    #[test]
    fn seed_config_is_valid_and_round_trips_camel_case() {
        let cfg = seed().validated().unwrap();
        assert_eq!(cfg.sites.len(), 3);
        let json = serde_json::to_value(&cfg).unwrap();
        assert_eq!(json["sites"][0]["baseUrl"], "https://acme.atlassian.net");
        assert_eq!(json["sites"][0]["auth"]["secretRef"], "DOMINO_ACME_TOKEN");
        assert_eq!(json["sites"][1]["auth"]["type"], "oauth3lo");
    }

    #[test]
    fn rejects_duplicates_bad_urls_and_bad_refs() {
        let mut c = seed();
        c.sites[1].id = "acme".into();
        assert!(c.validated().unwrap_err().contains("more than once"));

        let mut c = seed();
        c.sites[0].base_url = "http://acme.atlassian.net".into();
        assert!(c.validated().unwrap_err().contains("https"));

        let mut c = seed();
        c.sites[0].base_url = "https://acme.atlassian.net/jira".into();
        assert!(c.validated().unwrap_err().contains("path"));

        let mut c = seed();
        c.sites[1].base_url = "https://ACME.atlassian.net/".into();
        assert!(c.validated().unwrap_err().contains("more than one site"));

        let mut c = seed();
        c.sites[0].auth = SiteAuth::ApiToken { email: "a@b.c".into(), secret_ref: "lower".into() };
        assert!(c.validated().unwrap_err().contains("secretRef"));
    }

    #[test]
    fn reads_legacy_default_jql_as_base_jql() {
        let mut v: serde_json::Value = serde_json::from_str(SEED_CONFIG).unwrap();
        v["sites"][0].as_object_mut().unwrap().remove("baseJql");
        v["sites"][0]["defaultJql"] = "project = OLD".into();
        let cfg: DominoConfig = serde_json::from_value(v).unwrap();
        assert_eq!(cfg.sites[0].base_jql.as_deref(), Some("project = OLD"));
        let out = serde_json::to_value(&cfg).unwrap();
        assert_eq!(out["sites"][0]["baseJql"], "project = OLD");
        assert!(out["sites"][0].get("defaultJql").is_none());
    }

    #[test]
    fn rejects_the_reserved_cache_key_name_as_a_token_ref() {
        let mut c = seed();
        c.sites[0].auth = SiteAuth::ApiToken { email: "bot@acme.example".into(), secret_ref: crate::cache::KEY_REF.into() };
        let err = c.validated().unwrap_err();
        assert!(err.contains("reserved"), "{err}");
    }

    #[test]
    fn drops_unknown_default_ids() {
        let mut c = seed();
        c.default_site_ids.push("gone".into());
        assert_eq!(c.validated().unwrap().default_site_ids, vec!["acme", "partner"]);
    }

    #[test]
    fn seeds_on_first_load_and_saves_atomically() {
        let dir = tempfile::tempdir().unwrap();
        let file = ConfigFile::new(dir.path());
        let mut cfg = file.load().unwrap();
        assert!(dir.path().join("domino.config.json").exists());
        cfg.sites[0].label = "Acme Corp".into();
        file.save(&cfg).unwrap();
        assert_eq!(file.load().unwrap().sites[0].label, "Acme Corp");
        assert!(!dir.path().join("domino.config.json.tmp").exists());
    }

    #[test]
    fn backend_defaults_to_mock_and_round_trips() {
        let cfg = seed();
        assert_eq!(cfg.backend, BackendKind::Mock);
        let mut v = serde_json::to_value(&cfg).unwrap();
        assert_eq!(v["backend"], "mock");
        v["backend"] = "jira".into();
        assert_eq!(serde_json::from_value::<DominoConfig>(v).unwrap().backend, BackendKind::Jira);
    }

    #[test]
    fn handle_keeps_cloud_ids_across_ui_saves() {
        let dir = tempfile::tempdir().unwrap();
        let h = ConfigHandle::load(ConfigFile::new(dir.path())).unwrap();
        h.set_cloud_id("https://partner.atlassian.net", "cloud-123").unwrap();
        let mut from_ui = h.get();
        from_ui.sites[1].cloud_id = None; // a UI that never saw the discovery
        from_ui.sites[1].label = "Partner Co".into();
        let saved = h.replace(from_ui).unwrap();
        assert_eq!(saved.sites[1].cloud_id.as_deref(), Some("cloud-123"));
        let reloaded = ConfigHandle::load(ConfigFile::new(dir.path())).unwrap();
        assert_eq!(reloaded.site("partner").unwrap().cloud_id.as_deref(), Some("cloud-123"));
    }
}
