//! Integración nativa: metadatos, apertura de enlaces externos en el navegador
//! del sistema (la webview no debe navegar fuera de la app) y bandeja del
//! sistema (tray) en Windows.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{LazyLock, RwLock};

use serde::Deserialize;
use tauri::menu::{Menu, MenuItem};
use tauri::{AppHandle, Manager, Wry};
use tauri_plugin_notification::NotificationExt;
use tauri_plugin_opener::OpenerExt;

/// Textos que la bandeja y las notificaciones nativas pintan **fuera** de la
/// webview, donde el i18n del front no llega.
///
/// El front los manda ya traducidos (`set_native_labels`) al arrancar y en cada
/// cambio de idioma. Los valores por defecto son el español con el que se
/// escribió la app: si el front falla o tarda, el menú nunca queda vacío.
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeLabels {
    pub tray_show: String,
    pub tray_hide: String,
    pub tray_quit: String,
    pub tooltip: String,
    pub notice_title: String,
    pub notice_body: String,
}

impl Default for NativeLabels {
    fn default() -> Self {
        Self {
            tray_show: "Mostrar Phoson".into(),
            tray_hide: "Enviar a la bandeja".into(),
            tray_quit: "Salir de Phoson".into(),
            tooltip: "Phoson Desktop".into(),
            notice_title: "Phoson sigue en la bandeja".into(),
            notice_body:
                "El agente sigue ejecutándose. Haz clic en el icono de la bandeja para volver."
                    .into(),
        }
    }
}

static LABELS: LazyLock<RwLock<NativeLabels>> = LazyLock::new(|| RwLock::new(NativeLabels::default()));

/// Copia de las etiquetas activas (para el aviso de bandeja, que se dispara
/// desde Rust y no puede pedírselas al front).
pub fn labels() -> NativeLabels {
    LABELS.read().map(|l| l.clone()).unwrap_or_default()
}

/// Menú de la bandeja con las etiquetas dadas. Se reconstruye entero al cambiar
/// de idioma (`TrayIcon::set_menu`) en vez de mutar cada item: es más simple y
/// no obliga a guardar los handles.
pub fn build_tray_menu(handle: &AppHandle, l: &NativeLabels) -> tauri::Result<Menu<Wry>> {
    let show = MenuItem::with_id(handle, "show", &l.tray_show, true, None::<&str>)?;
    let hide = MenuItem::with_id(handle, "hide", &l.tray_hide, true, None::<&str>)?;
    let quit = MenuItem::with_id(handle, "quit", &l.tray_quit, true, None::<&str>)?;
    Menu::with_items(handle, &[&show, &hide, &quit])
}

/// Idioma del sistema operativo (`sys-locale`: preferencias en macOS, idioma de
/// la UI en Windows, `LC_*` en Linux) o `None` si no se puede determinar.
///
/// Hace falta porque en macOS la webview **no** hereda el idioma del sistema si
/// el bundle no está localizado: `navigator.language` devuelve `en` aunque el
/// Mac esté en español. El front lo consulta antes que a la webview.
#[tauri::command]
pub fn system_locale() -> Option<String> {
    sys_locale::get_locale()
}

/// Aplica las etiquetas nativas traducidas (menú de bandeja, tooltip y aviso).
#[tauri::command]
pub fn set_native_labels(app: AppHandle, labels: NativeLabels) {
    if let Ok(mut current) = LABELS.write() {
        *current = labels.clone();
    }
    if let Some(tray) = app.tray_by_id("main") {
        if let Ok(menu) = build_tray_menu(&app, &labels) {
            let _ = tray.set_menu(Some(menu));
        }
        let _ = tray.set_tooltip(Some(labels.tooltip.as_str()));
    }
}

/// Si `true`, cerrar la ventana oculta a la bandeja en vez de salir.
/// Lo fija el front (`set_close_to_tray`) según la preferencia del usuario.
static CLOSE_TO_TRAY: AtomicBool = AtomicBool::new(true);

/// Aviso «sigue en la bandeja» solo la primera vez por ejecución.
static TRAY_HINT_SHOWN: AtomicBool = AtomicBool::new(false);

pub fn close_to_tray_enabled() -> bool {
    CLOSE_TO_TRAY.load(Ordering::Relaxed)
}

/// Muestra y enfoca la ventana principal (tray, comando del front).
pub fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

/// Oculta la ventana y avisa, una sola vez, de que la app sigue viva en la bandeja.
pub fn hide_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.hide();
    }
    if !TRAY_HINT_SHOWN.swap(true, Ordering::Relaxed) {
        let l = labels();
        let _ = app
            .notification()
            .builder()
            .title(l.notice_title)
            .body(l.notice_body)
            .show();
    }
}

/// Oculta la ventana a la bandeja (invocado desde el front: paleta de comandos,
/// ajustes…).
#[tauri::command]
pub fn hide_to_tray(app: AppHandle) {
    hide_main_window(&app);
}

/// Muestra la ventana principal (invocado desde el front).
#[tauri::command]
pub fn show_window(app: AppHandle) {
    show_main_window(&app);
}

/// Preferencia «cerrar minimiza a la bandeja» (localStorage del front).
#[tauri::command]
pub fn set_close_to_tray(enabled: bool) {
    CLOSE_TO_TRAY.store(enabled, Ordering::Relaxed);
}

#[tauri::command]
pub fn app_info() -> serde_json::Value {
    serde_json::json!({
        "name": "Phoson Desktop",
        "version": env!("CARGO_PKG_VERSION"),
    })
}

/// Abre una ruta local en el visor/aplicación por defecto del sistema.
///
/// Solo se permiten **archivos** con ruta **absoluta**: evita que un enlace del
/// modelo abra directorios o rutas relativas arbitrarias.
#[tauri::command]
pub fn open_path(app: AppHandle, path: String) -> Result<(), String> {
    use std::path::Path as StdPath;
    let candidate = StdPath::new(&path);
    if !candidate.is_absolute() || !candidate.is_file() {
        return Err(format!("ruta no válida: {path}"));
    }
    app.opener()
        .open_path(path, None::<String>)
        .map_err(|e| e.to_string())
}

/// Abre una URL en el navegador del sistema.
///
/// Solo se permiten esquemas seguros: un enlace del modelo (`https://…`) o de un
/// mensaje no debe poder lanzar `file://` ni comandos arbitrarios.
#[tauri::command]
pub fn open_url(app: AppHandle, url: String) -> Result<(), String> {
    let allowed = ["http://", "https://", "mailto:"];
    if !allowed.iter().any(|prefix| url.starts_with(prefix)) {
        return Err(format!("esquema no permitido: {url}"));
    }
    app.opener()
        .open_url(url, None::<String>)
        .map_err(|e| e.to_string())
}

/* ── Abrir el workspace: explorador de archivos y editores ─────────────── */

/// Abre una **carpeta** en el explorador de archivos del sistema.
///
/// A diferencia de `open_path` (solo archivos, para enlaces del modelo), esta
/// acción es explícita del usuario sobre su workspace, así que se permiten
/// directorios — pero solo con ruta absoluta.
#[tauri::command]
pub fn open_folder(app: AppHandle, path: String) -> Result<(), String> {
    let candidate = std::path::Path::new(&path);
    if !candidate.is_absolute() || !candidate.is_dir() {
        return Err(format!("ruta no válida: {path}"));
    }
    app.opener()
        .open_path(path, None::<String>)
        .map_err(|e| e.to_string())
}

/// Editor de código detectado en el equipo (para «Abrir en…» del front).
#[derive(serde::Serialize, Clone)]
pub struct EditorInfo {
    id: &'static str,
    name: &'static str,
}

/// Definición estática de un editor soportado. La lista es **cerrada**
/// (whitelist): el front solo envía el `id`, nunca una ruta de ejecutable.
struct EditorSpec {
    id: &'static str,
    name: &'static str,
    /// Nombres de binario a buscar en `PATH` (sin extensión en Windows).
    bins: &'static [&'static str],
    /// Rutas de instalación habituales, en orden de preferencia.
    well_known: fn() -> Vec<std::path::PathBuf>,
}

/// Une variables de entorno con sufijos relativos (`%LOCALAPPDATA%` + `…`).
fn env_paths(var: &str, suffixes: &[&str]) -> Vec<std::path::PathBuf> {
    std::env::var_os(var)
        .map(|base| {
            let base = std::path::PathBuf::from(base);
            suffixes.iter().map(|s| base.join(s)).collect()
        })
        .unwrap_or_default()
}

fn well_known_vscode() -> Vec<std::path::PathBuf> {
    #[cfg(windows)]
    {
        let mut v = env_paths(
            "LOCALAPPDATA",
            &[
                r"Programs\Microsoft VS Code\Code.exe",
                r"Programs\Microsoft VS Code\bin\code.cmd",
            ],
        );
        v.push(std::path::PathBuf::from(
            r"C:\Program Files\Microsoft VS Code\bin\code.cmd",
        ));
        v
    }
    #[cfg(target_os = "macos")]
    {
        vec![std::path::PathBuf::from(
            "/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code",
        )]
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        vec![std::path::PathBuf::from("/snap/bin/code")]
    }
}

fn well_known_cursor() -> Vec<std::path::PathBuf> {
    #[cfg(windows)]
    {
        env_paths(
            "LOCALAPPDATA",
            &[
                r"Programs\cursor\Cursor.exe",
                r"Programs\cursor\bin\cursor.cmd",
            ],
        )
    }
    #[cfg(target_os = "macos")]
    {
        vec![std::path::PathBuf::from(
            "/Applications/Cursor.app/Contents/Resources/app/bin/cursor",
        )]
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        Vec::new()
    }
}

fn well_known_windsurf() -> Vec<std::path::PathBuf> {
    #[cfg(windows)]
    {
        env_paths(
            "LOCALAPPDATA",
            &[
                r"Programs\Windsurf\Windsurf.exe",
                r"Programs\Windsurf\bin\windsurf.cmd",
            ],
        )
    }
    #[cfg(target_os = "macos")]
    {
        vec![std::path::PathBuf::from(
            "/Applications/Windsurf.app/Contents/Resources/app/bin/windsurf",
        )]
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        Vec::new()
    }
}

fn well_known_zed() -> Vec<std::path::PathBuf> {
    #[cfg(windows)]
    {
        env_paths("LOCALAPPDATA", &[r"Programs\Zed\zed.exe"])
    }
    #[cfg(target_os = "macos")]
    {
        vec![std::path::PathBuf::from(
            "/Applications/Zed.app/Contents/MacOS/cli",
        )]
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        std::env::var_os("HOME")
            .map(|home| vec![std::path::PathBuf::from(home).join(".local/bin/zed")])
            .unwrap_or_default()
    }
}

/// Editores soportados, en orden de preferencia (el primero es el que se abre
/// con el clic directo del botón).
fn editor_specs() -> Vec<EditorSpec> {
    vec![
        EditorSpec { id: "vscode", name: "VS Code", bins: &["code"], well_known: well_known_vscode },
        EditorSpec { id: "cursor", name: "Cursor", bins: &["cursor"], well_known: well_known_cursor },
        EditorSpec { id: "windsurf", name: "Windsurf", bins: &["windsurf"], well_known: well_known_windsurf },
        EditorSpec { id: "zed", name: "Zed", bins: &["zed"], well_known: well_known_zed },
    ]
}

/// Busca un binario en `PATH`. En Windows `CreateProcess` no consulta
/// `PATHEXT`, así que probamos las extensiones ejecutables a mano.
fn find_on_path(bin: &str) -> Option<std::path::PathBuf> {
    let path_var = std::env::var_os("PATH")?;
    for dir in std::env::split_paths(&path_var) {
        #[cfg(windows)]
        for ext in ["exe", "cmd", "bat"] {
            let candidate = dir.join(format!("{bin}.{ext}"));
            if candidate.is_file() {
                return Some(candidate);
            }
        }
        #[cfg(not(windows))]
        {
            let candidate = dir.join(bin);
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }
    None
}

/// Resuelve el ejecutable de un editor: primero las rutas de instalación
/// habituales, luego `PATH`.
fn resolve_editor(spec: &EditorSpec) -> Option<std::path::PathBuf> {
    for path in (spec.well_known)() {
        if path.is_file() {
            return Some(path);
        }
    }
    for bin in spec.bins {
        if let Some(path) = find_on_path(bin) {
            return Some(path);
        }
    }
    None
}

/// Gestor de archivos por defecto del sistema (para el botón «Abrir carpeta»).
#[derive(serde::Serialize, Clone)]
pub struct FileManagerInfo {
    /// Clave para el icono del front: "windows" | "finder" | "linux".
    id: &'static str,
    /// Nombre visible: "Explorador de archivos", "Finder", "Dolphin"…
    name: String,
}

/// En Linux el gestor de archivos no es fijo: depende del entorno de
/// escritorio. Se pregunta al sistema qué app maneja `inode/directory`
/// (`xdg-mime query default inode/directory` → p.ej. `org.kde.dolphin.desktop`)
/// y, si no se sabe, se infiere del entorno (`XDG_CURRENT_DESKTOP`).
#[cfg(target_os = "linux")]
fn detect_file_manager() -> FileManagerInfo {
    let desktop_id = std::process::Command::new("xdg-mime")
        .args(["query", "default", "inode/directory"])
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_lowercase())
        .unwrap_or_default();

    let known = [
        ("nautilus", "Nautilus (Files)"),
        ("dolphin", "Dolphin"),
        ("nemo", "Nemo"),
        ("thunar", "Thunar"),
        ("caja", "Caja"),
        ("pcmanfm", "PCManFM"),
        ("konqueror", "Konqueror"),
    ];
    for (key, name) in known {
        if desktop_id.contains(key) {
            return FileManagerInfo { id: "linux", name: name.to_string() };
        }
    }

    // Respaldo por entorno de escritorio.
    let de = std::env::var("XDG_CURRENT_DESKTOP")
        .unwrap_or_default()
        .to_lowercase();
    let name = match de.as_str() {
        d if d.contains("kde") => "Dolphin",
        d if d.contains("gnome") => "Nautilus (Files)",
        d if d.contains("xfce") => "Thunar",
        d if d.contains("cinnamon") => "Nemo",
        d if d.contains("mate") => "Caja",
        d if d.contains("lxqt") || d.contains("lxde") => "PCManFM",
        _ => "Gestor de archivos",
    };
    FileManagerInfo { id: "linux", name: name.to_string() }
}

#[cfg(target_os = "windows")]
fn detect_file_manager() -> FileManagerInfo {
    FileManagerInfo { id: "windows", name: "Explorador de archivos".to_string() }
}

#[cfg(target_os = "macos")]
fn detect_file_manager() -> FileManagerInfo {
    FileManagerInfo { id: "finder", name: "Finder".to_string() }
}

/// Gestor de archivos del sistema (nombre e icono para el front).
#[tauri::command]
pub fn file_manager() -> FileManagerInfo {
    detect_file_manager()
}

/* ── Estado de git del workspace ───────────────────────────────────────── */

/// Resumen del estado de git para la cabecera (rama, cambios, ahead/behind).
#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GitStatusInfo {
    branch: String,
    upstream: Option<String>,
    ahead: u32,
    behind: u32,
    staged: u32,
    modified: u32,
    untracked: u32,
    conflicted: u32,
    /// Asunto del último commit y su fecha relativa ("hace 2 horas").
    last_commit: Option<String>,
    last_commit_rel: Option<String>,
    /// URL web del remoto `origin` (https), para «abrir el repo en el navegador».
    remote_web: Option<String>,
}

/// Ejecuta un comando git de lectura y devuelve su stdout. Misma política que
/// `git_status_blocking`: sin locks opcionales, `None` ante cualquier fallo.
fn git_read(path: &std::path::Path, args: &[&str]) -> Option<String> {
    let output = std::process::Command::new("git")
        .arg("-C")
        .arg(path)
        .args(args)
        .env("GIT_OPTIONAL_LOCKS", "0")
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    Some(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

/// Convierte un remote de git en URL web: `git@github.com:org/repo.git` o
/// `ssh://git@host/org/repo` → `https://host/org/repo`.
fn remote_to_web(url: &str) -> Option<String> {
    let u = url.trim().trim_end_matches(".git").trim_end_matches('/');
    if let Some(rest) = u.strip_prefix("git@") {
        let (host, path) = rest.split_once(':')?;
        return Some(format!("https://{host}/{path}"));
    }
    if let Some(rest) = u.strip_prefix("ssh://git@") {
        return Some(format!("https://{rest}"));
    }
    if u.starts_with("http://") || u.starts_with("https://") {
        return Some(u.to_string());
    }
    None
}

/// Ejecuta `git status` y lo parsea. `None` si no hay git o no es un repo
/// (la cabecera simplemente no muestra nada).
fn git_status_blocking(path: &std::path::Path) -> Option<GitStatusInfo> {
    let output = std::process::Command::new("git")
        .args([
            "-C",
            &path.to_string_lossy(),
            "status",
            "--porcelain=v2",
            "--branch",
            "--untracked-files=normal",
        ])
        // No tocar index.lock: esto es una lectura pasiva, no debe interferir
        // con el git del usuario (ni con el agente corriendo tests/commits).
        .env("GIT_OPTIONAL_LOCKS", "0")
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&output.stdout);

    let mut info = GitStatusInfo {
        branch: String::new(),
        upstream: None,
        ahead: 0,
        behind: 0,
        staged: 0,
        modified: 0,
        untracked: 0,
        conflicted: 0,
        last_commit: None,
        last_commit_rel: None,
        remote_web: None,
    };
    for line in text.lines() {
        if let Some(head) = line.strip_prefix("# branch.head ") {
            info.branch = head.to_string();
        } else if let Some(upstream) = line.strip_prefix("# branch.upstream ") {
            info.upstream = Some(upstream.to_string());
        } else if let Some(ab) = line.strip_prefix("# branch.ab ") {
            // Formato: "+<ahead> -<behind>"
            for part in ab.split_whitespace() {
                if let Some(n) = part.strip_prefix('+') {
                    info.ahead = n.parse().unwrap_or(0);
                } else if let Some(n) = part.strip_prefix('-') {
                    info.behind = n.parse().unwrap_or(0);
                }
            }
        } else if line.starts_with('1') || line.starts_with('2') {
            // Entradas tracked: "1 <XY> …" / "2 <XY> …" (renombrados)
            let xy = line.split_whitespace().nth(1).unwrap_or("..");
            let mut chars = xy.chars();
            let x = chars.next().unwrap_or('.');
            let y = chars.next().unwrap_or('.');
            if matches!(x, 'M' | 'A' | 'D' | 'R' | 'C' | 'T') {
                info.staged += 1;
            }
            if matches!(y, 'M' | 'D' | 'T') {
                info.modified += 1;
            }
        } else if line.starts_with('u') {
            info.conflicted += 1;
        } else if line.starts_with('?') {
            info.untracked += 1;
        }
    }
    if info.branch.is_empty() {
        return None;
    }

    // Último commit: asunto y fecha relativa, separados por \x1f.
    if let Some(log) = git_read(path, &["log", "-1", "--format=%s%x1f%cr"]) {
        let mut parts = log.splitn(2, '\u{1f}');
        info.last_commit = parts.next().map(str::to_string).filter(|s| !s.is_empty());
        info.last_commit_rel = parts.next().map(str::to_string).filter(|s| !s.is_empty());
    }
    if let Some(remote) = git_read(path, &["config", "--get", "remote.origin.url"]) {
        info.remote_web = remote_to_web(&remote);
    }
    Some(info)
}

/// Directorio `.git` real (en worktrees/submódulos `.git` es un archivo
/// `gitdir: <ruta>` que apunta al directorio de verdad).
fn resolve_gitdir(path: &std::path::Path) -> Option<std::path::PathBuf> {
    let dotgit = path.join(".git");
    if dotgit.is_dir() {
        return Some(dotgit);
    }
    let content = std::fs::read_to_string(&dotgit).ok()?;
    let dir = content.trim().strip_prefix("gitdir:")?.trim();
    let p = std::path::PathBuf::from(dir);
    Some(if p.is_absolute() { p } else { path.join(p) })
}

/// Sello ligero del estado de git: mtimes de HEAD/index/refs + contenido de
/// HEAD. Sirve para vigilar cambios casi en tiempo real SIN ejecutar
/// `git status` en cada sondeo: el front compara sellos y solo recarga el
/// estado completo cuando cambia.
fn git_stamp_blocking(path: &std::path::Path) -> Option<u64> {
    let gitdir = resolve_gitdir(path)?;
    fn mix(stamp: &mut u64, value: u64) {
        *stamp = stamp.wrapping_mul(31).wrapping_add(value);
    }
    fn mix_file(stamp: &mut u64, p: &std::path::Path) {
        if let Ok(modified) = std::fs::metadata(p).and_then(|m| m.modified()) {
            if let Ok(dur) = modified.duration_since(std::time::UNIX_EPOCH) {
                mix(stamp, dur.as_secs());
                mix(stamp, u64::from(dur.subsec_nanos()));
            }
        }
    }
    let mut stamp: u64 = 0x9e37_79b9_7f4a_7c15;
    let head = gitdir.join("HEAD");
    if let Ok(content) = std::fs::read_to_string(&head) {
        for b in content.bytes() {
            mix(&mut stamp, u64::from(b));
        }
        // La rama apuntada: un commit la mueve sin tocar HEAD.
        if let Some(refname) = content.trim().strip_prefix("ref: ") {
            mix_file(&mut stamp, &gitdir.join(refname));
        }
    }
    mix_file(&mut stamp, &head);
    mix_file(&mut stamp, &gitdir.join("index"));
    mix_file(&mut stamp, &gitdir.join("packed-refs"));
    Some(stamp)
}

/// Sello del estado de git de una carpeta (`None` si no es un repo).
/// Barato (stats de archivos, sin procesos): pensado para sondeo frecuente.
#[tauri::command]
pub fn git_stamp(path: String) -> Option<u64> {
    let candidate = std::path::PathBuf::from(&path);
    if !candidate.is_absolute() || !candidate.is_dir() {
        return None;
    }
    git_stamp_blocking(&candidate)
}

/// Diff del working tree (`git diff HEAD`) para el visor integrado.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitDiffResult {
    /// Diff unificado completo (con cabeceras `diff --git …`).
    diff: String,
    /// Archivos sin seguimiento (git no los incluye en el diff).
    untracked: Vec<String>,
    /// `true` si el diff se cortó por tamaño.
    truncated: bool,
}

/// Tope del diff devuelto al front (~400 KB de texto bastan de sobra para
/// revisar cambios; un diff mayor se corta y se avisa).
const DIFF_CAP: usize = 400_000;
/// Tope de archivos sin seguimiento listados.
const UNTRACKED_CAP: usize = 200;

fn git_diff_blocking(path: &std::path::Path) -> Result<GitDiffResult, String> {
    // Repo con commits: `git diff HEAD` cubre preparados + sin preparar. En un
    // repo recién creado (sin HEAD) se concatenan ambas vistas.
    let has_head = git_read(path, &["rev-parse", "--verify", "HEAD"]).is_some();
    let raw = if has_head {
        git_read(path, &["diff", "HEAD", "--"])
    } else {
        match (
            git_read(path, &["diff", "--cached", "--"]),
            git_read(path, &["diff", "--"]),
        ) {
            (None, None) => None,
            (a, b) => Some(format!(
                "{}\n{}",
                a.unwrap_or_default(),
                b.unwrap_or_default()
            )),
        }
    }
    .ok_or_else(|| "no es un repositorio git".to_string())?;

    let mut truncated = false;
    let mut diff = raw;
    if diff.len() > DIFF_CAP {
        // Corte en frontera de char (UTF-8).
        let mut end = DIFF_CAP;
        while !diff.is_char_boundary(end) {
            end -= 1;
        }
        diff.truncate(end);
        truncated = true;
    }

    let untracked = git_read(path, &["ls-files", "--others", "--exclude-standard"])
        .map(|out| out.lines().map(str::to_string).take(UNTRACKED_CAP).collect())
        .unwrap_or_default();

    Ok(GitDiffResult { diff, untracked, truncated })
}

/// Diff del working tree de un repo (`git diff HEAD` + sin seguimiento).
#[tauri::command]
pub async fn git_diff(path: String) -> Result<GitDiffResult, String> {
    let candidate = std::path::PathBuf::from(&path);
    if !candidate.is_absolute() || !candidate.is_dir() {
        return Err(format!("ruta no válida: {path}"));
    }
    tauri::async_runtime::spawn_blocking(move || git_diff_blocking(&candidate))
        .await
        .map_err(|e| e.to_string())?
}

/// Acciones de red sobre el repo: fetch / pull (--ff-only) / push.
/// `GIT_TERMINAL_PROMPT=0`: si hicieran falta credenciales, falla rápido en
/// vez de quedarse colgado esperando un prompt que nadie vería.
#[tauri::command]
pub async fn git_action(path: String, action: String) -> Result<String, String> {
    let args: &[&str] = match action.as_str() {
        "fetch" => &["fetch"],
        "pull" => &["pull", "--ff-only"],
        "push" => &["push"],
        _ => return Err(format!("acción no soportada: {action}")),
    };
    let candidate = std::path::PathBuf::from(&path);
    if !candidate.is_absolute() || !candidate.is_dir() {
        return Err(format!("ruta no válida: {path}"));
    }
    let owned: Vec<String> = args.iter().map(|s| s.to_string()).collect();
    tauri::async_runtime::spawn_blocking(move || {
        let output = std::process::Command::new("git")
            .arg("-C")
            .arg(&candidate)
            .args(&owned)
            .env("GIT_TERMINAL_PROMPT", "0")
            .output()
            .map_err(|e| e.to_string())?;
        let mut text = String::from_utf8_lossy(&output.stdout).trim().to_string();
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        if !stderr.is_empty() {
            if !text.is_empty() {
                text.push('\n');
            }
            text.push_str(&stderr);
        }
        if output.status.success() {
            Ok(if text.is_empty() { "Hecho.".to_string() } else { text })
        } else {
            Err(if text.is_empty() { "falló la operación".to_string() } else { text })
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Ramas locales del repo (`git branch`), para el selector del popover.
#[tauri::command]
pub async fn git_branches(path: String) -> Result<Vec<String>, String> {
    let candidate = std::path::PathBuf::from(&path);
    if !candidate.is_absolute() || !candidate.is_dir() {
        return Err(format!("ruta no válida: {path}"));
    }
    tauri::async_runtime::spawn_blocking(move || {
        git_read(&candidate, &["branch", "--format=%(refname:short)"])
            .map(|out| out.lines().map(str::to_string).collect())
            .ok_or_else(|| "no es un repositorio git".to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Cambia de rama (`git checkout`) o la crea (`git checkout -b`).
/// El nombre se valida con `git check-ref-format` antes de crear.
#[tauri::command]
pub async fn git_checkout(path: String, branch: String, create: bool) -> Result<(), String> {
    let candidate = std::path::PathBuf::from(&path);
    if !candidate.is_absolute() || !candidate.is_dir() {
        return Err(format!("ruta no válida: {path}"));
    }
    if branch.is_empty() || branch.starts_with('-') {
        return Err("nombre de rama no válido".to_string());
    }
    tauri::async_runtime::spawn_blocking(move || {
        if create && git_read(&candidate, &["check-ref-format", "--branch", &branch]).is_none() {
            return Err(format!("nombre de rama no válido: {branch}"));
        }
        let args: Vec<&str> = if create {
            vec!["checkout", "-b", &branch]
        } else {
            vec!["checkout", &branch]
        };
        let output = std::process::Command::new("git")
            .arg("-C")
            .arg(&candidate)
            .args(&args)
            .env("GIT_TERMINAL_PROMPT", "0")
            .output()
            .map_err(|e| e.to_string())?;
        if output.status.success() {
            Ok(())
        } else {
            // El mensaje útil (p.ej. «cambios locales se perderían») va a stderr.
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
            Err(if stderr.is_empty() { "falló el checkout".to_string() } else { stderr })
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Abre una terminal en la carpeta dada. En Windows: Windows Terminal →
/// PowerShell 7 → PowerShell → cmd (el primero instalado).
#[tauri::command]
pub fn open_terminal(path: String) -> Result<(), String> {
    let candidate = std::path::PathBuf::from(&path);
    if !candidate.is_absolute() || !candidate.is_dir() {
        return Err(format!("ruta no válida: {path}"));
    }

    #[cfg(windows)]
    {
        let wt_alias = std::env::var_os("LOCALAPPDATA")
            .map(|base| std::path::PathBuf::from(base).join(r"Microsoft\WindowsApps\wt.exe"));
        let wt = wt_alias
            .filter(|p| p.is_file())
            .or_else(|| find_on_path("wt"));
        if let Some(wt) = wt {
            std::process::Command::new(wt)
                .arg("-d")
                .arg(&candidate)
                .spawn()
                .map_err(|e| format!("no se pudo abrir Windows Terminal: {e}"))?;
            return Ok(());
        }
        // Consolas clásicas: heredan su propia ventana de consola al no
        // tenerla la app (GUI), arrancando en el directorio indicado.
        for shell in ["pwsh", "powershell", "cmd"] {
            if let Some(bin) = find_on_path(shell) {
                std::process::Command::new(bin)
                    .current_dir(&candidate)
                    .spawn()
                    .map_err(|e| format!("no se pudo abrir {shell}: {e}"))?;
                return Ok(());
            }
        }
        return Err("no se encontró ninguna terminal".to_string());
    }

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg("-a")
            .arg("Terminal")
            .arg(&candidate)
            .spawn()
            .map_err(|e| format!("no se pudo abrir Terminal: {e}"))?;
        return Ok(());
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        for term in ["x-terminal-emulator", "kgx", "gnome-terminal", "konsole", "alacritty", "kitty", "xterm"] {
            if let Some(bin) = find_on_path(term) {
                std::process::Command::new(bin)
                    .current_dir(&candidate)
                    .spawn()
                    .map_err(|e| format!("no se pudo abrir {term}: {e}"))?;
                return Ok(());
            }
        }
        return Err("no se encontró ninguna terminal".to_string());
    }
}

/// Estado de git de una carpeta (`None` si no es un repo o no hay git).
/// Se ejecuta en un hilo aparte: `git status` puede tardar en repos grandes.
#[tauri::command]
pub async fn git_status(path: String) -> Result<Option<GitStatusInfo>, String> {
    let candidate = std::path::PathBuf::from(&path);
    if !candidate.is_absolute() || !candidate.is_dir() {
        return Err(format!("ruta no válida: {path}"));
    }
    tauri::async_runtime::spawn_blocking(move || git_status_blocking(&candidate))
        .await
        .map_err(|e| e.to_string())
}

/// Editores de código instalados (de la whitelist conocida).
#[tauri::command]
pub fn list_editors() -> Vec<EditorInfo> {
    editor_specs()
        .iter()
        .filter(|spec| resolve_editor(spec).is_some())
        .map(|spec| EditorInfo { id: spec.id, name: spec.name })
        .collect()
}

/// Abre una carpeta (o archivo, con `line`) en un editor instalado.
///
/// Con `line` se abre el archivo *en esa línea*: `-g ruta:línea` en la familia
/// VS Code (code/cursor/windsurf) y `ruta:línea` en Zed.
#[tauri::command]
pub fn open_in_editor(editor: String, path: String, line: Option<u32>) -> Result<(), String> {
    let candidate = std::path::Path::new(&path);
    let valid = candidate.is_absolute()
        && if line.is_some() { candidate.is_file() } else { candidate.is_dir() };
    if !valid {
        return Err(format!("ruta no válida: {path}"));
    }
    let specs = editor_specs();
    let spec = specs
        .iter()
        .find(|s| s.id == editor)
        .ok_or_else(|| format!("editor no soportado: {editor}"))?;
    let bin = resolve_editor(spec).ok_or_else(|| format!("{} no está instalado", spec.name))?;

    // Argumento(s) de apertura: `-g archivo:línea` salvo en Zed (archivo:línea).
    let target = match line {
        Some(n) => format!("{}:{n}", candidate.display()),
        None => candidate.display().to_string(),
    };
    let goto_flag = line.is_some() && spec.id != "zed";

    let is_batch = bin
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.eq_ignore_ascii_case("cmd") || e.eq_ignore_ascii_case("bat"))
        .unwrap_or(false);

    let mut command = if is_batch {
        // `CreateProcess` no ejecuta .cmd/.bat: hay que pasar por cmd.exe.
        let mut c = std::process::Command::new("cmd.exe");
        c.arg("/C").arg(&bin);
        if goto_flag {
            c.arg("-g");
        }
        c.arg(&target);
        c
    } else {
        let mut c = std::process::Command::new(&bin);
        if goto_flag {
            c.arg("-g");
        }
        c.arg(&target);
        c
    };
    #[cfg(windows)]
    {
        // Sin ventana de consola al lanzar el .cmd (la app es GUI).
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    command
        .spawn()
        .map_err(|e| format!("no se pudo abrir {}: {e}", spec.name))?;
    Ok(())
}
