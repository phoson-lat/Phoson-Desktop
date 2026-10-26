/**
 * Instalación de los **extras** del engine (las dependencias opcionales de un
 * plugin: `[stt]`, `[mcp]`, `[computeruse]`…), compartida por Ajustes › Plugins,
 * el botón de dictado del composer y el aviso de arranque.
 *
 * El sidecar instala en `~/.phoson/extras/<extra>` y lo añade a su `sys.path`
 * (el plugin funciona sin reiniciar). Si el equipo no tiene `pip` ni `uv`, el
 * sidecar descarga `uv` primero: la fase llega por `extras.progress` y aquí se
 * expone para que la UI diga qué está pasando.
 *
 * Una sola instalación a la vez (dos `pip install --target` sobre `~/.phoson`
 * no se pisan, pero la UI no tiene cómo enseñar dos progresos). Al terminar bien
 * se emite `phoson:extras-installed` para que quien sondeó el estado (p. ej. el
 * dictado) vuelva a sondear.
 */
import { toast } from "sonner";
import { create } from "zustand";

import { phoson } from "../bridge/client";
import type { ExtrasProgress, PluginsInstallExtraResult } from "../bridge/protocol";
import i18n from "../lib/i18n";
import { logError, logEvent } from "../lib/log";
import { useSession } from "./session";

/** Evento de ventana tras instalar un extra (`detail: { extra }`). */
export const EXTRAS_INSTALLED_EVENT = "phoson:extras-installed";

/** Fase que reporta el sidecar mientras instala. */
export type ExtraInstallPhase = ExtrasProgress["phase"];

interface ExtrasState {
  /** Extra en instalación (`null` si no hay ninguna en curso). */
  installing: string | null;
  phase: ExtraInstallPhase | null;
  /**
   * Instala el extra y avisa con un toast. Devuelve el resultado del sidecar
   * (o `null` si ya había otra instalación en curso o el RPC falló).
   */
  install: (sessionId: string, extra: string) => Promise<PluginsInstallExtraResult | null>;
}

/** Texto de la fase en curso (para botones y avisos). */
export const extraPhaseText = (phase: ExtraInstallPhase | null): string =>
  phase === "downloadingInstaller"
    ? i18n.t("settings:plugins.extra.downloadingInstaller")
    : i18n.t("settings:plugins.extra.installing");

/** Motivo por el que el sidecar no puede instalar extras. */
export const extraInstallBlockText = (reason: string, extra = ""): string =>
  reason === "noPip"
    ? i18n.t("settings:plugins.extra.blockedNoPip", { extra })
    : i18n.t("settings:plugins.extra.blocked");

/** Detalle del fallo al instalar un extra (la salida del instalador si la hay). */
export const extraInstallErrorText = (res: PluginsInstallExtraResult): string => {
  if (res.reason === "uvDownloadFailed") return i18n.t("settings:plugins.extra.uvDownloadFailed");
  if (res.error) return res.error;
  if (res.reason === "noPip") return extraInstallBlockText("noPip", res.extra ?? "");
  if (res.reason === "unknownExtra") return i18n.t("settings:plugins.extra.unknown");
  if (res.reason === "timeout") return i18n.t("settings:plugins.extra.timeout");
  if (res.reason === "notImportable") return i18n.t("settings:plugins.extra.notImportable");
  return i18n.t("settings:plugins.extra.failed");
};

/** Suscripción a `extras.progress` (una vez, al primer `install`). */
let progressListener: Promise<unknown> | null = null;

export const useExtras = create<ExtrasState>((set, get) => ({
  installing: null,
  phase: null,
  install: async (sessionId, extra) => {
    if (get().installing) return null;
    progressListener ??= phoson
      .onNotify((envelope) => {
        if (envelope.method !== "extras.progress") return;
        const params = envelope.params as Partial<ExtrasProgress>;
        if (params.phase && params.extra === useExtras.getState().installing) {
          set({ phase: params.phase });
        }
      })
      .catch(() => {
        // Sin suscripción solo se pierde el texto de la fase: se reintenta luego.
        progressListener = null;
      });
    set({ installing: extra, phase: "installing" });
    try {
      const res = await phoson.pluginsInstallExtra(sessionId, extra);
      if (!res.ok) {
        toast.error(i18n.t("settings:plugins.extra.failedToast", { extra }), {
          description: extraInstallErrorText(res),
        });
        logEvent("extras.install", { extra, ok: false, reason: res.reason }, "warn", "engine");
        return res;
      }
      // El sidecar recargó los engines: sus tools nuevas (p. ej. las de MCP)
      // entran ya en los selectores.
      if (res.tools) useSession.getState().applyToolCatalog(res.tools);
      toast.success(i18n.t("settings:plugins.extra.okToast", { extra }), { description: res.dir });
      logEvent("extras.install", { extra, ok: true }, "info", "engine");
      window.dispatchEvent(new CustomEvent(EXTRAS_INSTALLED_EVENT, { detail: { extra } }));
      return res;
    } catch (e) {
      toast.error(i18n.t("settings:plugins.extra.failedToast", { extra }), { description: String(e) });
      logError("extras.install", e);
      return null;
    } finally {
      set({ installing: null, phase: null });
    }
  },
}));
