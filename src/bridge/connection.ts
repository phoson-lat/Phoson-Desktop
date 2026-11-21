import { invoke } from "@tauri-apps/api/core";
import { installBridge, resetBridge, isTauri } from "./client";
export { isRemoteMode } from "./client";
import { RemoteBridge, validateRemoteUrl } from "./remote";

export interface RemoteProfile { url: string; workspace: string; deviceName: string }
const PROFILE_KEY = "phoson.remote.profile";
let active: RemoteBridge | null = null;

/** Solo metadatos públicos: los tokens nunca se guardan en Web Storage. */
export function getRemoteProfile(): RemoteProfile | null {
  try {
    const value = JSON.parse(localStorage.getItem(PROFILE_KEY) ?? "null");
    return value && typeof value.url === "string" && typeof value.workspace === "string" && typeof value.deviceName === "string" ? value : null;
  } catch { return null; }
}
export const remoteWorkspace = (): string | null => active?.metadata.workspace ?? null;
export const remoteUrl = (): string | null => getRemoteProfile()?.url ?? null;
export const remoteConnected = (): boolean => active?.connected ?? false;

export async function connectRemote(options: RemoteProfile & { code?: string; remember: boolean }): Promise<void> {
  // La URL canónica también identifica la entrada del llavero.
  const url = validateRemoteUrl(options.url.trim());
  const token = !options.code && isTauri()
    ? await invoke<string | null>("remote_token_get", { server: url })
    : null;
  if (!options.code && !token) throw new Error("REMOTE_CREDENTIAL_REQUIRED");
  const next = await RemoteBridge.connect({ url, workspace: options.workspace || undefined, deviceName: options.deviceName, ...(options.code ? { code: options.code } : { token: token! }) });
  const newToken = next.takeToken();
  try {
    if (options.remember && isTauri() && newToken) {
      await invoke("remote_token_set", { server: url, token: newToken });
    } else if (!options.remember && isTauri()) {
      await invoke("remote_token_delete", { server: url });
    }
    // Se conserva el perfil incluso sin recordar el token: al recargar se pide
    // emparejar de nuevo, nunca se cae silenciosamente al workspace local.
    localStorage.setItem(PROFILE_KEY, JSON.stringify({ url, workspace: next.metadata.workspace, deviceName: options.deviceName }));
  } catch {
    next.close();
    throw new Error("REMOTE_STORAGE_FAILED");
  }
  active?.close();
  active = next;
  installBridge(next, next.workspace);
}

/** El cambio de modo requiere recarga: evita mezclar IDs y borradores. */
export function useLocalMode(): void {
  active?.close();
  active = null;
  resetBridge();
  localStorage.removeItem(PROFILE_KEY);
  sessionStorage.removeItem("phoson.chooseConnection");
}

export function chooseConnection(): void {
  sessionStorage.setItem("phoson.chooseConnection", "1");
  window.location.reload();
}
