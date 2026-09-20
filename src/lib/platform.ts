/**
 * Detección de plataforma para mostrar los atajos de teclado correctos.
 *
 * En macOS el modificador se muestra con el glifo ⌘ (icono `Command`); en el
 * resto (Windows/Linux) es la tecla `Ctrl`. La detección se hace sobre el
 * user-agent de la webview (WKWebView → "Macintosh", WebKitGTK/WebView2 → su
 * plataforma); es suficiente para elegir el símbolo.
 */

export const isMacOS = (): boolean => {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || navigator.platform || "";
  return /mac|iphone|ipad|ipod/i.test(ua);
};

/** Etiqueta del modificador: "⌘" (macOS) o "Ctrl". */
export const modKeyLabel = (): string => (isMacOS() ? "⌘" : "Ctrl");

/** Etiqueta de un atajo con modificador, p. ej. `shortcutLabel("K")` → "⌘K" / "Ctrl+K". */
export const shortcutLabel = (key: string): string => `${modKeyLabel()}+${key}`;

/** ¿Hay un diálogo/modal Radix abierto? Un atajo global no debe robarle el foco. */
export const isModalOpen = (): boolean =>
  typeof document !== "undefined" &&
  document.querySelector(
    '[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]',
  ) !== null;

/** ¿El evento de teclado viene de un campo editable (input/textarea/contenteditable)? */
export const isEditableTarget = (target: EventTarget | null): boolean => {
  const el = target as HTMLElement | null;
  if (!el || !el.tagName) return false;
  const tag = el.tagName.toLowerCase();
  return tag === "input" || tag === "textarea" || el.isContentEditable === true;
};
