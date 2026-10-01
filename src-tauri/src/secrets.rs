//! Credentials live in the OS keychain (service "domino", account = secretRef).
//! An environment variable with the same name overrides the keychain, for development.
//! Secret values are never logged and never returned to the webview.
//!
//! On macOS, every keychain *read* of an item can show an "allow access?" prompt, so the app
//! wraps the keychain in [`CachedSecrets`]: each secret is read at most once per launch, and
//! "is it set?" checks look at item metadata only.

use crate::config::is_secret_ref;
use std::collections::HashMap;
use std::sync::Mutex;

const SERVICE: &str = "domino";

pub trait SecretStore: Send + Sync {
    fn get(&self, name: &str) -> Result<String, String>;
    /// An empty value deletes the secret.
    fn set(&self, name: &str, value: &str) -> Result<(), String>;
    /// Whether the secret exists. Implementations should avoid reading the value when they can.
    fn is_set(&self, name: &str) -> bool {
        self.get(name).is_ok()
    }
}

/// Direct access to the OS keychain; no caching.
pub struct Keychain;

fn entry(secret_ref: &str) -> Result<keyring::Entry, String> {
    if !is_secret_ref(secret_ref) {
        return Err("secretRef must be UPPER_SNAKE_CASE".into());
    }
    keyring::Entry::new(SERVICE, secret_ref).map_err(|e| format!("Keychain unavailable: {e}"))
}

fn env_override(name: &str) -> Option<String> {
    std::env::var(name).ok().filter(|v| !v.is_empty())
}

impl SecretStore for Keychain {
    fn get(&self, secret_ref: &str) -> Result<String, String> {
        if let Some(v) = env_override(secret_ref) {
            return Ok(v);
        }
        entry(secret_ref)?.get_password().map_err(|e| match e {
            keyring::Error::NoEntry => format!("No secret stored for {secret_ref}. Set it in Settings."),
            other => format!("Could not read {secret_ref} from the keychain: {other}"),
        })
    }

    fn set(&self, secret_ref: &str, value: &str) -> Result<(), String> {
        if value.is_empty() {
            return entry(secret_ref)?
                .delete_credential()
                .or_else(|e| if matches!(e, keyring::Error::NoEntry) { Ok(()) } else { Err(e) })
                .map_err(|e| format!("Could not clear {secret_ref}: {e}"));
        }
        entry(secret_ref)?.set_password(value).map_err(|e| format!("Could not store {secret_ref}: {e}"))
    }

    fn is_set(&self, secret_ref: &str) -> bool {
        env_override(secret_ref).is_some() || (is_secret_ref(secret_ref) && keychain_item_exists(secret_ref))
    }
}

/// Looks the item up by attributes only. Reading attributes doesn't need the item's access
/// control list, so unlike `get_password` it never triggers the macOS access prompt.
#[cfg(target_os = "macos")]
fn keychain_item_exists(account: &str) -> bool {
    use security_framework::item::{ItemClass, ItemSearchOptions, Limit};
    ItemSearchOptions::new()
        .class(ItemClass::generic_password())
        .service(SERVICE)
        .account(account)
        .load_attributes(true)
        .limit(Limit::Max(1))
        .search()
        .is_ok_and(|found| !found.is_empty())
}

/// Windows Credential Manager and Secret Service don't prompt per read, so reading is fine.
#[cfg(not(target_os = "macos"))]
fn keychain_item_exists(account: &str) -> bool {
    entry(account).and_then(|e| e.get_password().map_err(|e| e.to_string())).is_ok()
}

/// Read-through, write-through cache: each secret is fetched from `inner` at most once per
/// process. Writes and deletes update the cache, so it never serves a stale value written here.
pub struct CachedSecrets<S> {
    inner: S,
    values: Mutex<HashMap<String, String>>,
}

impl<S: SecretStore> CachedSecrets<S> {
    pub fn new(inner: S) -> Self {
        Self { inner, values: Mutex::new(HashMap::new()) }
    }

    fn values(&self) -> std::sync::MutexGuard<'_, HashMap<String, String>> {
        self.values.lock().unwrap_or_else(|p| p.into_inner())
    }
}

impl<S: SecretStore> SecretStore for CachedSecrets<S> {
    fn get(&self, name: &str) -> Result<String, String> {
        if let Some(v) = self.values().get(name) {
            return Ok(v.clone());
        }
        // Not cached: read outside the lock so a slow keychain prompt doesn't block other secrets.
        let v = self.inner.get(name)?;
        // A `set` that landed while we were reading is newer than what we read: keep it.
        Ok(self.values().entry(name.to_string()).or_insert(v).clone())
    }

    fn set(&self, name: &str, value: &str) -> Result<(), String> {
        self.inner.set(name, value)?;
        let mut values = self.values();
        if value.is_empty() {
            values.remove(name);
        } else {
            values.insert(name.to_string(), value.to_string());
        }
        Ok(())
    }

    fn is_set(&self, name: &str) -> bool {
        self.values().contains_key(name) || self.inner.is_set(name)
    }
}

/// In-memory store for tests.
#[cfg(test)]
#[derive(Default)]
pub struct MemorySecrets(Mutex<HashMap<String, String>>);

#[cfg(test)]
impl SecretStore for MemorySecrets {
    fn get(&self, name: &str) -> Result<String, String> {
        self.0.lock().unwrap().get(name).cloned().ok_or_else(|| format!("No secret stored for {name}"))
    }
    fn set(&self, name: &str, value: &str) -> Result<(), String> {
        let mut m = self.0.lock().unwrap();
        if value.is_empty() {
            m.remove(name);
        } else {
            m.insert(name.into(), value.into());
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    /// Counts value reads separately from existence checks, like the macOS keychain distinguishes them.
    #[derive(Default)]
    struct CountingStore {
        inner: MemorySecrets,
        value_reads: AtomicUsize,
    }

    impl SecretStore for CountingStore {
        fn get(&self, name: &str) -> Result<String, String> {
            self.value_reads.fetch_add(1, Ordering::SeqCst);
            self.inner.get(name)
        }
        fn set(&self, name: &str, value: &str) -> Result<(), String> {
            self.inner.set(name, value)
        }
        fn is_set(&self, name: &str) -> bool {
            self.inner.0.lock().unwrap().contains_key(name) // metadata-only: not a value read
        }
    }

    fn cached_with(name: &str, value: &str) -> CachedSecrets<CountingStore> {
        let store = CountingStore::default();
        store.inner.set(name, value).unwrap();
        CachedSecrets::new(store)
    }

    #[test]
    fn reads_each_secret_from_the_store_once() {
        let s = cached_with("A_TOKEN", "t1");
        for _ in 0..5 {
            assert_eq!(s.get("A_TOKEN").unwrap(), "t1");
        }
        assert_eq!(s.inner.value_reads.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn writes_go_through_and_replace_the_cached_value() {
        let s = cached_with("A_TOKEN", "t1");
        s.get("A_TOKEN").unwrap();
        s.set("A_TOKEN", "t2").unwrap();
        assert_eq!(s.get("A_TOKEN").unwrap(), "t2");
        assert_eq!(s.inner.inner.get("A_TOKEN").unwrap(), "t2", "written through to the store");
        assert_eq!(s.inner.value_reads.load(Ordering::SeqCst), 1, "no re-read after our own write");
    }

    #[test]
    fn deleting_clears_the_cache() {
        let s = cached_with("A_TOKEN", "t1");
        s.get("A_TOKEN").unwrap();
        s.set("A_TOKEN", "").unwrap();
        assert!(s.get("A_TOKEN").is_err());
        assert!(!s.is_set("A_TOKEN"));
    }

    #[test]
    fn is_set_never_reads_the_value() {
        let s = cached_with("A_TOKEN", "t1");
        assert!(s.is_set("A_TOKEN"));
        assert!(!s.is_set("B_TOKEN"));
        assert_eq!(s.inner.value_reads.load(Ordering::SeqCst), 0);
    }

    /// A store whose reads block until released, to race a write against an in-flight read.
    struct GatedStore {
        value: Mutex<String>,
        entered: std::sync::mpsc::SyncSender<()>,
        release: Mutex<std::sync::mpsc::Receiver<()>>,
    }
    impl SecretStore for GatedStore {
        fn get(&self, _: &str) -> Result<String, String> {
            let snapshot = self.value.lock().unwrap().clone(); // what the read "sees"
            self.entered.send(()).unwrap();
            self.release.lock().unwrap().recv().unwrap(); // e.g. waiting on an access prompt
            Ok(snapshot)
        }
        fn set(&self, _: &str, v: &str) -> Result<(), String> {
            *self.value.lock().unwrap() = v.to_string();
            Ok(())
        }
    }

    #[test]
    fn a_write_during_a_slow_read_wins() {
        let (entered_tx, entered_rx) = std::sync::mpsc::sync_channel(1);
        let (release_tx, release_rx) = std::sync::mpsc::channel();
        let cache = std::sync::Arc::new(CachedSecrets::new(GatedStore {
            value: Mutex::new("old".into()),
            entered: entered_tx,
            release: Mutex::new(release_rx),
        }));
        let reader = {
            let cache = cache.clone();
            std::thread::spawn(move || cache.get("A_TOKEN").unwrap())
        };
        entered_rx.recv().unwrap(); // the read is in flight with "old"
        cache.set("A_TOKEN", "new").unwrap(); // a newer token is saved meanwhile
        release_tx.send(()).unwrap();
        reader.join().unwrap();
        assert_eq!(cache.get("A_TOKEN").unwrap(), "new");
    }

    #[test]
    fn missing_secrets_are_not_cached_as_missing() {
        let s = CachedSecrets::new(CountingStore::default());
        assert!(s.get("A_TOKEN").is_err());
        s.inner.inner.set("A_TOKEN", "late").unwrap(); // e.g. stored by another code path
        assert_eq!(s.get("A_TOKEN").unwrap(), "late");
    }
}

/// Manual check against the real macOS keychain: `cargo test keychain_probe -- --ignored`
/// after `security add-generic-password -s domino -a DOMINO_PROBE -w x -T ""` (no trusted apps).
/// It must return without an "allow access?" prompt.
#[cfg(all(test, target_os = "macos"))]
#[test]
#[ignore]
fn keychain_probe_exists_without_prompt() {
    assert!(Keychain.is_set("DOMINO_PROBE"));
    assert!(!Keychain.is_set("DOMINO_PROBE_MISSING"));
}
