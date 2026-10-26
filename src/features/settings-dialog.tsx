import {
  AppWindow,
  Check,
  Cpu,
  Download,
  ExternalLink,
  FolderOpen,
  Info,
  KeyRound,
  Loader2,
  Lock,
  Mic,
  Monitor,
  Moon,
  Palette,
  Plug,
  Plus,
  Puzzle,
  RefreshCw,
  Server,
  ShieldCheck,
  Sun,
  Trash2,
} from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useMemo, useState, type ComponentType } from "react";
import { Trans, useTranslation } from "react-i18next";
import { toast } from "sonner";

import { isTauri, phoson } from "@/bridge/client";
import type { ConfigView, McpState, PluginEntry, PluginsState, SttStatus, ToolCatalog } from "@/bridge/protocol";
import { ProviderLogo } from "@/components/provider-logo";
import { McpLogo } from "@/components/mcp-logo";
import { ModelCombobox } from "@/features/model-combobox";
import { ProviderAccount, ProviderSignIn } from "@/features/provider-auth";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { pickSttLanguage } from "@/hooks/use-voice-input";
import { REASONING_EFFORTS, effortLabel } from "@/lib/reasoning";
import { PROVIDER_META, providerLabel, providerNote } from "@/lib/providers";
import { hideToTray, isCloseToTrayEnabled, setCloseToTrayPref } from "@/lib/desktop";
import { useLocale } from "@/lib/i18n";
import { speechLocale } from "@/lib/locale";
import { logPath, openLogFolder } from "@/lib/log";
import { checkForUpdates, currentVersion, installPendingUpdate, type UpdateInfo } from "@/lib/updater";
import { cn } from "@/lib/utils";
import { extraInstallBlockText, extraPhaseText, useExtras } from "@/stores/extras";
import { useSession } from "@/stores/session";

type SectionId =
  | "models"
  | "providers"
  | "local"
  | "mcp"
  | "plugins"
  | "agent"
  | "dictation"
  | "desktop"
  | "appearance"
  | "about";

/**
 * Secciones de la izquierda. Aquí solo viven el id y el icono: la etiqueta se
 * resuelve con `t("sections.<id>")` dentro del componente, porque a nivel de
 * módulo todavía no hay idioma activo.
 */
const SECTIONS: { id: SectionId; icon: ComponentType<{ className?: string }> }[] = [
  { id: "models", icon: Cpu },
  { id: "providers", icon: KeyRound },
  { id: "local", icon: Server },
  { id: "mcp", icon: Plug },
  { id: "plugins", icon: Puzzle },
  { id: "agent", icon: ShieldCheck },
  { id: "dictation", icon: Mic },
  { id: "desktop", icon: AppWindow },
  { id: "appearance", icon: Palette },
  { id: "about", icon: Info },
];

/** Plantillas de servidores MCP comunes (rellenan el formulario). */
const MCP_PRESETS = [
  {
    label: "filesystem",
    name: "filesystem",
    transport: "stdio",
    command: "npx",
    args: "-y @modelcontextprotocol/server-filesystem /tmp",
    env: "",
  },
  {
    label: "github",
    name: "github",
    transport: "stdio",
    command: "npx",
    args: "-y @modelcontextprotocol/server-github",
    env: "GITHUB_PERSONAL_ACCESS_TOKEN=",
  },
  {
    label: "brave-search",
    name: "brave-search",
    transport: "stdio",
    command: "npx",
    args: "-y @modelcontextprotocol/server-brave-search",
    env: "BRAVE_API_KEY=",
  },
  {
    label: "memory",
    name: "memory",
    transport: "stdio",
    command: "npx",
    args: "-y @modelcontextprotocol/server-memory",
    env: "",
  },
  {
    label: "postgres",
    name: "postgres",
    transport: "stdio",
    command: "npx",
    args: "-y @modelcontextprotocol/server-postgres postgresql://user:pass@localhost/db",
    env: "",
  },
];

/**
 * Opciones de "Notificar al terminar" (mismos valores que `notify_on_completion`;
 * la etiqueta de cada una va al catálogo como `desktop.notifyMode.<valor>`).
 */
const NOTIFY_MODES = ["desktop", "bell", "off"] as const;

interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sessionId: string | null;
  /** Vuelve a lanzar el asistente de primera configuración. */
  onRestartOnboarding?: () => void;
}

export function SettingsDialog({
  open,
  onOpenChange,
  sessionId,
  onRestartOnboarding,
}: SettingsDialogProps) {
  // `common` entra en el array para poder reutilizar sus claves (`common:…`):
  // las claves tipadas no cruzan namespaces sin el prefijo.
  const { t } = useTranslation(["settings", "common"]);
  const { theme, setTheme } = useTheme();
  // Idioma de la interfaz: `setLocale` persiste la elección y refresca el menú
  // nativo de la bandeja (ver `lib/i18n.ts`).
  const [locale, setLocale] = useLocale();
  // Cambiar un plugin reconstruye los engines del sidecar y devuelve el
  // catálogo de tools al día: se aplica al store para que los selectores de
  // tools (p. ej. el de subagentes) no sigan con el del arranque.
  const applyToolCatalog = useSession((s) => s.applyToolCatalog);
  const [section, setSection] = useState<SectionId>("models");
  const [config, setConfig] = useState<ConfigView | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [keyDrafts, setKeyDrafts] = useState<Record<string, string>>({});
  const [urlDrafts, setUrlDrafts] = useState<Record<string, string>>({});
  const [mcp, setMcp] = useState<McpState | null>(null);
  const [version, setVersion] = useState("0.0.0");
  const [logFilePath, setLogFilePath] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [update, setUpdate] = useState<UpdateInfo | null>(null);
  const [upToDate, setUpToDate] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [progress, setProgress] = useState(0);
  /** Preferencia local «cerrar a la bandeja» (no va en config.toml). */
  const [closeToTray, setCloseToTray] = useState(() => isCloseToTrayEnabled());
  /** Estado del dictado (sección Dictado): idioma/modelo y descarga. */
  const [stt, setStt] = useState<SttStatus | null>(null);
  const [sttSaving, setSttSaving] = useState(false);
  const [sttDownloading, setSttDownloading] = useState(false);
  const [sttPercent, setSttPercent] = useState<number | null>(null);
  /** Catálogo de plugins del engine (sección Plugins) y su formulario. */
  const [plugins, setPlugins] = useState<PluginsState | null>(null);
  const [pluginBusy, setPluginBusy] = useState<string | null>(null);
  // Instalación de extras: compartida con el composer y el aviso de arranque.
  const extraInstalling = useExtras((s) => s.installing);
  const extraPhase = useExtras((s) => s.phase);
  const installExtraShared = useExtras((s) => s.install);
  const [pluginSource, setPluginSource] = useState("");
  /** `input` = escribiendo el origen, `confirm` = confirmación explícita. */
  const [pluginStep, setPluginStep] = useState<"idle" | "input" | "confirm">("idle");
  const [pluginInstalling, setPluginInstalling] = useState(false);

  useEffect(() => {
    void currentVersion().then(setVersion);
    void logPath().then(setLogFilePath);
  }, []);

  const runUpdateCheck = async () => {
    setChecking(true);
    setUpdate(null);
    setUpToDate(false);
    try {
      const found = await checkForUpdates();
      setUpdate(found);
      setUpToDate(found === null);
    } catch (e) {
      toast.error(t("toasts.updateCheckFailed"), { description: String(e) });
    } finally {
      setChecking(false);
    }
  };

  const runInstall = async () => {
    setInstalling(true);
    setProgress(0);
    try {
      await installPendingUpdate(setProgress);
    } catch (e) {
      toast.error(t("toasts.installFailed"), { description: String(e) });
      setInstalling(false);
    }
  };

  useEffect(() => {
    if (!open || !sessionId) return;
    setLoading(true);
    setKeyDrafts({});
    setUrlDrafts({});
    phoson
      .getConfig(sessionId)
      .then(setConfig)
      .catch((e) => toast.error(t("toasts.configLoadFailed"), { description: String(e) }))
      .finally(() => setLoading(false));
    phoson
      .mcpGet(sessionId)
      .then(setMcp)
      .catch(() => setMcp(null));
    // Dictado: idioma/modelo configurados (la sección no depende de `config`).
    phoson
      .sttStatus()
      .then(setStt)
      .catch(() => setStt(null));
    // Plugins: catálogo y estado (el que gobierna es el sidecar; `config` no
    // trae los flags `enable_*` de los plugins).
    setPlugins(null);
    setPluginStep("idle");
    setPluginSource("");
    phoson
      .pluginsGet(sessionId)
      .then(setPlugins)
      .catch((e) => {
        setPlugins(null);
        toast.error(t("toasts.pluginsLoadFailed"), { description: String(e) });
      });
  }, [open, sessionId]);

  const patch = (p: Partial<ConfigView>) => setConfig((c) => (c ? { ...c, ...p } : c));

  // ── MCP ───────────────────────────────────────────────────────────────
  const [form, setForm] = useState({
    name: "",
    transport: "stdio",
    command: "",
    args: "",
    url: "",
    env: "",
  });
  const [formOpen, setFormOpen] = useState(false);

  const saveServer = async (name: string, server: Record<string, unknown>) => {
    if (!sessionId) return;
    try {
      const res = await phoson.mcpSave(sessionId, name, server);
      setMcp(res.mcp);
    } catch (e) {
      toast.error(t("toasts.mcpSaveFailed"), { description: String(e) });
    }
  };

  const removeServer = async (name: string) => {
    if (!sessionId) return;
    try {
      const res = await phoson.mcpRemove(sessionId, name);
      setMcp(res.mcp);
      toast.success(t("toasts.mcpRemoved", { name }));
    } catch (e) {
      toast.error(t("toasts.mcpRemoveFailed"), { description: String(e) });
    }
  };

  const addServer = async () => {
    const name = form.name.trim();
    if (!name) {
      toast.error(t("toasts.mcpNameRequired"));
      return;
    }
    // env: una entrada `CLAVE=valor` por línea.
    const env = Object.fromEntries(
      form.env
        .split("\n")
        .map((line) => line.split("="))
        .filter((parts) => parts.length >= 2 && parts[0].trim())
        .map((parts) => [parts[0].trim(), parts.slice(1).join("=").trim()]),
    );
    await saveServer(name, {
      transport: form.transport,
      command: form.command.trim(),
      args: form.args.split(/\s+/).filter(Boolean),
      url: form.url.trim(),
      enabled: true,
      env,
    });
    setForm({ name: "", transport: "stdio", command: "", args: "", url: "", env: "" });
    setFormOpen(false);
    toast.success(t("toasts.mcpAdded"), { description: name });
  };

  const save = async () => {
    if (!config || !sessionId) return;
    setSaving(true);
    try {
      const secrets = Object.fromEntries(
        Object.entries(keyDrafts).filter(([, v]) => v.trim().length > 0),
      );
      const baseUrls = Object.fromEntries(
        Object.entries(urlDrafts).filter(([, v]) => v.trim().length > 0),
      );
      const res = (await phoson.setConfig(
        sessionId,
        {
          provider: config.provider,
          model: config.model,
          subagentModel: config.subagentModel,
          reasoning_effort: config.reasoningEffort,
          safe_mode: config.safeMode,
          notify_on_completion: config.notifyOnCompletion,
          enable_mcp: config.enableMcp,
        },
        secrets,
        baseUrls,
      )) as { path?: string };
      toast.success(t("toasts.saved"), { description: res?.path ?? "~/.phoson/config.toml" });
      onOpenChange(false);
    } catch (e) {
      toast.error(t("toasts.saveFailed"), { description: String(e) });
    } finally {
      setSaving(false);
    }
  };

  /** Proveedores de suscripción: se autentican con OAuth, no con una clave. */
  const authProviders = config?.providers.filter((p) => p.auth) ?? [];
  const keyProviders = config?.providers.filter((p) => !p.auth && p.supportsKey !== false) ?? [];
  const localProviders = config?.providers.filter((p) => p.supportsBaseUrl) ?? [];
  /** Recarga el panel tras un login/logout (el token vive fuera del config). */
  const reloadConfig = () => {
    if (!sessionId) return;
    phoson.getConfig(sessionId).then(setConfig).catch(() => {});
  };

  // ── Dictado (idioma/modelo del motor STT) ─────────────────────────────
  /**
   * Idioma cuyo modelo conviene tener en caché: el que usará la próxima
   * captura. Es la misma resolución del compositor: el fijado en Ajustes, o si
   * no, el de la interfaz cuando el motor lo admite.
   */
  const sttTargetLanguage = stt
    ? (stt.configuredLanguage ?? pickSttLanguage(stt.languages, speechLocale(locale)) ?? undefined)
    : undefined;

  const saveStt = async (patch: { modelArch?: string | null; language?: string | null }) => {
    if (!sessionId || !stt) return;
    setSttSaving(true);
    try {
      const res = await phoson.sttConfigSet(sessionId, patch);
      if (!res.ok) {
        toast.error(t("toasts.sttSaveFailed"), { description: res.reason ?? "" });
        return;
      }
      if (res.status) setStt(res.status);
      toast.success(t("toasts.sttSaved"), { description: res.path ?? "~/.phoson/config.toml" });
      // El compositor re-sondea: su botón debe reflejar el idioma/modelo nuevo.
      window.dispatchEvent(new CustomEvent("phoson:stt-config-changed"));
    } catch (e) {
      toast.error(t("toasts.sttSaveFailed"), { description: String(e) });
    } finally {
      setSttSaving(false);
    }
  };

  const downloadSttModel = async () => {
    if (!sessionId || !stt) return;
    setSttDownloading(true);
    setSttPercent(null);
    let unsub: (() => void) | null = null;
    try {
      // Progreso en vivo (la pre-descarga emite `stt.progress` con percent).
      unsub = await phoson.onNotify((envelope) => {
        const params = envelope.params as { sessionId?: string; phase?: string; percent?: number };
        if (envelope.method !== "stt.progress" || params.sessionId !== sessionId) return;
        if (params.phase === "downloading" && typeof params.percent === "number") {
          setSttPercent(params.percent);
        }
      });
      const res = await phoson.sttDownload(sessionId, sttTargetLanguage);
      if (!res.ok) {
        toast.error(t("toasts.sttDownloadFailed"), { description: res.reason ?? "" });
      } else if (res.result === "cached") {
        toast.info(t("toasts.sttDownloadCached"), { description: res.language ?? "" });
      } else {
        toast.success(t("toasts.sttDownloaded"), { description: res.language ?? "" });
      }
    } catch (e) {
      toast.error(t("toasts.sttDownloadFailed"), { description: String(e) });
    } finally {
      unsub?.();
      setSttDownloading(false);
    }
  };

  // ── Plugins del engine ────────────────────────────────────────────────
  /**
   * Texto del bloqueo de un plugin a partir del **código** que manda el sidecar
   * (`dictation`, `peerName`, `file:<campo>`, `env:<VAR>`): el idioma lo pone la
   * UI, así que el sidecar nunca manda frases.
   */
  const pluginLockText = (code: string): string => {
    if (code === "dictation") return t("plugins.lock.dictation");
    if (code === "peerName") return t("plugins.lock.peerName");
    if (code.startsWith("file:")) return t("plugins.lock.file", { field: code.slice(5) });
    if (code.startsWith("env:")) return t("plugins.lock.env", { variable: code.slice(4) });
    return code;
  };

  /** Motivo por el que el sidecar no puede instalar plugins (si es el caso). */
  const pluginInstallBlockText = (reason: string): string => {
    if (reason === "frozen") return t("plugins.install.frozen");
    if (reason === "noUv") return t("plugins.install.noUv");
    return t("plugins.install.unavailable");
  };

  /**
   * Instala el extra que le falta a un plugin (sus dependencias opcionales:
   * `[stt]`, `[computeruse]`…). El sidecar lo instala en `~/.phoson/extras/` y
   * lo añade a su `sys.path`: el plugin funciona sin reiniciar la app. El store
   * avisa con el toast y actualiza las tools; aquí solo se refresca la lista.
   */
  const installExtra = async (extra: string) => {
    if (!sessionId) return;
    const res = await installExtraShared(sessionId, extra);
    if (res?.ok && res.plugins) {
      setPlugins((s) => (s ? { ...s, plugins: res.plugins as PluginEntry[] } : s));
    }
  };

  /** Refresca el catálogo de tools que alimenta los selectores (p. ej. subagentes). */
  const syncToolCatalog = (tools?: ToolCatalog) => {
    if (tools) applyToolCatalog(tools);
  };

  /** Activa o desactiva un plugin (el sidecar escribe config.toml y recarga). */
  const togglePlugin = async (plugin: PluginEntry, enabled: boolean) => {
    if (!sessionId) return;
    setPluginBusy(plugin.id);
    try {
      const res = await phoson.pluginsSet(sessionId, plugin.id, enabled);
      if (!res.ok) {
        toast.error(t("toasts.pluginToggleFailed"), {
          description: pluginLockText(res.detail ?? res.reason ?? ""),
        });
        return;
      }
      if (res.plugins) setPlugins((s) => (s ? { ...s, plugins: res.plugins as PluginEntry[] } : s));
      // El sidecar ya escribió el flag en config.toml: si el plugin gobierna
      // `enable_mcp` (el mismo campo que edita la sección MCP), se sincroniza la
      // copia local para que «Guardar» no reescriba el valor viejo y deshaga el
      // toggle.
      if (plugin.flag === "enable_mcp") patch({ enableMcp: enabled });
      syncToolCatalog(res.tools);
      toast.success(
        enabled ? t("toasts.pluginEnabled") : t("toasts.pluginDisabled"),
        { description: plugin.name },
      );
    } catch (e) {
      toast.error(t("toasts.pluginToggleFailed"), { description: String(e) });
    } finally {
      setPluginBusy(null);
    }
  };

  /**
   * Instala un plugin de terceros. Solo se llama desde la confirmación (el
   * origen ya está a la vista); el sidecar además exige `confirmed` para que
   * ninguna otra ruta del RPC instale código sin pasar por aquí.
   */
  const installPlugin = async () => {
    const source = pluginSource.trim();
    if (!sessionId || !source) return;
    setPluginInstalling(true);
    try {
      const res = await phoson.pluginsInstall(sessionId, source);
      if (!res.ok) {
        toast.error(t("toasts.pluginInstallFailed"), {
          description: pluginInstallBlockText(res.reason ?? ""),
        });
        return;
      }
      if (res.plugins) setPlugins((s) => (s ? { ...s, plugins: res.plugins as PluginEntry[] } : s));
      syncToolCatalog(res.tools);
      toast.success(t("toasts.pluginInstalled"), { description: res.name ?? source });
      setPluginSource("");
      setPluginStep("idle");
    } catch (e) {
      // El engine falla con el detalle útil (entry points, git, pip): se muestra.
      toast.error(t("toasts.pluginInstallFailed"), { description: String(e) });
    } finally {
      setPluginInstalling(false);
    }
  };

  /**
   * Proveedores que el selector de "Proveedor activo" puede ofrecer: los que
   * tienen credencial (clave configurada o `base_url` local vista por el
   * engine), los que funcionan sin credencial (Ollama/LM Studio/Bedrock) y el
   * activo actual — que siempre debe aparecer para no dejar el `Select` vacío.
   */
  const activeProviders = useMemo(() => {
    if (!config) return [];
    const enabled = new Set(config.enabledProviders ?? []);
    return config.providers.filter(
      (p) =>
        p.id === config.provider ||
        p.hasKey ||
        (p.supportsKey === false && !p.auth) ||
        enabled.has(p.id),
    );
  }, [config]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl gap-0 overflow-hidden p-0 sm:max-w-3xl">
        <DialogHeader className="px-5 py-4">
          <DialogTitle className="text-base">{t("dialog.title")}</DialogTitle>
          <DialogDescription className="text-xs">
            <Trans
              t={t}
              i18nKey="dialog.subtitle"
              components={{ cli: <span className="text-violet-soft" /> }}
            />
          </DialogDescription>
        </DialogHeader>
        <Separator />

        <div className="flex h-[min(68vh,540px)] min-h-0 min-w-0">
          {/* ── Navegación de secciones ─────────────────────────────── */}
          <nav className="w-52 shrink-0 space-y-0.5 border-r border-[var(--dashboard-border)] p-2">
            {SECTIONS.map(({ id, icon: Icon }) => {
              const active = id === section;
              return (
                <button
                  key={id}
                  onClick={() => setSection(id)}
                  className={cn(
                    "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[0.8125rem] transition-colors",
                    active
                      ? "bg-[var(--phoson-surface-2)] text-foreground"
                      : "text-muted-foreground dashboard-hover hover:text-foreground",
                  )}
                >
                  <Icon className={cn("size-4 shrink-0", active ? "text-violet" : "opacity-70")} />
                  <span className="truncate">{t(`sections.${id}`)}</span>
                </button>
              );
            })}
          </nav>

          {/* ── Contenido de la sección ─────────────────────────────── */}
          <div className="min-h-0 min-w-0 flex-1 overflow-y-auto">
            <div className="p-5">
              {loading || !config ? (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="size-3.5 animate-spin" /> {t("common:state.loading")}
                </div>
              ) : (
                <>
                  {/* Modelos */}
                  {section === "models" && (
                    <div className="space-y-5">
                      <SectionTitle
                        title={t("models.title")}
                        hint={t("models.hint")}
                      />
                      <div className="space-y-1.5">
                        <Label className="text-xs">{t("models.provider")}</Label>
                        <Select
                          value={config.provider}
                          onValueChange={(v) => patch({ provider: v })}
                        >
                          <SelectTrigger className="h-9 w-full text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {activeProviders.map((p) => (
                              <SelectItem key={p.id} value={p.id} className="text-xs">
                                <span className="flex items-center gap-2">
                                  <ProviderLogo id={p.id} size={14} />
                                  {providerLabel(p.id)}
                                </span>
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {config.providers.length > activeProviders.length && (
                          <p className="text-[0.68rem] text-muted-foreground">
                            {t("models.providerCount", {
                              available: activeProviders.length,
                              total: config.providers.length,
                            })}
                            <button
                              type="button"
                              onClick={() => setSection("providers")}
                              className="ml-1 text-violet underline-offset-2 hover:underline"
                            >
                              {t("models.addKeys")}
                            </button>
                          </p>
                        )}
                      </div>

                      <div className="space-y-1.5">
                        <Label className="text-xs">{t("models.primary")}</Label>
                        <ModelCombobox
                          sessionId={sessionId}
                          provider={config.provider}
                          value={config.model}
                          onChange={(v) => patch({ model: v })}
                        />
                        <p className="text-[0.68rem] text-muted-foreground">
                          {t("models.pickHint")}
                        </p>
                      </div>

                      <div className="space-y-1.5">
                        <Label className="text-xs">{t("models.subagent")}</Label>
                        <ModelCombobox
                          sessionId={sessionId}
                          provider={config.provider}
                          value={config.subagentModel}
                          onChange={(v) => patch({ subagentModel: v })}
                        />
                        <p className="text-[0.68rem] text-muted-foreground">
                          {t("models.subagentHint")}
                        </p>
                      </div>

                      <div className="space-y-1.5">
                        <Label className="text-xs">{t("models.reasoning")}</Label>
                        <Select
                          value={config.reasoningEffort ?? "auto"}
                          onValueChange={(v) => patch({ reasoningEffort: v === "auto" ? null : v })}
                        >
                          <SelectTrigger className="h-9 w-full text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {["auto", ...REASONING_EFFORTS].map((e) => (
                              <SelectItem key={e} value={e} className="text-xs">
                                {/* `effortLabel` resuelve el idioma en cada llamada:
                                    el `useTranslation` de arriba ya re-renderiza al
                                    cambiarlo, así que la etiqueta sale reactiva. */}
                                {effortLabel(e === "auto" ? null : e)}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  )}

                  {/* Proveedores (claves) */}
                  {section === "providers" && (
                    <div className="space-y-5">
                      <SectionTitle
                        title={t("providers.title")}
                        hint={t("providers.hint")}
                      />
                      {authProviders.length > 0 && (
                        <div className="space-y-2">
                          <SectionTitle
                            title={t("providers.subscriptions")}
                            hint={t("providers.subscriptionsHint")}
                          />
                          {authProviders.map((p) => (
                            <div key={p.id} className="flex items-center gap-2">
                              <ProviderLogo
                                id={p.id}
                                size={15}
                                className="text-muted-foreground"
                              />
                              <span className="w-28 shrink-0 truncate text-xs">
                                {providerLabel(p.id)}
                              </span>
                              {p.loggedIn ? (
                                <ProviderAccount
                                  provider={p.id}
                                  label={providerLabel(p.id)}
                                  account={p.account}
                                  plan={p.plan}
                                  onSignedOut={reloadConfig}
                                />
                              ) : (
                                <ProviderSignIn
                                  provider={p.id}
                                  label={providerLabel(p.id)}
                                  method={p.id === "chatgpt" ? "device" : "browser"}
                                  onDone={reloadConfig}
                                />
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                      <div className="space-y-2">
                        {keyProviders.map((p) => (
                          <div key={p.id} className="flex items-center gap-2">
                            <ProviderLogo id={p.id} size={15} className="text-muted-foreground" />
                            <span className="w-28 shrink-0 truncate text-xs">
                              {providerLabel(p.id)}
                            </span>
                            <span
                              className={cn(
                                "flex w-24 shrink-0 items-center gap-1 text-[0.65rem]",
                                p.hasKey ? "text-success" : "text-muted-foreground",
                              )}
                            >
                              {p.hasKey ? <Check className="size-3" /> : <KeyRound className="size-3" />}
                              {t(`providers.source.${p.source}`)}
                            </span>
                            {PROVIDER_META[p.id]?.keysUrl && (
                              <a
                                href={PROVIDER_META[p.id].keysUrl}
                                target="_blank"
                                rel="noreferrer"
                                title={t("providers.getKey")}
                                className="shrink-0 text-muted-foreground transition-colors hover:text-violet"
                              >
                                <ExternalLink className="size-3" />
                              </a>
                            )}
                            <Input
                              type="password"
                              className="h-7 font-mono text-xs"
                              placeholder={
                                p.hasKey ? t("providers.keyDefined") : t("providers.keyPlaceholder")
                              }
                              value={keyDrafts[p.id] ?? ""}
                              onChange={(e) => setKeyDrafts((d) => ({ ...d, [p.id]: e.target.value }))}
                            />
                          </div>
                        ))}
                      </div>
                      {/* La nota es texto del catálogo: se resuelve en el idioma
                          activo (el `useTranslation` de arriba re-renderiza al cambiarlo). */}
                      {providerNote("bedrock") && (
                        <p className="text-[0.68rem] text-muted-foreground">
                          <span className="text-foreground/70">AWS Bedrock:</span>{" "}
                          {providerNote("bedrock")}.
                        </p>
                      )}
                    </div>
                  )}

                  {/* Servidores locales */}
                  {section === "local" && (
                    <div className="space-y-5">
                      <SectionTitle
                        title={t("local.title")}
                        hint={t("local.hint")}
                      />
                      <div className="space-y-2">
                        {localProviders.map((p) => (
                          <div key={p.id} className="flex items-center gap-2">
                            <ProviderLogo id={p.id} size={15} className="text-muted-foreground" />
                            <span className="w-28 shrink-0 truncate text-xs">
                              {providerLabel(p.id)}
                            </span>
                            <Input
                              className="h-7 font-mono text-xs"
                              placeholder={t("local.urlPlaceholder")}
                              value={urlDrafts[p.id] ?? p.baseUrl ?? ""}
                              onChange={(e) => setUrlDrafts((d) => ({ ...d, [p.id]: e.target.value }))}
                            />
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* MCP */}
                  {section === "mcp" && (
                    <div className="space-y-5">
                      <div className="flex items-start justify-between gap-4">
                        <SectionTitle
                          title={t("mcp.title")}
                          hint={t("mcp.hint")}
                        />
                        <Button
                          size="sm"
                          className="h-8 shrink-0 gap-1.5 bg-violet text-xs text-white hover:bg-violet/90"
                          onClick={() => setFormOpen((o) => !o)}
                        >
                          <Plus className="size-3.5" /> {t("common:actions.add")}
                        </Button>
                      </div>

                      <Row
                        label={t("mcp.enable")}
                        hint={mcp?.configPath ?? "~/.phoson/mcps.json"}
                      >
                        <Switch
                          checked={!!config.enableMcp}
                          onCheckedChange={(v) => patch({ enableMcp: v })}
                        />
                      </Row>

                      {mcp && !mcp.sdkAvailable && (
                        <p className="rounded-lg bg-warning/10 px-3 py-2 text-[0.68rem] text-warning">
                          <Trans
                            t={t}
                            i18nKey="mcp.sdkMissing"
                            components={{
                              pkg: <span className="font-mono" />,
                              cmd: <span className="font-mono" />,
                            }}
                          />
                        </p>
                      )}

                      <div className="space-y-2">
                        {(mcp?.servers ?? []).length === 0 && (
                          <p className="text-[0.7rem] text-muted-foreground">
                            {t("mcp.empty")}
                          </p>
                        )}
                        {(mcp?.servers ?? []).map((s) => (
                          <div
                            key={s.name}
                            className="flex items-center gap-2 rounded-lg bg-[var(--phoson-surface-2)] px-3 py-2"
                          >
                            <McpLogo name={s.name} size={16} className="text-violet" />
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2">
                                <span className="truncate text-xs">{s.name}</span>
                                <span className="shrink-0 rounded border border-[var(--dashboard-border)] px-1.5 py-0.5 text-[0.6rem] uppercase text-muted-foreground">
                                  {s.transport}
                                </span>
                              </div>
                              <div className="truncate font-mono text-[0.65rem] text-muted-foreground">
                                {s.url ||
                                  [s.command, ...(s.args ?? [])].filter(Boolean).join(" ") ||
                                  "—"}
                                {s.envKeys.length > 0 && ` · env: ${s.envKeys.join(", ")}`}
                              </div>
                            </div>
                            <Switch
                              checked={s.enabled}
                              onCheckedChange={(v) => void saveServer(s.name, { enabled: v })}
                            />
                            <button
                              onClick={() => void removeServer(s.name)}
                              title={t("common:actions.delete")}
                              className="grid size-7 place-items-center rounded-md text-muted-foreground transition-colors dashboard-hover hover:text-destructive"
                            >
                              <Trash2 className="size-3.5" />
                            </button>
                          </div>
                        ))}
                      </div>

                      {formOpen && (
                        <div className="space-y-4 rounded-xl border border-[var(--dashboard-border)] p-4">
                          <div className="flex items-center justify-between gap-3">
                            <span className="text-xs font-medium">{t("mcp.newServer")}</span>
                            <button
                              onClick={() => setFormOpen(false)}
                              className="text-[0.7rem] text-muted-foreground transition-colors hover:text-foreground"
                            >
                              {t("common:actions.cancel")}
                            </button>
                          </div>

                          <div>
                            <Label className="text-[0.7rem] text-muted-foreground">
                              {t("mcp.template")}
                            </Label>
                            <div className="mt-1.5 flex flex-wrap gap-1.5">
                              {MCP_PRESETS.map((preset) => (
                                <button
                                  key={preset.label}
                                  onClick={() =>
                                    setForm({
                                      name: preset.name,
                                      transport: preset.transport,
                                      command: preset.command,
                                      args: preset.args,
                                      url: "",
                                      env: preset.env,
                                    })
                                  }
                                  className="flex items-center gap-1.5 rounded-full border border-[var(--dashboard-border)] px-2.5 py-1 text-[0.68rem] text-muted-foreground transition-colors dashboard-hover hover:text-violet"
                                >
                                  <McpLogo name={preset.name} size={13} />
                                  {preset.label}
                                </button>
                              ))}
                            </div>
                          </div>

                          <Field label={t("common:words.name")} hint={t("mcp.nameHint")}>
                            <Input
                              className="h-8 text-xs"
                              placeholder={t("mcp.namePlaceholder")}
                              value={form.name}
                              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                            />
                          </Field>

                          <Field
                            label={t("mcp.transport")}
                            hint={t("mcp.transportHint")}
                          >
                            <Select
                              value={form.transport}
                              onValueChange={(v) => setForm((f) => ({ ...f, transport: v }))}
                            >
                              <SelectTrigger className="h-8 w-full text-xs">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {["stdio", "sse", "http"].map((t) => (
                                  <SelectItem key={t} value={t} className="text-xs">
                                    {t}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </Field>

                          {form.transport === "stdio" ? (
                            <Field
                              label={t("mcp.command")}
                              hint={t("mcp.commandHint")}
                            >
                              <div className="flex gap-2">
                                <Input
                                  className="h-8 w-28 shrink-0 font-mono text-xs"
                                  placeholder="npx"
                                  value={form.command}
                                  onChange={(e) =>
                                    setForm((f) => ({ ...f, command: e.target.value }))
                                  }
                                />
                                <Input
                                  className="h-8 min-w-0 flex-1 font-mono text-xs"
                                  placeholder="-y @modelcontextprotocol/server-filesystem /tmp"
                                  value={form.args}
                                  onChange={(e) => setForm((f) => ({ ...f, args: e.target.value }))}
                                />
                              </div>
                            </Field>
                          ) : (
                            <Field label={t("mcp.url")} hint={t("mcp.urlHint")}>
                              <Input
                                className="h-8 font-mono text-xs"
                                placeholder={t("mcp.urlPlaceholder")}
                                value={form.url}
                                onChange={(e) => setForm((f) => ({ ...f, url: e.target.value }))}
                              />
                            </Field>
                          )}

                          <Field
                            label={t("mcp.env")}
                            hint={t("mcp.envHint")}
                          >
                            <textarea
                              className="h-16 w-full resize-none rounded-md border border-[var(--dashboard-border)] bg-transparent p-2 font-mono text-[0.7rem] outline-none focus:border-violet"
                              placeholder={t("mcp.envPlaceholder")}
                              value={form.env}
                              onChange={(e) => setForm((f) => ({ ...f, env: e.target.value }))}
                            />
                          </Field>

                          <div className="flex justify-end gap-2">
                            <Button variant="ghost" size="sm" onClick={() => setFormOpen(false)}>
                              {t("common:actions.cancel")}
                            </Button>
                            <Button
                              size="sm"
                              className="gap-1.5 bg-violet text-xs text-white hover:bg-violet/90"
                              onClick={() => void addServer()}
                            >
                              <Plus className="size-3.5" /> {t("mcp.addServer")}
                            </Button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Plugins del engine: los que trae la app y los instalados.
                      El estado vive en config.toml (flags `enable_*` y/o las
                      listas de specs); el sidecar lo escribe y recarga solo. */}
                  {section === "plugins" && (
                    <div className="space-y-5">
                      <SectionTitle title={t("plugins.title")} hint={t("plugins.hint")} />

                      {!plugins ? (
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <Loader2 className="size-3.5 animate-spin" /> {t("common:state.loading")}
                        </div>
                      ) : (
                        <>
                          {/* Instalación: solo si el sidecar tiene intérprete real
                              y `uv` (la app empaquetada no puede: lleva el motor
                              dentro). */}
                          {!plugins.canInstall ? (
                            <p className="rounded-lg border border-[var(--dashboard-border)] bg-[var(--phoson-surface-2)] p-3 text-[0.7rem] leading-relaxed text-muted-foreground">
                              {pluginInstallBlockText(plugins.installBlocked)}
                            </p>
                          ) : pluginStep === "idle" ? (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-8 gap-1.5 border border-[var(--dashboard-border)] text-xs"
                              onClick={() => setPluginStep("input")}
                            >
                              <Plus className="size-3.5" /> {t("plugins.install.action")}
                            </Button>
                          ) : (
                            <div className="space-y-3 rounded-xl border border-[var(--dashboard-border)] p-4">
                              {pluginStep === "input" ? (
                                <Field
                                  label={t("plugins.install.source")}
                                  hint={t("plugins.install.sourceHint")}
                                >
                                  <Input
                                    className="h-8 font-mono text-xs"
                                    placeholder={t("plugins.install.sourcePlaceholder")}
                                    value={pluginSource}
                                    onChange={(e) => setPluginSource(e.target.value)}
                                  />
                                </Field>
                              ) : (
                                <>
                                  <span className="text-xs font-medium">
                                    {t("plugins.install.confirmTitle")}
                                  </span>
                                  <p className="break-all rounded-md bg-[var(--phoson-surface-2)] px-2 py-1.5 font-mono text-[0.7rem]">
                                    {pluginSource.trim()}
                                  </p>
                                </>
                              )}

                              <p className="rounded-lg bg-destructive/10 px-3 py-2 text-[0.68rem] leading-snug text-destructive">
                                {t("plugins.install.warning")}
                              </p>
                              {pluginStep === "confirm" && (
                                <p className="text-[0.65rem] leading-snug text-muted-foreground">
                                  {t("plugins.install.slow")}
                                </p>
                              )}

                              <div className="flex justify-end gap-2">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  disabled={pluginInstalling}
                                  onClick={() => {
                                    if (pluginStep === "confirm") setPluginStep("input");
                                    else {
                                      setPluginStep("idle");
                                      setPluginSource("");
                                    }
                                  }}
                                >
                                  {pluginStep === "confirm"
                                    ? t("common:actions.back")
                                    : t("common:actions.cancel")}
                                </Button>
                                {pluginStep === "input" ? (
                                  <Button
                                    size="sm"
                                    className="gap-1.5 bg-violet text-xs text-white hover:bg-violet/90"
                                    disabled={!pluginSource.trim()}
                                    onClick={() => setPluginStep("confirm")}
                                  >
                                    {t("common:actions.continue")}
                                  </Button>
                                ) : (
                                  <Button
                                    size="sm"
                                    className="gap-1.5 bg-violet text-xs text-white hover:bg-violet/90"
                                    disabled={pluginInstalling}
                                    onClick={() => void installPlugin()}
                                  >
                                    {pluginInstalling ? (
                                      <Loader2 className="size-3.5 animate-spin" />
                                    ) : (
                                      <Plus className="size-3.5" />
                                    )}
                                    {pluginInstalling
                                      ? t("plugins.install.installing")
                                      : t("plugins.install.confirm")}
                                  </Button>
                                )}
                              </div>
                            </div>
                          )}

                          <div className="space-y-2">
                            {plugins.plugins.length === 0 && (
                              <p className="text-xs text-muted-foreground">{t("plugins.empty")}</p>
                            )}
                            {plugins.plugins.map((p) => (
                              <div
                                key={p.id}
                                className="flex items-start gap-3 rounded-lg bg-[var(--phoson-surface-2)] px-3 py-2.5"
                              >
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-center gap-2">
                                    <span className="truncate text-xs">{p.name}</span>
                                    {!p.official && (
                                      <span className="shrink-0 rounded border border-[var(--dashboard-border)] px-1.5 py-0.5 text-[0.6rem] uppercase text-muted-foreground">
                                        {t("plugins.badge.community")}
                                      </span>
                                    )}
                                    {p.locked && (
                                      <Lock
                                        className="size-3 shrink-0 text-muted-foreground"
                                        aria-label={pluginLockText(p.lockReason)}
                                      />
                                    )}
                                  </div>
                                  <div className="truncate text-[0.65rem] text-muted-foreground">
                                    {p.description || p.id}
                                  </div>
                                  {p.description && p.id !== p.name && (
                                    <div className="truncate font-mono text-[0.62rem] text-muted-foreground">
                                      {p.id}
                                    </div>
                                  )}
                                  {p.locked && (
                                    <div className="text-[0.62rem] leading-snug text-muted-foreground">
                                      {pluginLockText(p.lockReason)}
                                    </div>
                                  )}
                                  {/* Activo pero sin su extra: el motor lo salta. Se
                                      puede arreglar desde aquí (el sidecar instala
                                      las dependencias que falten). */}
                                  {p.enabled && p.missingExtra && (
                                    <div className="mt-1 space-y-1">
                                      <div className="text-[0.62rem] leading-snug text-warning">
                                        {t("plugins.missingExtra", { extra: p.missingExtra })}
                                      </div>
                                      {plugins.canInstallExtras ? (
                                        <Button
                                          size="sm"
                                          variant="ghost"
                                          className="h-6 gap-1.5 px-2 text-[0.65rem] text-violet hover:bg-[var(--phoson-surface-3)] hover:text-violet"
                                          disabled={extraInstalling !== null}
                                          onClick={() => void installExtra(p.missingExtra)}
                                        >
                                          {extraInstalling === p.missingExtra ? (
                                            <Loader2 className="size-3 animate-spin" />
                                          ) : (
                                            <Download className="size-3" />
                                          )}
                                          {extraInstalling === p.missingExtra
                                            ? extraPhaseText(extraPhase)
                                            : t("plugins.extra.install", { extra: p.missingExtra })}
                                        </Button>
                                      ) : (
                                        <p className="text-[0.62rem] leading-snug text-muted-foreground">
                                          {extraInstallBlockText(plugins.installExtrasBlocked, p.missingExtra)}
                                        </p>
                                      )}
                                    </div>
                                  )}
                                </div>
                                {pluginBusy === p.id || pluginInstalling ? (
                                  <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin text-muted-foreground" />
                                ) : (
                                  <Switch
                                    className="mt-0.5 shrink-0"
                                    checked={p.enabled}
                                    disabled={p.locked}
                                    aria-label={p.name}
                                    onCheckedChange={(v) => void togglePlugin(p, v)}
                                  />
                                )}
                              </div>
                            ))}
                          </div>

                          <p className="font-mono text-[0.62rem] text-muted-foreground">
                            {plugins.configPath}
                          </p>
                        </>
                      )}
                    </div>
                  )}

                  {/* Agente y sesiones */}
                  {section === "agent" && (
                    <div className="space-y-5">
                      <SectionTitle title={t("agent.title")} />
                      <Row
                        label={t("agent.safeMode")}
                        hint={t("agent.safeModeHint")}
                      >
                        <Switch
                          checked={config.safeMode}
                          onCheckedChange={(v) => patch({ safeMode: v })}
                        />
                      </Row>
                      <Separator />
                      <div className="space-y-1.5">
                        <Label className="text-xs">{t("agent.sessionsDir")}</Label>
                        <Input
                          className="h-8 font-mono text-xs opacity-70"
                          value={config.sessionsDir}
                          readOnly
                        />
                      </div>
                    </div>
                  )}

                  {/* Dictado: idioma y modelo del motor STT (Moonshine). */}
                  {section === "dictation" && (
                    <div className="space-y-5">
                      <SectionTitle
                        title={t("dictation.title")}
                        hint={t("dictation.hint")}
                      />
                      {!stt ? (
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <Loader2 className="size-3.5 animate-spin" /> {t("common:state.loading")}
                        </div>
                      ) : !stt.supported ? (
                        <p className="rounded-lg border border-[var(--dashboard-border)] bg-[var(--phoson-surface-2)] p-3 text-xs leading-relaxed text-muted-foreground">
                          {stt.reason ?? t("dictation.unsupported")}
                        </p>
                      ) : (
                        <>
                          <Row
                            label={t("dictation.language")}
                            hint={t("dictation.languageHint")}
                          >
                            <Select
                              value={stt.configuredLanguage ?? "auto"}
                              onValueChange={(v) => void saveStt({ language: v === "auto" ? null : v })}
                              disabled={sttSaving}
                            >
                              <SelectTrigger className="h-8 w-44 text-xs">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="auto" className="text-xs">
                                  {t("dictation.languageAuto")}
                                </SelectItem>
                                {stt.languages.map((code) => (
                                  <SelectItem key={code} value={code} className="text-xs">
                                    {stt.languageNames?.[code] ?? code}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </Row>
                          {stt.languageSource && (
                            <p className="text-[0.68rem] text-muted-foreground">
                              {t("dictation.sourceNote", { source: stt.languageSource })}
                            </p>
                          )}
                          <Row
                            label={t("dictation.model")}
                            hint={t("dictation.modelHint")}
                          >
                            <Select
                              value={stt.modelName ?? "default"}
                              onValueChange={(v) => void saveStt({ modelArch: v === "default" ? null : v })}
                              disabled={sttSaving}
                            >
                              <SelectTrigger className="h-8 w-44 text-xs">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="default" className="text-xs">
                                  {t("dictation.modelDefault")}
                                </SelectItem>
                                {(stt.arches ?? []).map((arch) => (
                                  <SelectItem key={arch} value={arch} className="text-xs">
                                    {arch}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </Row>
                          {stt.archSource && (
                            <p className="text-[0.68rem] text-muted-foreground">
                              {t("dictation.sourceNote", { source: stt.archSource })}
                            </p>
                          )}
                          <Row
                            label={t("dictation.download")}
                            hint={t("dictation.downloadHint")}
                          >
                            <Button
                              size="sm"
                              variant="ghost"
                              className="gap-1.5"
                              disabled={sttDownloading}
                              onClick={() => void downloadSttModel()}
                            >
                              {sttDownloading ? (
                                <Loader2 className="size-3.5 animate-spin" />
                              ) : (
                                <Mic className="size-3.5" />
                              )}
                              {sttDownloading ? t("dictation.downloading") : t("dictation.downloadNow")}
                            </Button>
                          </Row>
                          {sttDownloading && sttPercent !== null && (
                            <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                              <div
                                className="h-full bg-violet transition-[width]"
                                style={{ width: `${sttPercent}%` }}
                              />
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  )}

                  {/* Escritorio: notificaciones del sistema y bandeja (tray). */}
                  {section === "desktop" && (
                    <div className="space-y-5">
                      <SectionTitle
                        title={t("desktop.title")}
                        hint={t("desktop.hint")}
                      />
                      <Row
                        label={t("desktop.notify")}
                        hint={t("desktop.notifyHint")}
                      >
                        <Select
                          value={config.notifyOnCompletion || "desktop"}
                          onValueChange={(v) => patch({ notifyOnCompletion: v })}
                        >
                          <SelectTrigger className="h-8 w-40 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {NOTIFY_MODES.map((mode) => (
                              <SelectItem key={mode} value={mode} className="text-xs">
                                {t(`desktop.notifyMode.${mode}`)}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </Row>
                      <Row
                        label={t("desktop.closeToTray")}
                        hint={t("desktop.closeToTrayHint")}
                      >
                        <Switch
                          checked={closeToTray}
                          onCheckedChange={(v) => {
                            setCloseToTray(v);
                            setCloseToTrayPref(v);
                          }}
                        />
                      </Row>
                      {isTauri() && (
                        <Row
                          label={t("desktop.sendToTray")}
                          hint={t("desktop.sendToTrayHint")}
                        >
                          <Button
                            size="sm"
                            variant="ghost"
                            className="gap-1.5"
                            onClick={() => void hideToTray()}
                          >
                            <AppWindow className="size-3.5" /> {t("common:actions.send")}
                          </Button>
                        </Row>
                      )}
                    </div>
                  )}

                  {/* Apariencia */}
                  {section === "appearance" && (
                    <div className="space-y-5">
                      <SectionTitle
                        title={t("appearance.title")}
                        hint={t("appearance.hint")}
                      />
                      <div className="flex flex-wrap gap-6">
                        {(
                          [
                            { id: "light", label: t("appearance.theme.light"), Icon: Sun },
                            { id: "dark", label: t("appearance.theme.dark"), Icon: Moon },
                            { id: "system", label: t("appearance.theme.system"), Icon: Monitor },
                          ] as const
                        ).map(({ id, label, Icon }) => (
                          <button
                            key={id}
                            onClick={() => setTheme(id)}
                            className={cn(
                              "flex items-center gap-2.5 text-sm transition-colors",
                              theme === id
                                ? "text-violet"
                                : "text-muted-foreground hover:text-foreground",
                            )}
                          >
                            <Icon className="size-4" />
                            {label}
                          </button>
                        ))}
                      </div>

                      {/* Idioma: mismo patrón que el selector de tema (fila de
                          botones, el activo en violeta). Los nombres de los
                          idiomas van en su propio idioma y NO se traducen, por
                          eso no viven en el catálogo. */}
                      <div className="space-y-1.5">
                        <div>
                          <div className="text-xs">{t("appearance.language")}</div>
                          <div className="text-[0.65rem] text-muted-foreground">
                            {t("appearance.languageHint")}
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-6">
                          {(
                            [
                              { id: "es", label: "Español" }, // i18n-ignore: cada idioma en su idioma
                              { id: "en", label: "English" }, // i18n-ignore: idem
                            ] as const
                          ).map(({ id, label }) => (
                            <button
                              key={id}
                              onClick={() => setLocale(id)}
                              className={cn(
                                "flex items-center gap-2.5 text-sm transition-colors",
                                locale === id
                                  ? "text-violet"
                                  : "text-muted-foreground hover:text-foreground",
                              )}
                            >
                              {label}
                            </button>
                          ))}
                        </div>
                      </div>

                      {onRestartOnboarding && (
                        <>
                          <Separator />
                          <Row
                            label={t("appearance.onboarding")}
                            hint={t("appearance.onboardingHint")}
                          >
                            <Button size="sm" variant="ghost" onClick={onRestartOnboarding}>
                              {t("appearance.restart")}
                            </Button>
                          </Row>
                        </>
                      )}
                    </div>
                  )}

                  {/* Acerca de / actualizaciones */}
                  {section === "about" && (
                    <div className="space-y-5">
                      <SectionTitle
                        title={t("about.title")}
                        hint={t("about.hint")}
                      />
                      <Row label={t("about.installed")} hint="Phoson Desktop">
                        <span className="font-mono text-xs text-muted-foreground">v{version}</span>
                      </Row>

                      <Row
                        label={t("about.logs")}
                        hint={t("about.logsHint")}
                      >
                        <div className="flex items-center gap-2">
                          {logFilePath && (
                            <span
                              className="max-w-[16rem] truncate font-mono text-[0.68rem] text-muted-foreground"
                              title={logFilePath}
                            >
                              {logFilePath}
                            </span>
                          )}
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={!isTauri()}
                            onClick={() => void openLogFolder()}
                          >
                            <FolderOpen className="size-3.5" />
                            {t("about.openFolder")}
                          </Button>
                        </div>
                      </Row>

                      <Separator />

                      {update ? (
                        <div className="space-y-3">
                          <p className="text-sm text-foreground">
                            <Trans
                              t={t}
                              i18nKey="about.updateAvailable"
                              values={{ version: update.version }}
                              components={{ version: <span className="font-medium text-violet" /> }}
                            />
                          </p>
                          {update.notes && (
                            <p className="max-h-32 overflow-auto whitespace-pre-wrap rounded-lg bg-[var(--phoson-surface-2)] p-3 text-xs text-muted-foreground">
                              {update.notes}
                            </p>
                          )}
                          {installing && (
                            <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                              <div
                                className="h-full bg-violet transition-[width]"
                                style={{ width: `${Math.round(progress * 100)}%` }}
                              />
                            </div>
                          )}
                          <Button
                            size="sm"
                            className="bg-violet text-white hover:bg-violet/90"
                            disabled={installing}
                            onClick={() => void runInstall()}
                          >
                            {installing ? (
                              <Loader2 className="size-3.5 animate-spin" />
                            ) : (
                              <RefreshCw className="size-3.5" />
                            )}
                            {t("about.download")}
                          </Button>
                        </div>
                      ) : (
                        <Row
                          label={t("about.updates")}
                          hint={upToDate ? t("about.upToDate") : t("about.checkUpdate")}
                        >
                          <Button size="sm" variant="ghost" disabled={checking} onClick={() => void runUpdateCheck()}>
                            {checking ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
                            {t("common:actions.search")}
                          </Button>
                        </Row>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>

        <Separator />
        <div className="flex items-center gap-2 px-5 py-3">
          <span className="flex-1 truncate text-[0.68rem] text-muted-foreground">
            ~/.phoson/config.toml
          </span>
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            {t("common:actions.cancel")}
          </Button>
          <Button
            size="sm"
            className="bg-violet text-white hover:bg-violet/90"
            disabled={saving || loading || !config}
            onClick={() => void save()}
          >
            {saving ? <Loader2 className="size-3.5 animate-spin" /> : null} {t("common:actions.save")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Campo con etiqueta y ayuda — usado por el formulario MCP. */
function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      {children}
      {hint && <p className="text-[0.65rem] leading-snug text-muted-foreground">{hint}</p>}
    </div>
  );
}

function SectionTitle({ title, hint }: { title: string; hint?: string }) {  return (
    <div>
      <h3 className="text-sm font-medium">{title}</h3>
      {hint && <p className="mt-0.5 text-[0.7rem] text-muted-foreground">{hint}</p>}
    </div>
  );
}

function Row({
  label,
  hint,
  children,
}: {
  label: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="min-w-0">
        <div className="text-xs">{label}</div>
        <div className="text-[0.65rem] text-muted-foreground">{hint}</div>
      </div>
      {children}
    </div>
  );
}
