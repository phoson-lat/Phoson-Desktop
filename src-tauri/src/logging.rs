//! Registro de acciones (telemetría **local**) del frontend.
//!
//! El front envía lotes de eventos ya serializados como JSON (una línea por
//! evento); aquí se anexan a un archivo **JSONL rotativo** en el directorio de
//! logs de la app (`%APPDATA%/com.phoson.desktop/logs` en Windows).
//!
//! Nada sale del equipo: es un registro local pensado para analizar la calidad
//! de la app (acciones, errores, tiempos). El usuario puede abrir la carpeta
//! desde Ajustes (`log_open_dir`) o vaciar el buffer del front.

use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};

use serde_json::json;
use tauri::{AppHandle, Manager};
use tauri_plugin_opener::OpenerExt;

/// Tamaño máximo por archivo antes de rotar (8 MiB).
const MAX_BYTES: u64 = 8 * 1024 * 1024;
/// Archivos rotados que se conservan (además del activo).
const MAX_ARCHIVES: usize = 4;

const ACTIVE: &str = "phoson-desktop.jsonl";

fn log_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_log_dir()
        .map_err(|e| format!("no hay directorio de logs: {e}"))?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn log_file(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(log_dir(app)?.join(ACTIVE))
}

/// Rota el archivo activo si supera `MAX_BYTES` y poda los archivos más viejos.
fn rotate_if_needed(dir: &Path, active: &Path) -> std::io::Result<()> {
    let size = fs::metadata(active).map(|m| m.len()).unwrap_or(0);
    if size < MAX_BYTES {
        return Ok(());
    }
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let archived = dir.join(format!("phoson-desktop.{stamp}.jsonl"));
    fs::rename(active, archived)?;

    // Poda: conserva solo los `MAX_ARCHIVES` más recientes.
    let mut archives: Vec<PathBuf> = fs::read_dir(dir)?
        .filter_map(|e| e.ok().map(|e| e.path()))
        .filter(|p| {
            p.file_name()
                .and_then(|n| n.to_str())
                .map(|n| n.starts_with("phoson-desktop.") && n.ends_with(".jsonl"))
                .unwrap_or(false)
        })
        .collect();
    archives.sort();
    while archives.len() > MAX_ARCHIVES {
        let oldest = archives.remove(0);
        let _ = fs::remove_file(oldest);
    }
    Ok(())
}

/// Anexa un lote de eventos (una cadena JSON por elemento) al log activo.
///
/// Cada elemento se sanea a **una sola línea** (los saltos se sustituyen) para
/// que el JSONL no se corrompa si un mensaje de error trae saltos de línea.
#[tauri::command]
pub fn log_append(app: AppHandle, lines: Vec<String>) -> Result<(), String> {
    if lines.is_empty() {
        return Ok(());
    }
    let dir = log_dir(&app)?;
    let path = dir.join(ACTIVE);
    rotate_if_needed(&dir, &path).map_err(|e| e.to_string())?;

    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(|e| e.to_string())?;
    for line in lines {
        let clean = line.replace(['\n', '\r'], " ");
        writeln!(file, "{clean}").map_err(|e| e.to_string())?;
    }
    file.flush().map_err(|e| e.to_string())?;
    Ok(())
}

/// Ruta absoluta del archivo de log activo (para mostrarla/copiarla en Ajustes).
#[tauri::command]
pub fn log_path(app: AppHandle) -> Result<String, String> {
    Ok(log_file(&app)?.to_string_lossy().to_string())
}

/// Abre la carpeta de logs en el explorador del sistema.
#[tauri::command]
pub fn log_open_dir(app: AppHandle) -> Result<(), String> {
    let dir = log_dir(&app)?;
    app.opener()
        .open_path(dir.to_string_lossy().to_string(), None::<String>)
        .map_err(|e| e.to_string())
}

/// Claves que pueden contener conversación, rutas privadas o credenciales.
/// El informe conserva tiempos, estados y errores, pero nunca sus payloads.
fn diagnostic_drop_key(key: &str) -> bool {
    let key = key.to_ascii_lowercase();
    key.contains("api_key")
        || key.contains("apikey")
        || key.contains("secret")
        || key.contains("token")
        || key.contains("password")
        || key.contains("authorization")
        || key.contains("credential")
        || matches!(
            key.as_str(),
            "params"
                | "text"
                | "content"
                | "prompt"
                | "task"
                | "command"
                | "args"
                | "result"
                | "message"
                | "value"
                | "el"
                | "history"
                | "uploads"
                | "images"
                | "path"
                | "workspace"
                | "cwd"
                | "href"
                | "session"
                | "sessionid"
        )
}

fn diagnostic_value(value: &serde_json::Value, depth: usize) -> serde_json::Value {
    use serde_json::Value;
    match value {
        Value::Object(map) if depth < 4 => {
            let mut clean = serde_json::Map::new();
            for (key, value) in map {
                if !diagnostic_drop_key(key) {
                    clean.insert(key.clone(), diagnostic_value(value, depth + 1));
                }
            }
            Value::Object(clean)
        }
        Value::Array(items) if depth < 4 => Value::Array(
            items
                .iter()
                .take(20)
                .map(|item| diagnostic_value(item, depth + 1))
                .collect(),
        ),
        Value::Object(_) | Value::Array(_) => Value::String("[omitted]".to_string()),
        Value::String(text) => Value::String(text.chars().take(500).collect()),
        _ => value.clone(),
    }
}

/// Reduce una línea JSONL a metadatos seguros para compartir con soporte.
fn diagnostic_event(line: &str) -> Option<serde_json::Value> {
    let event: serde_json::Value = serde_json::from_str(line).ok()?;
    let source = event.as_object()?;
    let mut clean = serde_json::Map::new();
    for key in ["ts", "iso", "level", "src", "event", "up"] {
        if let Some(value) = source.get(key) {
            clean.insert(key.to_string(), value.clone());
        }
    }
    if let Some(data) = source.get("data") {
        clean.insert("data".to_string(), diagnostic_value(data, 0));
    }
    Some(serde_json::Value::Object(clean))
}

/// Exporta un informe solo cuando el usuario pulsa «Exportar diagnóstico» y
/// elige destino. No sube nada: genera un JSON local con versión/plataforma y los
/// últimos 1000 eventos, sin prompts, respuestas, rutas, adjuntos ni secretos.
#[tauri::command]
pub fn diagnostics_export(app: AppHandle, path: String) -> Result<(), String> {
    let target = PathBuf::from(path);
    if target.as_os_str().is_empty() || target.is_dir() {
        return Err("elige un archivo de destino válido".to_string());
    }
    let dir = log_dir(&app)?;
    let mut files: Vec<PathBuf> = fs::read_dir(&dir)
        .map_err(|e| e.to_string())?
        .filter_map(|entry| entry.ok().map(|entry| entry.path()))
        .filter(|path| {
            path.file_name()
                .and_then(|name| name.to_str())
                .map(|name| name.starts_with("phoson-desktop.") && name.ends_with(".jsonl"))
                .unwrap_or(false)
        })
        .collect();
    files.sort();

    let mut lines = Vec::new();
    for file in files {
        let content = fs::read_to_string(file).map_err(|e| e.to_string())?;
        lines.extend(content.lines().filter_map(diagnostic_event));
    }
    let events: Vec<serde_json::Value> = lines.split_off(lines.len().saturating_sub(1000));
    let package = app.package_info();
    let report = json!({
        "format": "phoson-desktop-diagnostics/v1",
        "app": {
            "name": package.name,
            "version": package.version.to_string(),
            "os": std::env::consts::OS,
            "arch": std::env::consts::ARCH,
        },
        "events": events,
    });
    let bytes = serde_json::to_vec_pretty(&report).map_err(|e| e.to_string())?;
    fs::write(target, bytes).map_err(|e| e.to_string())
}

/// Anexa un evento (formato compatible con el del frontend) al log activo.
///
/// Uso **interno de Rust**: traza el ciclo de vida del sidecar (arranque,
/// stderr, caída) en el mismo archivo que las acciones del frontend.
pub fn event(app: &AppHandle, level: &str, src: &str, event: &str, data: serde_json::Value) {
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    let line = json!({
        "ts": ts,
        "level": level,
        "src": src,
        "event": event,
        "data": data,
    })
    .to_string();
    let _ = log_append(app.clone(), vec![line]);
}

#[cfg(test)]
mod tests {
    use super::diagnostic_event;

    #[test]
    fn diagnostic_report_drops_secrets_conversation_and_private_paths() {
        let line = serde_json::json!({
            "ts": 1,
            "level": "error",
            "src": "rpc",
            "event": "rpc",
            "data": {
                "method": "turn.run",
                "ok": false,
                "ms": 42,
                "params": { "text": "contenido privado", "secrets": { "openai": "sk-secret" } },
                "workspace": "/home/user/private",
                "error": "connection failed"
            }
        })
        .to_string();
        let clean = diagnostic_event(&line).unwrap();
        assert_eq!(clean["data"]["method"], "turn.run");
        assert_eq!(clean["data"]["ms"], 42);
        assert!(clean["data"].get("params").is_none());
        assert!(clean["data"].get("workspace").is_none());
        assert!(!clean.to_string().contains("sk-secret"));
        assert!(!clean.to_string().contains("contenido privado"));
    }

    #[test]
    fn diagnostic_report_redacts_sensitive_fields_at_any_depth() {
        let line = serde_json::json!({
            "event": "config.set",
            "data": { "nested": { "apiKey": "secret", "provider": "openai" } }
        })
        .to_string();
        let clean = diagnostic_event(&line).unwrap();
        assert!(clean["data"]["nested"].get("apiKey").is_none());
        assert_eq!(clean["data"]["nested"]["provider"], "openai");
    }
}
