import {
  Check,
  Cpu,
  ExternalLink,
  Info,
  KeyRound,
  Loader2,
  Monitor,
  Moon,
  Palette,
  Plug,
  Plus,
  RefreshCw,
  Server,
  ShieldCheck,
  Sun,
  Trash2,
} from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useState, type ComponentType } from "react";
import { toast } from "sonner";

import { phoson } from "@/bridge/client";
import type { ConfigView, McpState } from "@/bridge/protocol";
import { ProviderLogo } from "@/components/provider-logo";
import { McpLogo } from "@/components/mcp-logo";
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
import { REASONING_EFFORTS, effortLabel } from "@/lib/reasoning";
import { PROVIDER_META, providerLabel } from "@/lib/providers";
import { checkForUpdates, currentVersion, installPendingUpdate, type UpdateInfo } from "@/lib/updater";
import { cn } from "@/lib/utils";

const SOURCE_LABEL: Record<string, string> = {
  file: "archivo",
  env: "entorno",
  default: "sin configurar",
};

type SectionId = "models" | "providers" | "local" | "mcp" | "agent" | "appearance" | "about";

const SECTIONS: { id: SectionId; label: string; icon: ComponentType<{ className?: string }> }[] = [
  { id: "models", label: "Modelos", icon: Cpu },
  { id: "providers", label: "Proveedores", icon: KeyRound },
  { id: "local", label: "Servidores locales", icon: Server },
  { id: "mcp", label: "MCP", icon: Plug },
  { id: "agent", label: "Agente y sesiones", icon: ShieldCheck },
  { id: "appearance", label: "Apariencia", icon: Palette },
  { id: "about", label: "Acerca de", icon: Info },
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
  const { theme, setTheme } = useTheme();
  const [section, setSection] = useState<SectionId>("models");
  const [config, setConfig] = useState<ConfigView | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [keyDrafts, setKeyDrafts] = useState<Record<string, string>>({});
  const [urlDrafts, setUrlDrafts] = useState<Record<string, string>>({});
  const [mcp, setMcp] = useState<McpState | null>(null);
  const [version, setVersion] = useState("0.0.0");
  const [checking, setChecking] = useState(false);
  const [update, setUpdate] = useState<UpdateInfo | null>(null);
  const [upToDate, setUpToDate] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    void currentVersion().then(setVersion);
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
      toast.error("No se pudo buscar actualizaciones", { description: String(e) });
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
      toast.error("La actualización falló", { description: String(e) });
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
      .catch((e) => toast.error("No se pudo cargar la configuración", { description: String(e) }))
      .finally(() => setLoading(false));
    phoson
      .mcpGet(sessionId)
      .then(setMcp)
      .catch(() => setMcp(null));
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
      toast.error("No se pudo guardar el servidor MCP", { description: String(e) });
    }
  };

  const removeServer = async (name: string) => {
    if (!sessionId) return;
    try {
      const res = await phoson.mcpRemove(sessionId, name);
      setMcp(res.mcp);
      toast.success(`Servidor ${name} eliminado`);
    } catch (e) {
      toast.error("No se pudo eliminar el servidor", { description: String(e) });
    }
  };

  const addServer = async () => {
    const name = form.name.trim();
    if (!name) {
      toast.error("Ponle un nombre al servidor");
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
    toast.success("Servidor MCP añadido", { description: name });
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
      toast.success("Configuración guardada", { description: res?.path ?? "~/.phoson/config.toml" });
      onOpenChange(false);
    } catch (e) {
      toast.error("No se pudo guardar", { description: String(e) });
    } finally {
      setSaving(false);
    }
  };

  const keyProviders = config?.providers.filter((p) => p.supportsKey !== false) ?? [];
  const localProviders = config?.providers.filter((p) => p.supportsBaseUrl) ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl gap-0 overflow-hidden p-0 sm:max-w-3xl">
        <DialogHeader className="px-5 py-4">
          <DialogTitle className="text-base">Configuración</DialogTitle>
          <DialogDescription className="text-xs">
            Ajustes del engine, compartidos con el{" "}
            <span className="text-violet-soft">phoson-cli</span>.
          </DialogDescription>
        </DialogHeader>
        <Separator />

        <div className="flex h-[min(68vh,540px)] min-h-0 min-w-0">
          {/* ── Navegación de secciones ─────────────────────────────── */}
          <nav className="w-52 shrink-0 space-y-0.5 border-r border-[var(--dashboard-border)] p-2">
            {SECTIONS.map(({ id, label, icon: Icon }) => {
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
                  <span className="truncate">{label}</span>
                </button>
              );
            })}
          </nav>

          {/* ── Contenido de la sección ─────────────────────────────── */}
          <div className="min-h-0 min-w-0 flex-1 overflow-y-auto">
            <div className="p-5">
              {loading || !config ? (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="size-3.5 animate-spin" /> Cargando…
                </div>
              ) : (
                <>
                  {/* Modelos */}
                  {section === "models" && (
                    <div className="space-y-5">
                      <SectionTitle
                        title="Modelos"
                        hint="El selector rápido está en el composer del chat."
                      />
                      <div className="space-y-1.5">
                        <Label className="text-xs">Proveedor activo</Label>
                        <Select
                          value={config.provider}
                          onValueChange={(v) => patch({ provider: v })}
                        >
                          <SelectTrigger className="h-9 w-full text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {config.providers.map((p) => (
                              <SelectItem key={p.id} value={p.id} className="text-xs">
                                <span className="flex items-center gap-2">
                                  <ProviderLogo id={p.id} size={14} />
                                  {providerLabel(p.id)}
                                </span>
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="space-y-1.5">
                        <Label className="text-xs">Modelo principal</Label>
                        <Input
                          className="h-9 font-mono text-xs"
                          value={config.model}
                          onChange={(e) => patch({ model: e.target.value })}
                        />
                      </div>

                      <div className="space-y-1.5">
                        <Label className="text-xs">Modelo de sub-agentes</Label>
                        <Input
                          className="h-9 font-mono text-xs"
                          value={config.subagentModel}
                          onChange={(e) => patch({ subagentModel: e.target.value })}
                        />
                        <p className="text-[0.68rem] text-muted-foreground">
                          Es el que ejecuta los tools en paralelo.
                        </p>
                      </div>

                      <div className="space-y-1.5">
                        <Label className="text-xs">Esfuerzo de razonamiento</Label>
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
                        title="Claves de API"
                        hint="Solo escritura: nunca se muestran las claves guardadas."
                      />
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
                                p.hasKey ? "text-emerald-500" : "text-muted-foreground",
                              )}
                            >
                              {p.hasKey ? <Check className="size-3" /> : <KeyRound className="size-3" />}
                              {SOURCE_LABEL[p.source] ?? p.source}
                            </span>
                            {PROVIDER_META[p.id]?.keysUrl && (
                              <a
                                href={PROVIDER_META[p.id].keysUrl}
                                target="_blank"
                                rel="noreferrer"
                                title="Obtener clave"
                                className="shrink-0 text-muted-foreground transition-colors hover:text-violet"
                              >
                                <ExternalLink className="size-3" />
                              </a>
                            )}
                            <Input
                              type="password"
                              className="h-7 font-mono text-xs"
                              placeholder={p.hasKey ? "•••••••• (definida)" : "nueva clave…"}
                              value={keyDrafts[p.id] ?? ""}
                              onChange={(e) => setKeyDrafts((d) => ({ ...d, [p.id]: e.target.value }))}
                            />
                          </div>
                        ))}
                      </div>
                      {PROVIDER_META.bedrock?.note && (
                        <p className="text-[0.68rem] text-muted-foreground">
                          <span className="text-foreground/70">AWS Bedrock:</span>{" "}
                          {PROVIDER_META.bedrock.note}.
                        </p>
                      )}
                    </div>
                  )}

                  {/* Servidores locales */}
                  {section === "local" && (
                    <div className="space-y-5">
                      <SectionTitle
                        title="Servidores locales"
                        hint="vLLM, Ollama, LM Studio y OmniRoute se direccionan por URL."
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
                              placeholder="http://localhost:…"
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
                          title="MCP — Model Context Protocol"
                          hint="Servidores de herramientas externas; el engine los recarga al guardar."
                        />
                        <Button
                          size="sm"
                          className="h-8 shrink-0 gap-1.5 bg-violet text-xs text-white hover:bg-violet/90"
                          onClick={() => setFormOpen((o) => !o)}
                        >
                          <Plus className="size-3.5" /> Añadir
                        </Button>
                      </div>

                      <Row
                        label="Habilitar MCP"
                        hint={mcp?.configPath ?? "~/.phoson/mcps.json"}
                      >
                        <Switch
                          checked={!!config.enableMcp}
                          onCheckedChange={(v) => patch({ enableMcp: v })}
                        />
                      </Row>

                      {mcp && !mcp.sdkAvailable && (
                        <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-[0.68rem] text-amber-600 dark:text-amber-400">
                          El paquete <span className="font-mono">mcp</span> no está instalado en el
                          entorno del engine. Instálalo con{" "}
                          <span className="font-mono">
                            pip install &quot;phoson-engine-minimal[mcp]&quot;
                          </span>
                          .
                        </p>
                      )}

                      <div className="space-y-2">
                        {(mcp?.servers ?? []).length === 0 && (
                          <p className="text-[0.7rem] text-muted-foreground">
                            Sin servidores configurados.
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
                              title="Eliminar"
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
                            <span className="text-xs font-medium">Nuevo servidor</span>
                            <button
                              onClick={() => setFormOpen(false)}
                              className="text-[0.7rem] text-muted-foreground transition-colors hover:text-foreground"
                            >
                              Cancelar
                            </button>
                          </div>

                          <div>
                            <Label className="text-[0.7rem] text-muted-foreground">
                              Empezar desde una plantilla
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

                          <Field label="Nombre" hint="Identificador único del servidor">
                            <Input
                              className="h-8 text-xs"
                              placeholder="p. ej. filesystem"
                              value={form.name}
                              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                            />
                          </Field>

                          <Field
                            label="Transporte"
                            hint="stdio para procesos locales; sse/http para servidores remotos"
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
                              label="Comando y argumentos"
                              hint="Se ejecutan tal cual, como en la terminal"
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
                            <Field label="URL" hint="Endpoint del servidor remoto">
                              <Input
                                className="h-8 font-mono text-xs"
                                placeholder="https://host/mcp"
                                value={form.url}
                                onChange={(e) => setForm((f) => ({ ...f, url: e.target.value }))}
                              />
                            </Field>
                          )}

                          <Field
                            label="Variables de entorno"
                            hint="Una por línea: CLAVE=valor. Se guardan en mcps.json y no se muestran de vuelta."
                          >
                            <textarea
                              className="h-16 w-full resize-none rounded-md border border-[var(--dashboard-border)] bg-transparent p-2 font-mono text-[0.7rem] outline-none focus:border-violet"
                              placeholder="GITHUB_PERSONAL_ACCESS_TOKEN=ghp_…"
                              value={form.env}
                              onChange={(e) => setForm((f) => ({ ...f, env: e.target.value }))}
                            />
                          </Field>

                          <div className="flex justify-end gap-2">
                            <Button variant="ghost" size="sm" onClick={() => setFormOpen(false)}>
                              Cancelar
                            </Button>
                            <Button
                              size="sm"
                              className="gap-1.5 bg-violet text-xs text-white hover:bg-violet/90"
                              onClick={() => void addServer()}
                            >
                              <Plus className="size-3.5" /> Añadir servidor
                            </Button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Agente y sesiones */}
                  {section === "agent" && (
                    <div className="space-y-5">
                      <SectionTitle title="Agente y sesiones" />
                      <Row
                        label="Modo seguro"
                        hint="Pide confirmación antes de ejecutar comandos (bash)."
                      >
                        <Switch
                          checked={config.safeMode}
                          onCheckedChange={(v) => patch({ safeMode: v })}
                        />
                      </Row>
                      <Row label="Notificar al terminar" hint="Aviso cuando un run acaba.">
                        <Select
                          value={config.notifyOnCompletion || "off"}
                          onValueChange={(v) => patch({ notifyOnCompletion: v })}
                        >
                          <SelectTrigger className="h-8 w-28 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {["off", "bell", "desktop"].map((n) => (
                              <SelectItem key={n} value={n} className="text-xs">
                                {n}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </Row>
                      <Separator />
                      <div className="space-y-1.5">
                        <Label className="text-xs">Carpeta de sesiones</Label>
                        <Input
                          className="h-8 font-mono text-xs opacity-70"
                          value={config.sessionsDir}
                          readOnly
                        />
                      </div>
                    </div>
                  )}

                  {/* Apariencia */}
                  {section === "appearance" && (
                    <div className="space-y-5">
                      <SectionTitle
                        title="Apariencia"
                        hint="Preferencia local de la app (no se guarda en config.toml)."
                      />
                      <div className="flex flex-wrap gap-6">
                        {(
                          [
                            { id: "light", label: "Claro", Icon: Sun },
                            { id: "dark", label: "Oscuro", Icon: Moon },
                            { id: "system", label: "Sistema", Icon: Monitor },
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

                      {onRestartOnboarding && (
                        <>
                          <Separator />
                          <Row
                            label="Asistente inicial"
                            hint="Vuelve a mostrar el onboarding de primera configuración."
                          >
                            <Button size="sm" variant="ghost" onClick={onRestartOnboarding}>
                              Ver de nuevo
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
                        title="Acerca de"
                        hint="Actualizaciones firmadas servidas desde el feed de releases."
                      />
                      <Row label="Versión instalada" hint="Phoson Desktop">
                        <span className="font-mono text-xs text-muted-foreground">v{version}</span>
                      </Row>

                      <Separator />

                      {update ? (
                        <div className="space-y-3">
                          <p className="text-sm text-foreground">
                            Nueva versión disponible:{" "}
                            <span className="font-medium text-violet">v{update.version}</span>
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
                            Descargar e instalar
                          </Button>
                        </div>
                      ) : (
                        <Row
                          label="Actualizaciones"
                          hint={
                            upToDate
                              ? "Tienes la última versión."
                              : "Busca una versión más reciente."
                          }
                        >
                          <Button size="sm" variant="ghost" disabled={checking} onClick={() => void runUpdateCheck()}>
                            {checking ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
                            Buscar
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
            Cancelar
          </Button>
          <Button
            size="sm"
            className="bg-violet text-white hover:bg-violet/90"
            disabled={saving || loading || !config}
            onClick={() => void save()}
          >
            {saving ? <Loader2 className="size-3.5 animate-spin" /> : null} Guardar
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
