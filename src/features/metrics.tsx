import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { RunMetrics } from "@/bridge/protocol";
import { cn } from "@/lib/utils";

const fmt = (n?: number) =>
  n === undefined ? "—" : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);

function Divider() {
  return <span className="h-3 w-px shrink-0 bg-[var(--dashboard-border)]" />;
}

interface CellProps {
  label: string;
  value: string;
  hint: string;
  accent?: boolean;
}

/** Celda de métrica: micro-label + valor en tabular-nums. Sin caja, sin icono. */
function Cell({ label, value, hint, accent }: CellProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="flex items-baseline gap-1.5">
          <span className="text-[0.62rem] uppercase tracking-[0.08em] text-muted-foreground/70">
            {label}
          </span>
          <span
            className={cn(
              "text-xs tabular-nums",
              accent ? "text-foreground" : "text-muted-foreground",
            )}
          >
            {value}
          </span>
        </span>
      </TooltipTrigger>
      <TooltipContent>{hint}</TooltipContent>
    </Tooltip>
  );
}

/** Línea de estado del HUD: limpia, sin cajas ni iconos, con separadores finos.
 *  El modelo vive en `ModelPicker` (control), no aquí. */
export function MetricsBar({ metrics }: { metrics?: RunMetrics }) {
  return (
    <div className="flex items-center gap-2.5">
      <Cell
        label="ctx"
        value={`${fmt(metrics?.contextTokens)} / ${fmt(metrics?.contextWindow)}`}
        hint="Contexto usado / ventana"
      />
      <Divider />
      <Cell label="tok" value={fmt(metrics?.tokens)} hint="Tokens totales" />
      <Divider />
      <Cell
        label="$"
        value={(metrics?.costUsd ?? 0).toFixed(4)}
        hint="Coste acumulado de la sesión"
      />
    </div>
  );
}
