import { getCurrentWindow } from "@tauri-apps/api/window";

import { isTauri } from "@/bridge/client";

/** macOS dibuja los semáforos dentro del contenido con `titleBarStyle: Overlay`. */
export const isMacTitlebarOverlay = (): boolean =>
  isTauri() && navigator.userAgent.includes("Mac");

/**
 * Marca la plataforma antes del primer render para reservar los semáforos.
 * Las zonas vacías de las cabeceras se pueden arrastrar; los controles no.
 */
export function installNativeWindow(): void {
  if (!isMacTitlebarOverlay()) return;
  document.documentElement.dataset.titlebar = "macos-overlay";

  const appWindow = getCurrentWindow();
  document.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || event.detail > 1) return;
    const target = event.target;
    if (!(target instanceof Element) || !target.closest("[data-window-drag]")) return;
    if (target.closest("button, a, input, textarea, select, [role='button'], [data-no-window-drag]")) return;
    void appWindow.startDragging().catch(() => {});
  });
  document.addEventListener("dblclick", (event) => {
    const target = event.target;
    if (!(target instanceof Element) || !target.closest("[data-window-drag]")) return;
    if (target.closest("button, a, input, textarea, select, [role='button'], [data-no-window-drag]")) return;
    void appWindow.toggleMaximize().catch(() => {});
  });
}
