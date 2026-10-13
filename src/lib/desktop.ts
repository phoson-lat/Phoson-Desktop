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

/* ── Abrir el workspace fuera de la app ────────────────────────────────── */

/** Editor de código detectado en el equipo (whitelist cerrada en Rust). */
export interface EditorInfo {
  id: string;
  name: string;
}

/** Abre una carpeta en el explorador de archivos del sistema. */
export async function openFolder(path: string): Promise<void> {
  if (!isTauri()) return;
  await invoke("open_folder", { path });
}

/** Gestor de archivos del sistema: id de icono ("windows" | "finder" | "linux") y nombre. */
export interface FileManagerInfo {
  id: string;
  name: string;
}

/** Gestor de archivos por defecto del SO (Explorer, Finder, Dolphin…). */
export async function fileManager(): Promise<FileManagerInfo | null> {
  if (!isTauri()) return null;
  return invoke<FileManagerInfo>("file_manager").catch(() => null);
}

/** Editores de código instalados (VS Code, Cursor, Windsurf, Zed…). */
export async function listEditors(): Promise<EditorInfo[]> {
  if (!isTauri()) return [];
  return invoke<EditorInfo[]>("list_editors");
}

/**
 * Abre una carpeta (o archivo) en un editor instalado (`id` de `listEditors`).
 * Con `line` abre el archivo en esa línea (`-g ruta:línea`).
 */
export async function openInEditor(editorId: string, path: string, line?: number): Promise<void> {
  if (!isTauri()) return;
  await invoke("open_in_editor", { editor: editorId, path, line: line ?? null });
}

/* ── Editor preferido ──────────────────────────────────────────────────── */

const PREF_EDITOR_KEY = "phoson.preferredEditor";

/** Editor preferido para aperturas directas (último elegido en el menú). */
export function preferredEditorId(): string | null {
  try {
    return localStorage.getItem(PREF_EDITOR_KEY);
  } catch {
    return null;
  }
}

export function setPreferredEditorId(id: string): void {
  try {
    localStorage.setItem(PREF_EDITOR_KEY, id);
  } catch {
    /* almacenamiento no disponible */
  }
}

/** Cache de por vida de la sesión: escanear PATH en cada apertura no aporta. */
let editorsCache: Promise<EditorInfo[]> | null = null;

/** Editores instalados (cacheados tras la primera consulta). */
export function installedEditors(): Promise<EditorInfo[]> {
  editorsCache ??= listEditors().catch(() => []);
  return editorsCache;
}

/**
 * Abre una ruta en el editor preferido (o el primero detectado).
 * Lanza error si no hay ningún editor instalado.
 */
export async function openWithPreferredEditor(path: string, line?: number): Promise<void> {
  const editors = await installedEditors();
  const primary = editors.find((e) => e.id === preferredEditorId()) ?? editors[0];
  if (!primary) throw new Error("No se encontró ningún editor instalado");
  await openInEditor(primary.id, path, line);
}

/** Estado de git de un workspace: rama, cambios y ahead/behind del upstream. */
export interface GitStatusInfo {
  branch: string;
  upstream: string | null;
  ahead: number;
  behind: number;
  staged: number;
  modified: number;
  untracked: number;
  conflicted: number;
  lastCommit: string | null;
  lastCommitRel: string | null;
  remoteWeb: string | null;
}

/** `null` si la carpeta no es un repo git (o git no está instalado). */
export async function gitStatus(path: string): Promise<GitStatusInfo | null> {
  if (!isTauri()) return null;
  return invoke<GitStatusInfo | null>("git_status", { path }).catch(() => null);
}

/**
 * Sello ligero del estado de git (stats de archivos, sin procesos). El front
 * lo sondea cada poco y solo recarga el estado completo cuando cambia.
 */
export async function gitStamp(path: string): Promise<number | null> {
  if (!isTauri()) return null;
  return invoke<number | null>("git_stamp", { path }).catch(() => null);
}

/** Abre una terminal en la carpeta (Windows Terminal, PowerShell, cmd…). */
export async function openTerminal(path: string): Promise<void> {
  if (!isTauri()) return;
  await invoke("open_terminal", { path });
}

/** Diff del working tree (`git diff HEAD` + archivos sin seguimiento). */
export interface GitDiffResult {
  diff: string;
  untracked: string[];
  truncated: boolean;
}

export async function gitDiff(path: string): Promise<GitDiffResult> {
  return invoke<GitDiffResult>("git_diff", { path });
}

/** Acción de red sobre el repo. Devuelve la salida de git; lanza si falla. */
export async function gitAction(path: string, action: "fetch" | "pull" | "push"): Promise<string> {
  return invoke<string>("git_action", { path, action });
}

/** Ramas locales del repo. */
export async function gitBranches(path: string): Promise<string[]> {
  return invoke<string[]>("git_branches", { path });
}

/** Cambia de rama o la crea (`create`). Lanza con el mensaje de git si falla. */
export async function gitCheckout(path: string, branch: string, create = false): Promise<void> {
  await invoke("git_checkout", { path, branch, create });
}
