import { Check, KeyRound, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { phoson } from "@/bridge/client";
import type { ConfigView } from "@/bridge/protocol";
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
import { cn } from "@/lib/utils";

const EFFORTS = ["off", "low", "medium", "high", "xhigh", "max"];

const SOURCE_LABEL: Record<string, string> = {
  file: "archivo",
  env: "entorno",
  default: "sin configurar",
};

interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sessionId: string | null;
}

export function SettingsDialog({ open, onOpenChange, sessionId }: SettingsDialogProps) {
  const [config, setConfig] = useState<ConfigView | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [keyDrafts, setKeyDrafts] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open || !sessionId) return;
    setLoading(true);
    setKeyDrafts({});
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
      await phoson.setConfig(
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
      );
      toast.success("Configuración guardada", { description: "~/.phoson/config.toml" });
      onOpenChange(false);
    } catch (e) {
      toast.error("No se pudo guardar", { description: String(e) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg gap-0 p-0">
        <DialogHeader className="px-5 py-4">
          <DialogTitle className="text-base">Configuración</DialogTitle>
          <DialogDescription className="text-xs">
            Ajustes del engine compartidos con el <span className="text-violet-soft">phoson-cli</span>.
          </DialogDescription>
        </DialogHeader>
        <Separator />

        <ScrollArea className="max-h-[62vh]">
          {loading || !config ? (
            <div className="flex items-center gap-2 p-6 text-xs text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" /> Cargando…
            </div>
          ) : (
            <div className="space-y-5 p-5">
              {/* Proveedor y modelos */}
              <section className="space-y-3">
                <h3 className="text-[0.7rem] font-medium uppercase tracking-[0.08em] text-muted-foreground">
                  Proveedor y modelos
                </h3>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Proveedor</Label>
                    <Input
                      className="h-8 text-xs"
                      value={config.provider}
                      onChange={(e) => patch({ provider: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Esfuerzo de razonamiento</Label>
                    <Select
                      value={config.reasoningEffort ?? "off"}
                      onValueChange={(v) => patch({ reasoningEffort: v })}
                    >
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {EFFORTS.map((e) => (
                          <SelectItem key={e} value={e} className="text-xs">
                            {e}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Modelo</Label>
                  <Input
                    className="h-8 font-mono text-xs"
                    value={config.model}
                    onChange={(e) => patch({ model: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Modelo de sub-agentes</Label>
                  <Input
                    className="h-8 font-mono text-xs"
                    value={config.subagentModel}
                    onChange={(e) => patch({ subagentModel: e.target.value })}
                  />
                </div>
              </section>

              <Separator />

              {/* Seguridad */}
              <section className="space-y-3">
                <h3 className="text-[0.7rem] font-medium uppercase tracking-[0.08em] text-muted-foreground">
                  Seguridad
                </h3>
                <ToggleRow
                  label="Modo seguro"
                  hint="Pide confirmación antes de ejecutar comandos"
                  checked={config.safeMode}
                  onChange={(v) => patch({ safeMode: v })}
                />
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-xs">Notificar al terminar</div>
                    <div className="text-[0.65rem] text-muted-foreground">
                      Aviso cuando un run acaba
                    </div>
                  </div>
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
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Carpeta de sesiones</Label>
                  <Input className="h-8 font-mono text-xs opacity-70" value={config.sessionsDir} readOnly />
                </div>
              </section>

              <Separator />

              {/* Claves de API */}
              <section className="space-y-3">
                <h3 className="text-[0.7rem] font-medium uppercase tracking-[0.08em] text-muted-foreground">
                  Claves de API
                </h3>
                <p className="text-[0.68rem] text-muted-foreground">
                  Solo escritura: nunca se muestran las claves guardadas.
                </p>
                <div className="space-y-2">
                  {config.providers.map((p) => (
                    <div key={p.id} className="flex items-center gap-2">
                      <span className="w-24 shrink-0 truncate text-xs">{p.id}</span>
                      <span
                        className={cn(
                          "flex w-24 shrink-0 items-center gap-1 text-[0.65rem]",
                          p.hasKey ? "text-emerald-500" : "text-muted-foreground",
                        )}
                      >
                        {p.hasKey ? <Check className="size-3" /> : <KeyRound className="size-3" />}
                        {SOURCE_LABEL[p.source] ?? p.source}
                      </span>
                      <Input
                        type="password"
                        className="h-7 font-mono text-xs"
                        placeholder={p.hasKey ? "•••••••• (definida)" : "nueva clave…"}
                        value={keyDrafts[p.id] ?? ""}
                        onChange={(e) =>
                          setKeyDrafts((d) => ({ ...d, [p.id]: e.target.value }))
                        }
                      />
                    </div>
                  ))}
                </div>
              </section>
            </div>
          )}
        </ScrollArea>

        <Separator />
        <div className="flex justify-end gap-2 px-5 py-3">
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

function ToggleRow({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0">
        <div className="text-xs">{label}</div>
        <div className="text-[0.65rem] text-muted-foreground">{hint}</div>
      </div>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}
