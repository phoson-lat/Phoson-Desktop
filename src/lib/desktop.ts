/**
 * Integración con el escritorio (Windows): notificaciones nativas del sistema y
 * bandeja del sistema (tray). Todo es no-op fuera de Tauri (modo demo en el
 * navegador), para que la app siga funcionando sin la shell nativa.
 */

import { invoke } from "@tauri-apps/api/core";
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";

import { isTauri } from "@/bridge/client";

/** Cómo avisar al terminar un turno (misma semántica que `notify_on_completion`). */
export type NotifyMode = "off" | "bell" | "desktop";

const TRAY_PREF = "phoson.closeToTray";

let permission: "unknown" | "granted" | "denied" = "unknown";

/** Notificación nativa del sistema (toast de Windows). `true` si se mostró. */
export async function desktopNotify(title: string, body?: string): Promise<boolean> {
  if (!isTauri()) return false;
  try {
    if (permission === "denied") return false;
    if (permission === "unknown") {
      let granted = await isPermissionGranted();
      if (!granted) granted = (await requestPermission()) === "granted";
      permission = granted ? "granted" : "denied";
    }
    if (permission !== "granted") return false;
    sendNotification(body ? { title, body } : { title });
    return true;
  } catch {
    return false;
  }
}

/** "Campana": pitido corto, sin salir de la app (WebAudio, sin assets). */
export function bellBeep(): void {
  try {
    const Ctx = window.AudioContext ?? (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.12, ctx.currentTime + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.35);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.36);
    osc.onended = () => void ctx.close().catch(() => {});
  } catch {
    /* sin audio disponible: silencio */
  }
}

/** La app está en primer plano (no hace falta avisar: el usuario ya la ve). */
export function appInForeground(): boolean {
  if (typeof document !== "undefined" && !document.hasFocus()) return false;
  return true;
}

/**
 * Aviso al terminar un turno, respetando la preferencia del usuario:
 * `off` (nada) · `bell` (pitido) · `desktop` (notificación del sistema,
 * solo si la ventana no tiene el foco).
 */
export async function notifyTurnEnd(
  mode: string,
  title: string,
  body: string,
  opts?: { error?: boolean },
): Promise<void> {
  if (mode === "off") return;
  if (mode === "bell") {
    bellBeep();
    return;
  }
  if (appInForeground()) return;
  await desktopNotify(opts?.error ? `${title} · error` : title, body);
}

/* ── Bandeja del sistema ─────────────────────────────────────────────── */

/** Preferencia «cerrar manda a la bandeja» (persistida en localStorage). */
export function isCloseToTrayEnabled(): boolean {
  try {
    return localStorage.getItem(TRAY_PREF) !== "0";
  } catch {
    return true;
  }
}

export function setCloseToTrayPref(enabled: boolean): void {
  try {
    localStorage.setItem(TRAY_PREF, enabled ? "1" : "0");
  } catch {
    /* almacenamiento no disponible */
  }
  if (!isTauri()) return;
  void invoke("set_close_to_tray", { enabled }).catch(() => {});
}

/** Sincroniza la preferencia guardada con la shell nativa (al arrancar). */
export function syncCloseToTray(): void {
  if (!isTauri()) return;
  void invoke("set_close_to_tray", { enabled: isCloseToTrayEnabled() }).catch(() => {});
}

/** Oculta la ventana a la bandeja (el agente sigue ejecutándose). */
export async function hideToTray(): Promise<void> {
  if (!isTauri()) return;
  await invoke("hide_to_tray").catch(() => {});
}

/** Muestra y enfoca la ventana principal. */
export async function showMainWindow(): Promise<void> {
  if (!isTauri()) return;
  await invoke("show_window").catch(() => {});
}
