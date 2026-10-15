/**
 * Puente de textos hacia el proceso nativo.
 *
 * El menú de la bandeja y el aviso «sigue en la bandeja» los pinta Rust, donde
 * i18next no llega: este módulo les manda las etiquetas ya traducidas y las
 * refresca en cada cambio de idioma.
 *
 * Vive aparte de `i18n.ts` a propósito: si `i18n.ts` importara `desktop.ts` (y
 * `desktop.ts` importa `i18n.ts` para sus textos), tendríamos un ciclo entre los
 * dos módulos que hoy funciona solo porque ambos usan sus bindings dentro de
 * funciones — el día que alguien llame a `i18n.t` en el cuerpo de `desktop.ts`
 * recibiría `undefined` sin avisar. Aquí la dependencia va en una sola
 * dirección: nativo → i18n.
 */

import { setNativeLabels } from "@/lib/desktop";
import i18n from "@/lib/i18n";

/** Manda a Rust las etiquetas del idioma activo (bandeja, tooltip y aviso). */
export function syncNativeLabels(): void {
  const t = i18n.getFixedT(null, "common");
  void setNativeLabels({
    trayShow: t("tray.show"),
    trayHide: t("tray.hide"),
    trayQuit: t("tray.quit"),
    tooltip: t("tray.tooltip"),
    noticeTitle: t("tray.notice.title"),
    noticeBody: t("tray.notice.body"),
  });
}

/**
 * Engancha la sincronización al cambio de idioma. Se llama **después** de
 * `initI18n()` (ver `main.tsx`): antes no hay idioma que traducir.
 */
export function installNativeLabels(): void {
  syncNativeLabels();
  i18n.on("languageChanged", syncNativeLabels);
}