import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import type { RunMetrics } from "@/bridge/protocol";
import { cn } from "@/lib/utils";

const fmt = (n?: number) =>
  n === undefined || n === null
    ? "—"
    : n >= 1_000_000
      ? `${(n / 1_000_000).toFixed(1)}M`
      : n >= 1000
        ? `${(n / 1000).toFixed(1)}k`
        : String(n);

/** Color del anillo según el consumo: violeta → ámbar → rojo. */
function usageColor(pct: number): string {
  if (pct >= 90) return "#ef4444";
  if (pct >= 70) return "#f59e0b";
  return "var(--violet)";
}

/** Anillo de progreso (estilo loader). Gira mientras el agente trabaja. */
function Ring({ pct, color, spinning }: { pct: number; color: string; spinning?: boolean }) {
  const r = 8;
  const circumference = 2 * Math.PI * r;
  const offset = circumference * (1 - Math.min(pct, 100) / 100);
  return (
    <svg
      width={20}
      height={20}
      viewBox="0 0 20 20"
      className={cn(spinning && "animate-spin")}
      aria-hidden
    >
      <circle cx="10" cy="10" r={r} fill="none" stroke="var(--dashboard-border)" strokeWidth="2.5" />
      <circle
        cx="10"
        cy="10"
        r={r}
        fill="none"
        stroke={color}
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        transform="rotate(-90 10 10)"
        className="transition-[stroke-dashoffset,stroke] duration-500 ease-out"
      />
    </svg>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <span className="text-muted-foreground">{label}</span>
      <span className="truncate font-mono tabular-nums text-foreground/85">{value}</span>
    </div>
  );
}

/**
 * Ventana de contexto como *loader*: anillo de progreso con el % usado, que
 * gira mientras el agente corre. Al pulsar (clic o teclado) se despliega el detalle
 * (contexto, tokens, coste, pasos, modelo).
 */
export function ContextMeter({ metrics }: { metrics?: RunMetrics }) {
  const used = metrics?.contextTokens ?? 0;
  const total = metrics?.contextWindow ?? 0;
  const pct = total > 0 ? Math.min(100, (used / total) * 100) : 0;
  const color = usageColor(pct);
  const free = Math.max(total - used, 0);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          className="flex items-center gap-2 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors dashboard-hover hover:text-foreground"
          title="Ventana de contexto"
          aria-label="Ventana de contexto y métricas"
        >
          <Ring pct={pct} color={color} spinning={metrics?.isRunning} />
          <span className="tabular-nums" style={{ color }}>
            {Math.round(pct)}%
          </span>
          <span className="tabular-nums opacity-70">
            {fmt(used)}/{fmt(total)}
          </span>
        </button>
      </PopoverTrigger>

      <PopoverContent align="end" className="w-72 p-3.5">
        <div className="space-y-2.5 text-xs">
          <div className="flex items-baseline justify-between gap-4">
            <span className="font-medium">Ventana de contexto</span>
            <span className="font-mono tabular-nums" style={{ color }}>
              {Math.round(pct)}%
            </span>
          </div>

          {/* Barra de consumo */}
          <div className="h-1.5 overflow-hidden rounded-full bg-[var(--dashboard-border)]">
            <div
              className="h-full rounded-full transition-[width] duration-500 ease-out"
              style={{ width: `${pct}%`, background: color }}
            />
          </div>

          <div className="space-y-1.5 pt-1">
            <DetailRow label="En uso" value={fmt(used)} />
            <DetailRow label="Disponible" value={fmt(free)} />
            <DetailRow label="Ventana" value={fmt(total)} />
          </div>

          <Separator />

          <div className="space-y-1.5">
            <DetailRow label="Tokens" value={`${fmt(metrics?.tokens)} (${fmt(metrics?.inputTokens)} in · ${fmt(metrics?.outputTokens)} out)`} />
            <DetailRow
              label="Coste"
              value={`$${(metrics?.costUsd ?? 0).toFixed(4)}${metrics?.credits ? ` · ${metrics.credits} cr` : ""}`}
            />
            <DetailRow label="Pasos" value={String(metrics?.steps ?? 0)} />
          </div>

          <Separator />

          <div className="space-y-1.5">
            <DetailRow label="Modelo" value={metrics?.model?.split("/").pop() ?? "—"} />
            <DetailRow label="Proveedor" value={metrics?.provider ?? "—"} />
            <DetailRow
              label="Estado"
              value={metrics?.isRunning ? "trabajando…" : "inactivo"}
            />
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
