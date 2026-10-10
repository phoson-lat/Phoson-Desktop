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
