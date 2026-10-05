//! The last tickets loaded for each scope, kept on disk so opening the app or a view shows them
//! right away while a fresh load runs.
//!
//! - One file per scope in `ticket-cache/`, named by the SHA-256 of the scope key (never by
//!   anything the webview sends), so a key can't reach outside the folder.
//! - Each file is AES-256-GCM encrypted with a random key kept in the OS keychain
//!   (`DOMINO_CACHE_KEY`), with the file name as associated data: a file copied off the machine,
//!   or renamed to another scope's name, doesn't decrypt.
//! - Each site's data carries a fingerprint of the backend, address and account it was loaded
//!   with; it's only returned while the config still matches, and it's purged when the account
//!   may have changed. Entries from another app version are discarded.
//! - At most 12 scopes (least recently viewed dropped first), nothing older than 30 days.
//!
//! Ticket content is never logged. Read problems are cache misses, never errors.

use crate::config::{write_atomic, BackendKind, DominoConfig, SiteAuth};
use crate::secrets::SecretStore;
use base64::Engine;
use ring::aead::{Aad, LessSafeKey, Nonce, UnboundKey, AES_256_GCM, NONCE_LEN};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

/// The keychain entry holding the cache key (base64 of 32 random bytes).
pub(crate) const KEY_REF: &str = "DOMINO_CACHE_KEY";
const APP_VERSION: &str = env!("CARGO_PKG_VERSION");
const MAX_SCOPES: usize = 12;
const MAX_AGE: Duration = Duration::from_secs(30 * 24 * 60 * 60);
const MAX_ENTRY_BYTES: usize = 32 << 20;
const EXTENSION: &str = "bin";

/// One site's data as the webview sends it, with the account it was loaded with.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PutSite {
    site_id: String,
    base_url: String,
    auth: SiteAuth,
    /// When the data was fetched, in epoch milliseconds.
    taken_at: u64,
    data: Value,
}

/// A scope's last load, as the webview sends it to be cached.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PutEntry {
    scope_key: String,
    backend: BackendKind,
    sites: Vec<PutSite>,
    errors: Value,
}

/// A cached scope, as returned to the webview.
#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CachedScope {
    scope_key: String,
    sites: Vec<CachedSite>,
    errors: Value,
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CachedSite {
    site_id: String,
    taken_at: u64,
    data: Value,
}

/// The decrypted contents of a cache file.
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Stored {
    app_version: String,
    scope_key: String,
    sites: Vec<StoredSite>,
    errors: Value,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredSite {
    site_id: String,
    fingerprint: String,
    taken_at: u64,
    data: Value,
}

/// Whether the cache key could be used this launch.
#[derive(Debug)]
enum KeyState {
    Ready(Box<LessSafeKey>),
    /// The keychain wouldn't give the key (locked, access denied): nothing is cached this launch.
    Disabled,
}

pub(crate) struct TicketCache {
    dir: PathBuf,
    secrets: Arc<dyn SecretStore>,
    /// Resolved on first use, so launching never prompts for the keychain by itself. The lock also
    /// serializes file access.
    key: Mutex<Option<KeyState>>,
    /// When the cache was last cleared or had sites purged (epoch ms, set under the lock). Data
    /// fetched before then is never written, so a write prepared before a Clear (or before an
    /// account change) can't bring back what it removed.
    invalidated_at: AtomicU64,
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().flat_map(|b| [char::from_digit(u32::from(b >> 4), 16), char::from_digit(u32::from(b & 0xf), 16)]).flatten().collect()
}

fn sha256_hex(text: &str) -> String {
    hex(&Sha256::digest(text.as_bytes()))
}

/// The cache file name for a scope: only hex digits, whatever the key contains.
fn file_name(scope_key: &str) -> String {
    format!("{}.{EXTENSION}", sha256_hex(scope_key))
}

/// Identifies the data source a site's data came from: backend, address and account.
fn fingerprint(backend: BackendKind, base_url: &str, auth: &SiteAuth) -> String {
    sha256_hex(&serde_json::to_string(&(backend, base_url, auth)).unwrap_or_default())
}

/// The fingerprint a site would have if it were loaded now.
fn current_fingerprint(cfg: &DominoConfig, site_id: &str) -> Option<String> {
    cfg.site(site_id).map(|s| fingerprint(cfg.backend, &s.base_url, &s.auth))
}

fn epoch_ms(t: SystemTime) -> u64 {
    t.duration_since(UNIX_EPOCH).map_or(0, |d| u64::try_from(d.as_millis()).unwrap_or(u64::MAX))
}

fn expired(taken_at: u64, now: SystemTime) -> bool {
    let max_age_ms = u64::try_from(MAX_AGE.as_millis()).unwrap_or(u64::MAX);
    epoch_ms(now).saturating_sub(taken_at) > max_age_ms
}

fn random_bytes<const N: usize>() -> Result<[u8; N], String> {
    let mut buf = [0_u8; N];
    getrandom::fill(&mut buf).map_err(|e| format!("no randomness available: {e}"))?;
    Ok(buf)
}

fn new_key() -> Result<([u8; 32], LessSafeKey), String> {
    let bytes = random_bytes::<32>()?;
    let key = UnboundKey::new(&AES_256_GCM, &bytes).map_err(|e| format!("bad key: {e}"))?;
    Ok((bytes, LessSafeKey::new(key)))
}

fn key_from_base64(text: &str) -> Option<LessSafeKey> {
    let bytes = base64::engine::general_purpose::STANDARD.decode(text.trim()).ok()?;
    UnboundKey::new(&AES_256_GCM, &bytes).ok().map(LessSafeKey::new)
}

/// `nonce ‖ ciphertext ‖ tag`, with `aad` authenticated alongside.
fn seal(key: &LessSafeKey, aad: &str, plain: Vec<u8>) -> Result<Vec<u8>, String> {
    let nonce = random_bytes::<NONCE_LEN>()?;
    let mut sealed = plain;
    key.seal_in_place_append_tag(Nonce::assume_unique_for_key(nonce), Aad::from(aad.as_bytes()), &mut sealed)
        .map_err(|e| format!("could not encrypt: {e}"))?;
    let mut out = nonce.to_vec();
    out.extend_from_slice(&sealed);
    Ok(out)
}

fn open(key: &LessSafeKey, aad: &str, bytes: &[u8]) -> Option<Vec<u8>> {
    let (nonce, sealed) = bytes.split_at_checked(NONCE_LEN)?;
    let nonce = Nonce::try_assume_unique_for_key(nonce).ok()?;
    let mut buf = sealed.to_vec();
    key.open_in_place(nonce, Aad::from(aad.as_bytes()), &mut buf).ok().map(|plain| plain.to_vec())
}

fn remove(path: &Path) {
    if let Err(e) = fs::remove_file(path) {
        if e.kind() != std::io::ErrorKind::NotFound {
            log::warn!("ticket cache: could not delete {}: {e}", path.display());
        }
    }
}

fn modified(path: &Path) -> Option<SystemTime> {
    fs::metadata(path).and_then(|m| m.modified()).ok()
}

/// Marks a file as just viewed (the LRU order is by modification time).
fn touch(path: &Path, when: SystemTime) {
    if let Err(e) = fs::File::options().write(true).open(path).and_then(|f| f.set_modified(when)) {
        log::warn!("ticket cache: could not update {}: {e}", path.display());
    }
}

impl TicketCache {
    pub(crate) fn new(dir: PathBuf, secrets: Arc<dyn SecretStore>) -> Self {
        Self { dir, secrets, key: Mutex::new(None), invalidated_at: AtomicU64::new(0) }
    }

    fn lock(&self) -> MutexGuard<'_, Option<KeyState>> {
        self.key.lock().unwrap_or_else(PoisonError::into_inner)
    }

    fn files(&self) -> Vec<PathBuf> {
        fs::read_dir(&self.dir).map_or_else(|_| Vec::new(), |entries| entries.filter_map(|e| e.ok().map(|e| e.path())).collect())
    }

    fn delete_all(&self) {
        for path in self.files() {
            remove(&path);
        }
    }

    /// Deletes every file and stores a new key. If the keychain won't take the new key, the old
    /// one is removed instead (a new one is made next launch), so nothing sealed with it stays
    /// readable; the cache is disabled until then. Errs only when even that removal fails.
    fn rotate_key(&self) -> Result<KeyState, String> {
        self.delete_all();
        let stored = new_key()
            .and_then(|(bytes, key)| self.secrets.set(KEY_REF, &base64::engine::general_purpose::STANDARD.encode(bytes)).map(|()| key));
        match stored {
            Ok(key) => Ok(KeyState::Ready(Box::new(key))),
            Err(e) => {
                log::warn!("ticket cache disabled: {e}");
                self.secrets
                    .set(KEY_REF, "")
                    .map(|()| KeyState::Disabled)
                    .map_err(|removal| format!("{e}; the old key couldn't be removed either: {removal}"))
            }
        }
    }

    /// The key, read from the keychain (or created) on first use.
    fn key<'a>(&self, state: &'a mut Option<KeyState>) -> Option<&'a LessSafeKey> {
        let resolved = state.get_or_insert_with(|| {
            let rotate = || {
                self.rotate_key().unwrap_or_else(|e| {
                    log::warn!("ticket cache: {e}");
                    KeyState::Disabled
                })
            };
            if !self.secrets.is_set(KEY_REF) {
                return rotate();
            }
            match self.secrets.get(KEY_REF) {
                Ok(text) => key_from_base64(&text).map_or_else(rotate, |key| KeyState::Ready(Box::new(key))),
                Err(e) => {
                    // Files sealed with a key we can't read are useless; don't leave them behind.
                    log::warn!("ticket cache disabled: {e}");
                    self.delete_all();
                    KeyState::Disabled
                }
            }
        });
        match resolved {
            KeyState::Ready(key) => Some(key),
            KeyState::Disabled => None,
        }
    }

    fn read(key: &LessSafeKey, path: &Path, name: &str) -> Option<Stored> {
        let bytes = fs::read(path).ok()?;
        let plain = open(key, name, &bytes)?;
        serde_json::from_slice(&plain).ok()
    }

    fn write(key: &LessSafeKey, path: &Path, name: &str, stored: &Stored) -> Result<(), String> {
        let plain = serde_json::to_vec(stored).map_err(|e| e.to_string())?;
        if plain.len() > MAX_ENTRY_BYTES {
            return Err(format!("entry is {} MB; the limit is {} MB", plain.len() >> 20, MAX_ENTRY_BYTES >> 20));
        }
        write_atomic(path, &seal(key, name, plain)?)
    }

    /// The cached tickets for a scope: only the sites still configured the same way they were
    /// loaded, fetched within the last 30 days, by this app version. Marks the scope as viewed.
    pub(crate) fn get(&self, scope_key: &str, cfg: &DominoConfig, now: SystemTime) -> Option<CachedScope> {
        let mut state = self.lock();
        let key = self.key(&mut state)?;
        let name = file_name(scope_key);
        let path = self.dir.join(&name);
        if !path.exists() {
            return None;
        }
        let Some(mut stored) = Self::read(key, &path, &name).filter(|s| s.app_version == APP_VERSION && s.scope_key == scope_key) else {
            remove(&path);
            return None;
        };
        let before = stored.sites.len();
        stored.sites.retain(|s| !expired(s.taken_at, now) && current_fingerprint(cfg, &s.site_id).as_deref() == Some(&s.fingerprint));
        if stored.sites.is_empty() {
            remove(&path);
            return None;
        }
        if stored.sites.len() < before {
            if let Err(e) = Self::write(key, &path, &name, &stored) {
                log::warn!("ticket cache: {e}");
            }
        }
        touch(&path, now);
        drop(state);
        Some(CachedScope {
            scope_key: stored.scope_key,
            sites: stored.sites.into_iter().map(|s| CachedSite { site_id: s.site_id, taken_at: s.taken_at, data: s.data }).collect(),
            errors: stored.errors,
        })
    }

    /// Caches a scope's load. Sites are kept only if they were loaded with the configuration that's
    /// current now (a Settings change during the load could have switched accounts), and fetched
    /// after the last clear or purge (a write that raced one mustn't bring back what it removed).
    pub(crate) fn put(&self, entry: PutEntry, cfg: &DominoConfig, now: SystemTime) -> Result<(), String> {
        let mut state = self.lock();
        let invalidated_at = self.invalidated_at.load(Ordering::SeqCst);
        let sites: Vec<StoredSite> = entry
            .sites
            .into_iter()
            .filter(|s| s.taken_at > invalidated_at)
            .filter_map(|s| {
                let fp = fingerprint(entry.backend, &s.base_url, &s.auth);
                (current_fingerprint(cfg, &s.site_id).as_deref() == Some(&fp)).then_some(StoredSite {
                    site_id: s.site_id,
                    fingerprint: fp,
                    taken_at: s.taken_at,
                    data: s.data,
                })
            })
            .collect();
        if sites.is_empty() {
            return Ok(());
        }
        let Some(key) = self.key(&mut state) else { return Ok(()) };
        let name = file_name(&entry.scope_key);
        let stored = Stored { app_version: APP_VERSION.to_owned(), scope_key: entry.scope_key, sites, errors: entry.errors };
        Self::write(key, &self.dir.join(&name), &name, &stored)?;
        drop(state);
        self.prune(now);
        Ok(())
    }

    /// Deletes every cached scope and replaces the key, so copies of old files can't be read.
    /// Errs when the old key may still be readable (the keychain would neither replace nor remove it).
    pub(crate) fn clear(&self) -> Result<(), String> {
        let mut state = self.lock();
        self.invalidated_at.store(epoch_ms(SystemTime::now()), Ordering::SeqCst);
        let (key, result) = match self.rotate_key() {
            Ok(key) => (key, Ok(())),
            Err(e) => (KeyState::Disabled, Err(format!("the cache key couldn't be replaced (the cached tickets were deleted): {e}"))),
        };
        *state = Some(key);
        drop(state);
        result
    }

    /// Drops the cached data of every site `stale` matches, wherever it's cached.
    pub(crate) fn forget_sites(&self, is_stale: impl Fn(&str) -> bool) {
        let mut state = self.lock();
        self.invalidated_at.store(epoch_ms(SystemTime::now()), Ordering::SeqCst);
        let Some(key) = self.key(&mut state) else { return };
        for path in self.files() {
            let Some(name) = path.file_name().and_then(|n| n.to_str()).map(str::to_owned) else { continue };
            if path.extension().and_then(|e| e.to_str()) != Some(EXTENSION) {
                continue;
            }
            let Some(mut stored) = Self::read(key, &path, &name) else {
                remove(&path);
                continue;
            };
            let before = stored.sites.len();
            stored.sites.retain(|s| !is_stale(&s.site_id));
            if stored.sites.is_empty() {
                remove(&path);
            } else if stored.sites.len() < before {
                // Rewriting isn't viewing: keep the file's place in the LRU order.
                let viewed = modified(&path);
                if let Err(e) = Self::write(key, &path, &name, &stored) {
                    log::warn!("ticket cache: {e}");
                    remove(&path);
                } else if let Some(viewed) = viewed {
                    touch(&path, viewed);
                }
            }
        }
    }

    /// After a Settings save: drops sites that were removed or now load from another backend,
    /// address or account.
    pub(crate) fn invalidate_changed(&self, old: &DominoConfig, new: &DominoConfig) {
        let changed = |id: &str| current_fingerprint(old, id) != current_fingerprint(new, id);
        if old.sites.iter().any(|s| changed(&s.id)) {
            self.forget_sites(changed);
        }
    }

    /// Deletes leftover temp files, scopes not viewed for 30 days, and all but the 12 most
    /// recently viewed. Works on file times only, so it never needs the key.
    pub(crate) fn prune(&self, now: SystemTime) {
        let state = self.lock();
        let mut entries: Vec<(PathBuf, SystemTime)> = Vec::new();
        for path in self.files() {
            match (path.extension().and_then(|e| e.to_str()), modified(&path)) {
                (Some(EXTENSION), Some(viewed)) if now.duration_since(viewed).unwrap_or_default() <= MAX_AGE => {
                    entries.push((path, viewed));
                }
                _ => remove(&path),
            }
        }
        entries.sort_by(|a, b| b.1.cmp(&a.1));
        for (path, _) in entries.iter().skip(MAX_SCOPES) {
            remove(path);
        }
        drop(state);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::{SiteConfig, SEED_CONFIG};
    use crate::secrets::MemorySecrets;
    use serde_json::json;

    const DAY: Duration = Duration::from_secs(24 * 60 * 60);

    fn config() -> DominoConfig {
        let mut cfg: DominoConfig = serde_json::from_str(SEED_CONFIG).unwrap();
        cfg.backend = BackendKind::Jira;
        cfg
    }

    fn site_of<'a>(cfg: &'a DominoConfig, id: &str) -> &'a SiteConfig {
        cfg.site(id).unwrap()
    }

    fn put_site(cfg: &DominoConfig, id: &str, taken_at: u64, summary: &str) -> PutSite {
        let s = site_of(cfg, id);
        PutSite {
            site_id: id.to_owned(),
            base_url: s.base_url.clone(),
            auth: s.auth.clone(),
            taken_at,
            data: json!({ "siteId": id, "issues": [{ "key": "X-1", "fields": { "summary": summary } }] }),
        }
    }

    fn entry(cfg: &DominoConfig, scope_key: &str, sites: Vec<PutSite>) -> PutEntry {
        PutEntry { scope_key: scope_key.to_owned(), backend: cfg.backend, sites, errors: json!([]) }
    }

    struct Fixture {
        _dir: tempfile::TempDir,
        path: PathBuf,
        secrets: Arc<MemorySecrets>,
        cache: TicketCache,
    }

    fn fixture() -> Fixture {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("ticket-cache");
        let secrets = Arc::new(MemorySecrets::default());
        let cache = TicketCache::new(path.clone(), Arc::clone(&secrets) as Arc<dyn SecretStore>);
        Fixture { _dir: dir, path, secrets, cache }
    }

    fn now() -> SystemTime {
        SystemTime::now()
    }

    fn ms(t: SystemTime) -> u64 {
        epoch_ms(t)
    }

    fn site_ids(scope: &CachedScope) -> Vec<&str> {
        scope.sites.iter().map(|s| s.site_id.as_str()).collect()
    }

    fn cache_files(f: &Fixture) -> Vec<PathBuf> {
        fs::read_dir(&f.path).map(|d| d.map(|e| e.unwrap().path()).collect()).unwrap_or_default()
    }

    #[test]
    fn file_names_are_hex_digests_whatever_the_scope_key() {
        for key in ["../../etc/passwd", "a/b\\c", "nul\0byte", &"ü".repeat(500), ""] {
            let name = file_name(key);
            let (stem, ext) = name.split_once('.').unwrap();
            assert_eq!(ext, EXTENSION);
            assert_eq!(stem.len(), 64);
            assert!(stem.chars().all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase()), "{name}");
        }
    }

    #[test]
    fn round_trips_and_stores_nothing_readable() {
        let f = fixture();
        let cfg = config();
        let t = ms(now());
        f.cache.put(entry(&cfg, "scope-1", vec![put_site(&cfg, "acme", t, "Very secret summary")]), &cfg, now()).unwrap();
        let got = f.cache.get("scope-1", &cfg, now()).unwrap();
        assert_eq!(got.scope_key, "scope-1");
        assert_eq!(
            got.sites,
            vec![CachedSite { site_id: "acme".into(), taken_at: t, data: put_site(&cfg, "acme", t, "Very secret summary").data }]
        );
        let files = cache_files(&f);
        assert_eq!(files.len(), 1);
        let bytes = fs::read(&files[0]).unwrap();
        assert!(!bytes.windows(6).any(|w| w == b"secret"), "plaintext on disk");
        assert!(f.cache.get("scope-2", &cfg, now()).is_none());
    }

    #[cfg(unix)]
    #[test]
    fn files_are_private_to_the_user() {
        use std::os::unix::fs::PermissionsExt;
        let f = fixture();
        let cfg = config();
        f.cache.put(entry(&cfg, "s", vec![put_site(&cfg, "acme", ms(now()), "x")]), &cfg, now()).unwrap();
        let mode = fs::metadata(&cache_files(&f)[0]).unwrap().permissions().mode();
        assert_eq!(mode & 0o777, 0o600);
    }

    #[test]
    fn a_tampered_swapped_or_foreign_file_is_a_miss_and_is_deleted() {
        let cfg = config();
        // Tampered: flip a byte.
        let f = fixture();
        f.cache.put(entry(&cfg, "s", vec![put_site(&cfg, "acme", ms(now()), "x")]), &cfg, now()).unwrap();
        let path = f.path.join(file_name("s"));
        let mut bytes = fs::read(&path).unwrap();
        let last = bytes.len() - 1;
        bytes[last] ^= 1;
        fs::write(&path, bytes).unwrap();
        assert!(f.cache.get("s", &cfg, now()).is_none());
        assert!(!path.exists());

        // Swapped: another scope's file under this scope's name.
        let f = fixture();
        f.cache.put(entry(&cfg, "other", vec![put_site(&cfg, "acme", ms(now()), "x")]), &cfg, now()).unwrap();
        fs::rename(f.path.join(file_name("other")), f.path.join(file_name("s"))).unwrap();
        assert!(f.cache.get("s", &cfg, now()).is_none());

        // Foreign: sealed with a different key (another machine, or before Clear rotated it).
        let f = fixture();
        f.cache.put(entry(&cfg, "s", vec![put_site(&cfg, "acme", ms(now()), "x")]), &cfg, now()).unwrap();
        let copy = fs::read(f.path.join(file_name("s"))).unwrap();
        f.cache.clear().unwrap();
        fs::create_dir_all(&f.path).unwrap();
        fs::write(f.path.join(file_name("s")), copy).unwrap();
        assert!(f.cache.get("s", &cfg, now()).is_none());
        assert!(cache_files(&f).is_empty());
    }

    #[test]
    fn creates_the_key_on_first_use_and_wipes_files_left_without_one() {
        let f = fixture();
        let cfg = config();
        fs::create_dir_all(&f.path).unwrap();
        fs::write(f.path.join(file_name("orphan")), b"sealed with a lost key").unwrap();
        assert!(f.cache.get("orphan", &cfg, now()).is_none());
        f.secrets.get(KEY_REF).unwrap(); // created
        assert!(cache_files(&f).is_empty());
    }

    /// A keychain that has the key but won't hand it over (locked, or access denied).
    #[derive(Debug)]
    struct DeniedSecrets;
    impl SecretStore for DeniedSecrets {
        fn get(&self, _: &str) -> Result<String, String> {
            Err("User denied access".into())
        }
        fn set(&self, _: &str, _: &str) -> Result<(), String> {
            Err("User denied access".into())
        }
        fn is_set(&self, _: &str) -> bool {
            true
        }
    }

    #[test]
    fn an_unreadable_key_disables_the_cache_and_wipes_it() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("ticket-cache");
        fs::create_dir_all(&path).unwrap();
        fs::write(path.join(file_name("s")), b"x").unwrap();
        let cache = TicketCache::new(path.clone(), Arc::new(DeniedSecrets));
        let cfg = config();
        assert!(cache.get("s", &cfg, now()).is_none());
        cache.put(entry(&cfg, "s", vec![put_site(&cfg, "acme", ms(now()), "x")]), &cfg, now()).unwrap();
        assert_eq!(fs::read_dir(&path).unwrap().count(), 0);
    }

    #[test]
    fn clear_deletes_everything_and_rotates_the_key() {
        let f = fixture();
        let cfg = config();
        f.cache.put(entry(&cfg, "s", vec![put_site(&cfg, "acme", ms(now()), "x")]), &cfg, now()).unwrap();
        let key_before = f.secrets.get(KEY_REF).unwrap();
        f.cache.clear().unwrap();
        assert!(cache_files(&f).is_empty());
        assert_ne!(f.secrets.get(KEY_REF).unwrap(), key_before);
        assert!(f.cache.get("s", &cfg, now()).is_none());
    }

    #[test]
    fn another_app_version_is_a_miss() {
        let f = fixture();
        let cfg = config();
        let mut state = f.cache.lock();
        let key = f.cache.key(&mut state).unwrap();
        let name = file_name("s");
        let stored = Stored { app_version: "0.0.1".into(), scope_key: "s".into(), sites: Vec::new(), errors: json!([]) };
        TicketCache::write(key, &f.path.join(&name), &name, &stored).unwrap();
        drop(state);
        assert!(f.cache.get("s", &cfg, now()).is_none());
        assert!(cache_files(&f).is_empty());
    }

    #[test]
    fn returns_only_sites_still_configured_as_they_were_loaded() {
        let f = fixture();
        let cfg = config();
        let t = ms(now());
        f.cache.put(entry(&cfg, "s", vec![put_site(&cfg, "acme", t, "a"), put_site(&cfg, "partner", t, "p")]), &cfg, now()).unwrap();

        let mut moved = cfg.clone();
        moved.sites[0].base_url = "https://moved.atlassian.net".into();
        assert_eq!(site_ids(&f.cache.get("s", &moved, now()).unwrap()), ["partner"]);
        // The dropped site is gone for good, even if the address changes back.
        assert_eq!(site_ids(&f.cache.get("s", &cfg, now()).unwrap()), ["partner"]);

        let mut other_account = cfg;
        other_account.sites[1].auth = SiteAuth::ApiToken { email: "me@partner.example".into(), secret_ref: "DOMINO_P".into() };
        assert!(f.cache.get("s", &other_account, now()).is_none());
        assert!(cache_files(&f).is_empty());
    }

    #[test]
    fn switching_backend_misses_every_site() {
        let f = fixture();
        let cfg = config();
        f.cache.put(entry(&cfg, "s", vec![put_site(&cfg, "acme", ms(now()), "a")]), &cfg, now()).unwrap();
        let mock = DominoConfig { backend: BackendKind::Mock, ..cfg };
        assert!(f.cache.get("s", &mock, now()).is_none());
    }

    #[test]
    fn put_skips_sites_loaded_with_a_configuration_that_has_since_changed() {
        let f = fixture();
        let cfg = config();
        let mut changed = cfg.clone();
        changed.sites[0].base_url = "https://moved.atlassian.net".into();
        let t = ms(now());
        // Loaded with `cfg`, but Settings changed acme before the load finished.
        f.cache.put(entry(&cfg, "s", vec![put_site(&cfg, "acme", t, "a"), put_site(&cfg, "partner", t, "p")]), &changed, now()).unwrap();
        assert_eq!(site_ids(&f.cache.get("s", &changed, now()).unwrap()), ["partner"]);
        f.cache.put(entry(&cfg, "only-acme", vec![put_site(&cfg, "acme", t, "a")]), &changed, now()).unwrap();
        assert!(!f.path.join(file_name("only-acme")).exists());
    }

    #[test]
    fn data_older_than_30_days_is_a_miss() {
        let f = fixture();
        let cfg = config();
        let old = ms(now() - 31 * DAY);
        f.cache
            .put(entry(&cfg, "s", vec![put_site(&cfg, "acme", old, "a"), put_site(&cfg, "partner", ms(now()), "p")]), &cfg, now())
            .unwrap();
        assert_eq!(site_ids(&f.cache.get("s", &cfg, now()).unwrap()), ["partner"]);
    }

    #[test]
    fn keeps_the_12_most_recently_viewed_scopes() {
        let f = fixture();
        let cfg = config();
        let start = now() - DAY;
        for i in 0..12 {
            f.cache.put(entry(&cfg, &format!("s{i}"), vec![put_site(&cfg, "acme", ms(now()), "a")]), &cfg, start).unwrap();
            touch(&f.path.join(file_name(&format!("s{i}"))), start + Duration::from_secs(i * 60));
        }
        // Viewing the oldest makes it the most recent; the next put evicts s1 instead.
        assert!(f.cache.get("s0", &cfg, now()).is_some());
        f.cache.put(entry(&cfg, "s12", vec![put_site(&cfg, "acme", ms(now()), "a")]), &cfg, now()).unwrap();
        assert_eq!(cache_files(&f).len(), 12);
        assert!(f.path.join(file_name("s0")).exists());
        assert!(!f.path.join(file_name("s1")).exists());
    }

    #[test]
    fn prune_drops_scopes_not_viewed_for_30_days_and_temp_files() {
        let f = fixture();
        let cfg = config();
        f.cache.put(entry(&cfg, "old", vec![put_site(&cfg, "acme", ms(now()), "a")]), &cfg, now()).unwrap();
        f.cache.put(entry(&cfg, "new", vec![put_site(&cfg, "acme", ms(now()), "a")]), &cfg, now()).unwrap();
        touch(&f.path.join(file_name("old")), now() - 31 * DAY);
        fs::write(f.path.join("leftover.bin.tmp"), b"x").unwrap();
        f.cache.prune(now());
        assert_eq!(cache_files(&f), vec![f.path.join(file_name("new"))]);
    }

    #[test]
    fn forget_sites_drops_their_data_everywhere_and_keeps_lru_order() {
        let f = fixture();
        let cfg = config();
        let t = ms(now());
        f.cache.put(entry(&cfg, "both", vec![put_site(&cfg, "acme", t, "a"), put_site(&cfg, "partner", t, "p")]), &cfg, now()).unwrap();
        f.cache.put(entry(&cfg, "acme-only", vec![put_site(&cfg, "acme", t, "a")]), &cfg, now()).unwrap();
        let viewed = now() - DAY;
        touch(&f.path.join(file_name("both")), viewed);
        f.cache.forget_sites(|id| id == "acme");
        assert!(!f.path.join(file_name("acme-only")).exists());
        assert_eq!(modified(&f.path.join(file_name("both"))), Some(viewed));
        assert_eq!(site_ids(&f.cache.get("both", &cfg, now()).unwrap()), ["partner"]);
    }

    #[test]
    fn invalidate_changed_drops_removed_or_reconfigured_sites_only() {
        let f = fixture();
        let cfg = config();
        let t = ms(now());
        f.cache.put(entry(&cfg, "s", vec![put_site(&cfg, "acme", t, "a"), put_site(&cfg, "partner", t, "p")]), &cfg, now()).unwrap();

        let mut relabelled = cfg.clone();
        relabelled.sites[0].label = "Renamed".into();
        f.cache.invalidate_changed(&cfg, &relabelled);
        assert_eq!(site_ids(&f.cache.get("s", &relabelled, now()).unwrap()), ["acme", "partner"]);

        let mut removed = cfg.clone();
        removed.sites.retain(|s| s.id != "partner");
        f.cache.invalidate_changed(&cfg, &removed);
        assert_eq!(site_ids(&f.cache.get("s", &cfg, now()).unwrap()), ["acme"]);
    }

    #[test]
    fn a_write_of_data_fetched_before_a_clear_or_purge_stores_nothing() {
        let f = fixture();
        let cfg = config();
        let before = ms(now() - Duration::from_secs(5));
        f.cache.clear().unwrap();
        f.cache.put(entry(&cfg, "s", vec![put_site(&cfg, "acme", before, "a")]), &cfg, now()).unwrap();
        assert!(f.cache.get("s", &cfg, now()).is_none(), "cleared tickets came back");
        let after = ms(now() + Duration::from_secs(5));
        f.cache.put(entry(&cfg, "s", vec![put_site(&cfg, "acme", after, "a")]), &cfg, now()).unwrap();
        assert!(f.cache.get("s", &cfg, now()).is_some(), "data fetched after the clear caches normally");

        f.cache.forget_sites(|id| id == "partner");
        f.cache.put(entry(&cfg, "t", vec![put_site(&cfg, "partner", before, "p")]), &cfg, now()).unwrap();
        assert!(f.cache.get("t", &cfg, now()).is_none(), "purged tickets came back");
    }

    /// A keychain that has a key but refuses to store new values; it can delete when `allow_delete`.
    struct WriteFailingSecrets {
        inner: MemorySecrets,
        allow_delete: bool,
    }

    impl WriteFailingSecrets {
        fn with_key(allow_delete: bool) -> Self {
            let inner = MemorySecrets::default();
            let (bytes, _) = new_key().unwrap();
            inner.set(KEY_REF, &base64::engine::general_purpose::STANDARD.encode(bytes)).unwrap();
            Self { inner, allow_delete }
        }
    }

    impl SecretStore for WriteFailingSecrets {
        fn get(&self, name: &str) -> Result<String, String> {
            self.inner.get(name)
        }
        fn set(&self, name: &str, value: &str) -> Result<(), String> {
            if value.is_empty() && self.allow_delete {
                return self.inner.set(name, value);
            }
            Err("Keychain is read-only".into())
        }
        fn is_set(&self, name: &str) -> bool {
            self.inner.get(name).is_ok()
        }
    }

    fn cache_with(secrets: Arc<WriteFailingSecrets>) -> (tempfile::TempDir, PathBuf, TicketCache) {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("ticket-cache");
        let cache = TicketCache::new(path.clone(), secrets as Arc<dyn SecretStore>);
        (dir, path, cache)
    }

    #[test]
    fn clear_deletes_the_old_key_when_a_new_one_cannot_be_stored() {
        let secrets = Arc::new(WriteFailingSecrets::with_key(true));
        let (_dir, path, cache) = cache_with(Arc::clone(&secrets));
        let cfg = config();
        cache.put(entry(&cfg, "s", vec![put_site(&cfg, "acme", ms(now()), "a")]), &cfg, now()).unwrap();
        cache.clear().unwrap(); // the old key is gone, so the clear did what it says
        assert!(secrets.get(KEY_REF).is_err(), "the old key is still in the keychain");
        assert_eq!(fs::read_dir(&path).unwrap().count(), 0);
    }

    #[test]
    fn clear_reports_when_the_old_key_can_be_neither_replaced_nor_removed() {
        let secrets = Arc::new(WriteFailingSecrets::with_key(false));
        let (_dir, path, cache) = cache_with(Arc::clone(&secrets));
        let cfg = config();
        cache.put(entry(&cfg, "s", vec![put_site(&cfg, "acme", ms(now()), "a")]), &cfg, now()).unwrap();
        let err = cache.clear().unwrap_err();
        assert!(err.contains("couldn't be replaced"), "{err}");
        assert_eq!(fs::read_dir(&path).unwrap().count(), 0, "the files are deleted all the same");
        cache.put(entry(&cfg, "s", vec![put_site(&cfg, "acme", ms(now()), "a")]), &cfg, now()).unwrap();
        assert_eq!(fs::read_dir(&path).unwrap().count(), 0, "nothing is cached with a key that can't be rotated");
    }

    #[test]
    fn rejects_entries_over_the_size_limit() {
        let f = fixture();
        let cfg = config();
        let mut big = put_site(&cfg, "acme", ms(now()), "a");
        big.data = json!("x".repeat(MAX_ENTRY_BYTES));
        assert!(f.cache.put(entry(&cfg, "s", vec![big]), &cfg, now()).is_err());
        assert!(cache_files(&f).iter().all(|p| p.extension().and_then(|e| e.to_str()) != Some("tmp")));
    }
}
