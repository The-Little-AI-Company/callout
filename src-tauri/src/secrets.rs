//! Keys in the OS credential store (PRD F16). On Windows this is the
//! Credential Manager. The webview asks for a key only when it builds a
//! client; nothing is written to the settings file.

use keyring::Entry;

fn entry(service: &str, name: &str) -> Result<Entry, String> {
    Entry::new(service, name).map_err(|e| format!("{e}"))
}

pub fn get(service: &str, name: &str) -> Result<Option<String>, String> {
    match entry(service, name)?.get_password() {
        Ok(v) => Ok(Some(v)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(format!("{e}")),
    }
}

pub fn set(service: &str, name: &str, value: &str) -> Result<(), String> {
    entry(service, name)?.set_password(value).map_err(|e| format!("{e}"))
}

pub fn delete(service: &str, name: &str) -> Result<(), String> {
    match entry(service, name)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(format!("{e}")),
    }
}
