import { Check, ChevronDown, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";

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
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

interface ModelPickerProps {
  sessionId: string | null;
  current?: string;
  provider?: string;
  compact?: boolean;
}

const shortContext = (n?: number | null) =>
  n ? (n >= 1000 ? `${Math.round(n / 1000)}k` : String(n)) : null;

/** Selector de modelo: lista viva del proveedor activo (`models.list`). */
export function ModelPicker({ sessionId, current, provider, compact }: ModelPickerProps) {
  const [open, setOpen] = useState(false);
  const [models, setModels] = useState<ModelOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !sessionId || loading || models.length > 0) return;
    setLoading(true);
    setError(null);
    phoson
      .listModels(sessionId)
      .then((r) => {
        setModels(r.models ?? []);
        if (r.error) setError(r.error);
      })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, sessionId]);

  const label = current?.split("/").pop() ?? "modelo";

  const select = (m: ModelOption) => {
    setOpen(false);
    if (sessionId) void phoson.setModel(sessionId, m.id, m.provider);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          className="flex max-w-[16rem] items-center gap-1.5 rounded-md border border-transparent px-2 py-1 text-xs transition-colors hover:border-[var(--dashboard-border)]"
          title="Cambiar modelo"
        >
          <span className="size-1.5 shrink-0 rounded-full bg-violet" />
          <span className={cn("truncate text-foreground", compact && "max-w-[6rem]")}>
            {label}
          </span>
          <ChevronDown className="size-3 shrink-0 opacity-50" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <Command>
          <CommandInput placeholder="Buscar modelo…" />
          <CommandList>
            {loading ? (
              <div className="flex items-center gap-2 p-3 text-xs text-muted-foreground">
                <Loader2 className="size-3.5 animate-spin" /> Consultando al proveedor…
              </div>
            ) : error ? (
              <div className="p-3 text-xs text-muted-foreground">
                No se pudo listar modelos: {error}
              </div>
            ) : models.length === 0 ? (
              <CommandEmpty>Sin modelos disponibles.</CommandEmpty>
            ) : (
              <CommandGroup>
                {models.map((m) => {
                  const active = m.id === current && m.provider === provider;
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
  );
}
