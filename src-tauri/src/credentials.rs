const SERVICE: &str = "lat.phoson.desktop.remote";
const MAX_SERVER_LEN: usize = 2048;
const MAX_TOKEN_LEN: usize = 16 * 1024;

fn entry(server: &str) -> Result<keyring::Entry, String> {
    if server.trim().is_empty() || server.len() > MAX_SERVER_LEN {
        return Err("Invalid credential request".into());
    }
    keyring::Entry::new(SERVICE, server).map_err(|_| "Secure credential storage unavailable".into())
}

#[tauri::command]
pub fn remote_token_get(server: String) -> Result<Option<String>, String> {
    match entry(&server)?.get_password() {
        Ok(token) if token.len() <= MAX_TOKEN_LEN => Ok(Some(token)),
        Ok(_) => Err("Secure credential storage unavailable".into()),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(_) => Err("Secure credential storage unavailable".into()),
    }
}

#[tauri::command]
pub fn remote_token_set(server: String, token: String) -> Result<(), String> {
    if token.is_empty() || token.len() > MAX_TOKEN_LEN {
        return Err("Invalid credential request".into());
    }
    entry(&server)?.set_password(&token)
        .map_err(|_| "Secure credential storage unavailable".into())
}

#[tauri::command]
pub fn remote_token_delete(server: String) -> Result<(), String> {
    match entry(&server)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(_) => Err("Secure credential storage unavailable".into()),
    }
}
