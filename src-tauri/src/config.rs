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
                    return Err(format!(
                        "Site \"{}\" can't use {} as its secretRef: Domino keeps its cache key there; pick another name",
                        s.id,
                        crate::cache::KEY_REF
                    ));
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
    /// Why the file couldn't be used, while the app runs on an empty config instead (see `load`).
    problem: Mutex<Option<String>>,
}

impl ConfigHandle {
    /// Loads the config file. If it can't be read or isn't valid, the app still starts, on an empty
    /// config (no sites, live Jira, so sample data never poses as the user's), and keeps the problem
    /// for the UI. The file itself is left alone, so a hand edit can be fixed and reloaded.
    pub(crate) fn load(file: ConfigFile) -> Self {
        let (config, problem) = match file.load() {
            Ok(c) => (c, None),
            Err(e) => (DominoConfig { sites: vec![], default_site_ids: vec![], backend: BackendKind::Jira }, Some(e)),
        };
        Self { file, current: Mutex::new(config), problem: Mutex::new(problem) }
    }

    /// Why the config file couldn't be used, if it couldn't.
    pub(crate) fn problem(&self) -> Option<String> {
        self.problem.lock().unwrap_or_else(std::sync::PoisonError::into_inner).clone()
    }

    pub(crate) fn path(&self) -> &Path {
        &self.file.path
    }

    /// Gives up on a config file that can't be used: moves it aside (`domino.config.broken.json`,
    /// or `-2`, `-3`… beside an earlier one, so no hand edit is ever lost) and writes an empty config
    /// in its place. Only while the file is unusable; if the write fails, the file is put back.
    pub(crate) fn start_fresh(&self) -> Result<DominoConfig, String> {
        // The config lock first (as reload takes it), so a reload or save can't slip in between.
        let mut current = self.current.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
        if self.problem().is_none() {
            return Err("The settings file is fine: nothing to replace".to_owned());
        }
        let path = &self.file.path;
        let aside = if path.exists() { Some(set_aside(path)?) } else { None };
        let empty = DominoConfig { sites: vec![], default_site_ids: vec![], backend: BackendKind::Jira };
        if let Err(e) = self.file.save(&empty) {
            if let Some(aside) = &aside {
                let _restored = fs::rename(aside, path); // best effort: the original stays findable either way
            }
            return Err(e);
        }
        empty.clone_into(&mut current);
        drop(current);
        *self.problem.lock().unwrap_or_else(std::sync::PoisonError::into_inner) = None;
        Ok(empty)
    }

    /// Reads the file again (after a hand fix): swaps it in, or says why it still can't be used.
    pub(crate) fn reload(&self) -> Result<DominoConfig, String> {
        // Held across the read and the swap, so a save from Settings can't land in between.
        let mut current = self.current.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
        // Only an existing file: a reload must never seed the sample sites as if this were a first run.
        let loaded = self.file.read_existing();
        let mut problem = self.problem.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
        match &loaded {
            Ok(next) => {
                next.clone_into(&mut current);
                *problem = None;
            }
            // Only while on the empty fallback: a good config that's still in use has no startup problem.
            Err(e) if problem.is_some() => *problem = Some(e.clone()),
            Err(_) => {}
        }
        drop(problem);
        drop(current);
        loaded
    }

    /// Test-only: loads without validation (lets sites point at plain-http mock servers).
    #[cfg(test)]
    pub(crate) fn load_unvalidated(file: ConfigFile) -> Result<Self, String> {
        let text = fs::read_to_string(&file.path).map_err(|e| e.to_string())?;
        let cfg = serde_json::from_str(&text).map_err(|e| e.to_string())?;
        Ok(Self { file, current: Mutex::new(cfg), problem: Mutex::new(None) })
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
        *self.problem.lock().unwrap_or_else(std::sync::PoisonError::into_inner) = None; // the file is good now
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

/// Moves `path` to the first free name beside it (`domino.config.broken.json`, then `-2`, `-3`…),
/// returning it. A hard link plus removal, so an existing file is never replaced, even one created
/// meanwhile; with every name taken, it's an error rather than an overwrite.
fn set_aside(path: &Path) -> Result<PathBuf, String> {
    let dir = path.parent().unwrap_or_else(|| Path::new("."));
    for n in 1..=1000 {
        let name = if n == 1 { "domino.config.broken.json".to_owned() } else { format!("domino.config.broken-{n}.json") };
        let aside = dir.join(name);
        match fs::hard_link(path, &aside) {
            Ok(()) => {
                fs::remove_file(path).map_err(|e| format!("Could not set the old file aside: {e}"))?;
                return Ok(aside);
            }
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {}
            Err(e) => return Err(format!("Could not set the old file aside: {e}")),
        }
    }
    Err("Could not set the old file aside: too many earlier ones; move some out of the folder".to_owned())
}

pub(crate) struct ConfigFile {
    path: PathBuf,
}

impl ConfigFile {
    pub(crate) fn new(dir: &Path) -> Self {
        Self { path: dir.join("domino.config.json") }
    }

    /// Reads an existing config file; a missing one is an error, never seeded (see `load`).
    pub(crate) fn read_existing(&self) -> Result<DominoConfig, String> {
        match fs::read_to_string(&self.path) {
            Ok(text) => {
                serde_json::from_str::<DominoConfig>(&text).map_err(|e| format!("{} is invalid: {e}", self.path.display()))?.validated()
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                Err(format!("{} was not found; saving in Settings creates it", self.path.display()))
            }
            Err(e) => Err(format!("Could not read {}: {e}", self.path.display())),
        }
    }

    /// Loads the config, seeding it from the bundled mock config on first run.
    pub(crate) fn load(&self) -> Result<DominoConfig, String> {
        if self.path.exists() {
            return self.read_existing();
        }
        let seed: DominoConfig = serde_json::from_str(SEED_CONFIG).map_err(|e| e.to_string())?;
        let seed = seed.validated()?;
        self.save(&seed)?;
        Ok(seed)
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
        assert!(err.contains("keeps its cache key there"), "unexpected error: {err}");
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
    fn a_broken_file_starts_empty_with_the_problem_and_is_left_alone() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("domino.config.json");
        fs::write(&path, "{ \"sites\": [ oops ] }").unwrap();
        let h = ConfigHandle::load(ConfigFile::new(dir.path()));
        assert!(h.get().sites.is_empty());
        assert_eq!(h.get().backend, BackendKind::Jira, "never shows the sample data as if it were the user's");
        assert!(h.problem().unwrap().contains("is invalid"));
        assert_eq!(fs::read_to_string(&path).unwrap(), "{ \"sites\": [ oops ] }", "a hand edit stays fixable");

        // Still broken: reload says why. Fixed: reload swaps it in.
        assert!(h.reload().unwrap_err().contains("is invalid"));
        fs::write(&path, SEED_CONFIG).unwrap();
        assert_eq!(h.reload().unwrap().sites.len(), 3);
        assert!(h.problem().is_none());
    }

    #[test]
    fn reloading_after_deleting_a_broken_file_never_seeds_sample_sites() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("domino.config.json");
        fs::write(&path, "broken").unwrap();
        let h = ConfigHandle::load(ConfigFile::new(dir.path()));
        fs::remove_file(&path).unwrap();
        assert!(h.reload().unwrap_err().contains("not found"));
        assert!(h.get().sites.is_empty(), "still the empty fallback, not the bundled sample sites");
        assert!(h.problem().is_some());
        assert!(!path.exists(), "reload doesn't write a seeded file either");
    }

    #[test]
    fn a_failed_reload_keeps_a_good_config_and_reports_no_startup_problem() {
        let dir = tempfile::tempdir().unwrap();
        let h = ConfigHandle::load(ConfigFile::new(dir.path())); // seeds a good file
        fs::write(dir.path().join("domino.config.json"), "broken").unwrap();
        assert!(h.reload().unwrap_err().contains("is invalid"));
        assert_eq!(h.get().sites.len(), 3, "the good config stays in use");
        assert!(h.problem().is_none(), "the app isn't running on the empty fallback");
    }

    #[test]
    fn starting_fresh_keeps_the_broken_file_aside_and_writes_an_empty_one() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("domino.config.json");
        fs::write(&path, "{ broken").unwrap();
        let h = ConfigHandle::load(ConfigFile::new(dir.path()));
        let fresh = h.start_fresh().unwrap();
        assert!(fresh.sites.is_empty());
        assert!(h.problem().is_none());
        assert_eq!(fs::read_to_string(dir.path().join("domino.config.broken.json")).unwrap(), "{ broken", "the hand edit is kept");
        assert!(ConfigFile::new(dir.path()).read_existing().unwrap().sites.is_empty(), "a valid, empty file replaces it");
    }

    #[test]
    fn starting_fresh_never_overwrites_an_earlier_broken_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("domino.config.json");
        fs::write(dir.path().join("domino.config.broken.json"), "first").unwrap();
        fs::write(&path, "second").unwrap();
        let h = ConfigHandle::load(ConfigFile::new(dir.path()));
        h.start_fresh().unwrap();
        assert_eq!(fs::read_to_string(dir.path().join("domino.config.broken.json")).unwrap(), "first");
        assert_eq!(fs::read_to_string(dir.path().join("domino.config.broken-2.json")).unwrap(), "second");
    }

    #[test]
    fn starting_fresh_refuses_a_good_config() {
        let dir = tempfile::tempdir().unwrap();
        let h = ConfigHandle::load(ConfigFile::new(dir.path())); // seeds a good file
        assert!(h.start_fresh().unwrap_err().contains("nothing to replace"));
        assert_eq!(h.get().sites.len(), 3, "the good config is untouched");
    }

    #[test]
    fn saving_from_settings_replaces_a_broken_file() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("domino.config.json"), "not json").unwrap();
        let h = ConfigHandle::load(ConfigFile::new(dir.path()));
        let saved = h.replace(seed()).unwrap();
        assert_eq!(saved.sites.len(), 3);
        assert!(h.problem().is_none());
        assert_eq!(ConfigFile::new(dir.path()).load().unwrap().sites.len(), 3);
    }

    #[test]
    fn handle_keeps_cloud_ids_across_ui_saves() {
        let dir = tempfile::tempdir().unwrap();
        let h = ConfigHandle::load(ConfigFile::new(dir.path()));
        h.set_cloud_id("https://partner.atlassian.net", "cloud-123").unwrap();
        let mut from_ui = h.get();
        from_ui.sites[1].cloud_id = None; // a UI that never saw the discovery
        from_ui.sites[1].label = "Partner Co".into();
        let saved = h.replace(from_ui).unwrap();
        assert_eq!(saved.sites[1].cloud_id.as_deref(), Some("cloud-123"));
        let reloaded = ConfigHandle::load(ConfigFile::new(dir.path()));
        assert_eq!(reloaded.site("partner").unwrap().cloud_id.as_deref(), Some("cloud-123"));
    }
}
