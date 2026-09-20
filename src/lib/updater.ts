/**
 * Actualizaciones de la app (Tauri updater).
 *
 * Feed estático (`latest.json`) + artefactos firmados, servidos desde GitHub
 * Releases o cualquier host HTTPS. La verificación usa la clave pública del
 * updater configurada en `tauri.conf.json` (`plugins.updater.pubkey`), así que
 * no hace falta backend propio.
 *
 * Fuera de Tauri (modo demo en navegador) no hay updater: se degrada a null.
 */

import { invoke } from "@tauri-apps/api/core";
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type Update } from "@tauri-apps/plugin-updater";

import { isTauri } from "@/bridge/client";

export interface UpdateInfo {
  currentVersion: string;
  version: string;
  notes?: string;
  date?: string;
}

/** Update pendiente (guardado para no re-consultar al instalar). */
let pending: Update | null = null;

export async function currentVersion(): Promise<string> {
  try {
    const info = await invoke<{ version: string }>("app_info");
    return info.version;
  } catch {
    return "0.0.0";
  }
}

/**
 * Busca actualizaciones. Devuelve `null` si no hay ninguna o si no estamos en
 * Tauri (modo demo). Los errores de red/señal se propagan para que la UI avise.
 */
export async function checkForUpdates(): Promise<UpdateInfo | null> {
  if (!isTauri()) return null;
  pending = await check();
  if (!pending) return null;
  return {
    currentVersion: await currentVersion(),
    version: pending.version,
    notes: pending.body ?? undefined,
    date: pending.date ?? undefined,
  };
}

/** Descarga e instala la actualización pendiente y relanza la app. */
export async function installPendingUpdate(
  onProgress?: (fraction: number) => void,
): Promise<void> {
  if (!pending) throw new Error("No hay actualización pendiente");
  let total = 0;
  let downloaded = 0;
  await pending.downloadAndInstall((event) => {
    switch (event.event) {
      case "Started":
        total = event.data.contentLength ?? 0;
        break;
      case "Progress":
        downloaded += event.data.chunkLength;
        if (total > 0) onProgress?.(Math.min(downloaded / total, 1));
        break;
      case "Finished":
        onProgress?.(1);
        break;
    }
  });
  await relaunch();
}
