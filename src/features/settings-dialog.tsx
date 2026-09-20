import {
  Check,
  Cpu,
  ExternalLink,
  KeyRound,
  Loader2,
  Monitor,
  Moon,
  Palette,
  Server,
  ShieldCheck,
  Sun,
} from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useState, type ComponentType } from "react";
import { toast } from "sonner";

import { phoson } from "@/bridge/client";
import type { ConfigView } from "@/bridge/protocol";
import { ProviderLogo } from "@/components/provider-logo";
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
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { REASONING_EFFORTS, effortLabel } from "@/lib/reasoning";
import { PROVIDER_META, providerLabel } from "@/lib/providers";
import { cn } from "@/lib/utils";

const SOURCE_LABEL: Record<string, string> = {
  file: "archivo",
  env: "entorno",
  default: "sin configurar",
};

type SectionId = "models" | "providers" | "local" | "agent" | "appearance";

const SECTIONS: { id: SectionId; label: string; icon: ComponentType<{ className?: string }> }[] = [
  { id: "models", label: "Modelos", icon: Cpu },
  { id: "providers", label: "Proveedores", icon: KeyRound },
  { id: "local", label: "Servidores locales", icon: Server },
  { id: "agent", label: "Agente y sesiones", icon: ShieldCheck },
  { id: "appearance", label: "Apariencia", icon: Palette },
];

interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sessionId: string | null;
}

export function SettingsDialog({ open, onOpenChange, sessionId }: SettingsDialogProps) {
  const { theme, setTheme } = useTheme();
  const [section, setSection] = useState<SectionId>("models");
  const [config, setConfig] = useState<ConfigView | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [keyDrafts, setKeyDrafts] = useState<Record<string, string>>({});
  const [urlDrafts, setUrlDrafts] = useState<Record<string, string>>({});

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
  }, [open, sessionId]);

  const patch = (p: Partial<ConfigView>) => setConfig((c) => (c ? { ...c, ...p } : c));

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

        <div className="flex h-[min(68vh,540px)] min-h-0">
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
          <ScrollArea className="min-h-0 flex-1">
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
                    </div>
                  )}
                </>
              )}
            </div>
          </ScrollArea>
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

function SectionTitle({ title, hint }: { title: string; hint?: string }) {
  return (
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
