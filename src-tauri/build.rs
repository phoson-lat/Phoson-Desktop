//! Build script de Tauri: genera el contexto (esquemas de capacidades, iconos,
//! `OUT_DIR`) que consume `tauri::generate_context!()` en `main.rs`.

fn main() {
    tauri_build::build();
}
