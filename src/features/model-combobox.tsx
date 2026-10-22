import { Check, ChevronDown, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { phoson } from "@/bridge/client";
import type { ModelOption } from "@/bridge/protocol";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

interface ModelComboboxProps {
  sessionId: string | null;
  /** Proveedor del que se pide el catálogo (el del formulario, aunque no esté guardado). */
  provider?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}

const shortContext = (n?: number | null) =>
  n ? (n >= 1000 ? `${Math.round(n / 1000)}k` : String(n)) : null;

/**
 * Campo de modelo editable con desplegable del catálogo vivo.
 *
 * El id se puede escribir a mano (cualquier modelo, aunque el proveedor no lo
 * liste), pero la flecha abre la lista real del proveedor (`models.list`) para
 * no tener que memorizar ids. A diferencia del `ModelPicker` del composer, aquí
 * **no** se aplica nada: el valor va al borrador de Ajustes y se persiste con
 * «Guardar».
 */
export function ModelCombobox({
  sessionId,
  provider,
  value,
  onChange,
  placeholder,
}: ModelComboboxProps) {
  const { t } = useTranslation("settings");
  const [open, setOpen] = useState(false);
  const [models, setModels] = useState<ModelOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !sessionId) return;
    // Se consulta al abrir y al cambiar de proveedor: el catálogo depende de él
    // y el borrador puede tener uno distinto del guardado.
    let cancelled = false;
    setLoading(true);
    setError(null);
    phoson
      .listModels(sessionId, provider)
      .then((r) => {
        if (cancelled) return;
        setModels(r.models ?? []);
        if (r.error) setError(r.error);
      })
      .catch((e) => {
        if (!cancelled) setError(String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, sessionId, provider]);

  const select = (m: ModelOption) => {
    onChange(m.id);
    setOpen(false);
  };

  return (
    <div className="relative">
      <Input
        className="h-9 pr-9 font-mono text-xs"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        spellCheck={false}
        autoComplete="off"
      />
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            title={t("models.pickTitle")}
            aria-label={t("models.pickTitle")}
            className="absolute top-1/2 right-1 flex size-7 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition-colors hover:text-foreground"
          >
            {loading ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <ChevronDown className="size-4 opacity-70" />
            )}
          </button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-80 max-h-[min(22rem,60vh)] overflow-hidden p-0">
          <Command className="max-h-[min(22rem,60vh)]">
            <CommandInput placeholder={t("modelPicker.search")} />
            {/* La lista es el contenedor con scroll: `min-h-0` + `flex-1` para
                que se encoja dentro del popover y no crezca sin límite. */}
            <CommandList className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
              {loading ? (
                <div className="flex items-center gap-2 p-3 text-xs text-muted-foreground">
                  <Loader2 className="size-3.5 animate-spin" /> {t("modelPicker.loading")}
                </div>
              ) : error ? (
                <div className="p-3 text-xs text-muted-foreground">
                  {t("modelPicker.error", { error })}
                </div>
              ) : models.length === 0 ? (
                <CommandEmpty>{t("modelPicker.empty")}</CommandEmpty>
              ) : (
                <CommandGroup>
                  {models.map((m) => {
                    const active = m.id === value;
                    const meta = [shortContext(m.context_length), m.pricing]
                      .filter(Boolean)
                      .join(" · ");
                    return (
                      <CommandItem
                        key={`${m.provider}/${m.id}`}
                        value={`${m.id} ${m.label} ${m.provider}`}
                        onSelect={() => select(m)}
                        className="flex items-center gap-2"
                      >
                        <Check
                          className={cn(
                            "size-3.5 shrink-0",
                            active ? "text-violet opacity-100" : "opacity-0",
                          )}
                        />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-xs">{m.label || m.id}</div>
                          <div className="truncate text-[0.65rem] text-muted-foreground">
                            {m.id}
                            {meta ? ` · ${meta}` : ""}
                          </div>
                        </div>
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              )}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}
