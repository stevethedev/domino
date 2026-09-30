//! Credentials live in the OS keychain (service "domino", account = secretRef).
//! An environment variable with the same name overrides the keychain, for development.
//! Secret values are never logged and never returned to the webview.

use crate::config::is_secret_ref;

const SERVICE: &str = "domino";

pub trait SecretStore: Send + Sync {
    fn get(&self, name: &str) -> Result<String, String>;
    /// An empty value deletes the secret.
    fn set(&self, name: &str, value: &str) -> Result<(), String>;
    fn is_set(&self, name: &str) -> bool {
        self.get(name).is_ok()
    }
}

pub struct Keychain;

fn entry(secret_ref: &str) -> Result<keyring::Entry, String> {
    if !is_secret_ref(secret_ref) {
        return Err("secretRef must be UPPER_SNAKE_CASE".into());
    }
    keyring::Entry::new(SERVICE, secret_ref).map_err(|e| format!("Keychain unavailable: {e}"))
}

impl SecretStore for Keychain {
    fn get(&self, secret_ref: &str) -> Result<String, String> {
        if let Ok(v) = std::env::var(secret_ref) {
            if !v.is_empty() {
                return Ok(v);
            }
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
}

/// In-memory store for tests.
#[cfg(test)]
#[derive(Default)]
pub struct MemorySecrets(std::sync::Mutex<std::collections::HashMap<String, String>>);

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
