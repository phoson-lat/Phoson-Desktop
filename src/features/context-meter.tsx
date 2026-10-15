import { useTranslation } from "react-i18next";

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
  // `common` entra en el array para poder reutilizar sus claves (`common:…`).
  const { t } = useTranslation(["tools", "common"]);
  const used = metrics?.contextTokens ?? 0;
  const total = metrics?.contextWindow ?? 0;
  const pct = total > 0 ? Math.min(100, (used / total) * 100) : 0;
  // Sin ventana conocida (arranque, modelo sin datos) el medidor NO miente con un
  // 0%: muestra «—» y el anillo queda en gris.
  const known = total > 0;
  const color = known ? usageColor(pct) : "var(--dashboard-border)";
  const free = Math.max(total - used, 0);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          className="flex items-center gap-2 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors dashboard-hover hover:text-foreground"
          title={known ? t("context.title") : t("context.titleNoData")}
          aria-label={t("context.ariaLabel")}
        >
          <Ring pct={pct} color={color} spinning={metrics?.isRunning} />
          <span className="tabular-nums" style={known ? { color } : undefined}>
            {known ? `${Math.round(pct)}%` : "—"}
          </span>
          <span className="tabular-nums opacity-70">
            {known ? `${fmt(used)}/${fmt(total)}` : t("context.noData")}
          </span>
        </button>
      </PopoverTrigger>

      <PopoverContent align="end" className="w-72 p-3.5">
        <div className="space-y-2.5 text-xs">
          <div className="flex items-baseline justify-between gap-4">
            <span className="font-medium">{t("context.title")}</span>
            <span
              className="font-mono tabular-nums"
              style={known ? { color } : undefined}
            >
              {known ? `${Math.round(pct)}%` : "—"}
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
            <DetailRow label={t("context.inUse")} value={known ? fmt(used) : "—"} />
            <DetailRow label={t("context.available")} value={known ? fmt(free) : "—"} />
            <DetailRow label={t("context.window")} value={known ? fmt(total) : "—"} />
          </div>

          {!known && (
            <p className="text-muted-foreground">
              {t("context.notReported")}
            </p>
          )}

          <Separator />

          <div className="space-y-1.5">
            <DetailRow
              label={t("context.tokens")}
              value={t("context.tokenCount", {
                total: fmt(metrics?.tokens),
                input: fmt(metrics?.inputTokens),
                output: fmt(metrics?.outputTokens),
              })}
            />
            <DetailRow
              label={t("context.cost")}
              value={`$${(metrics?.costUsd ?? 0).toFixed(4)}${metrics?.credits ? ` · ${metrics.credits} cr` : ""}`}
            />
            <DetailRow label={t("context.steps")} value={String(metrics?.steps ?? 0)} />
          </div>

          <Separator />

          <div className="space-y-1.5">
            <DetailRow label={t("common:words.model")} value={metrics?.model?.split("/").pop() ?? "—"} />
            <DetailRow label={t("context.provider")} value={metrics?.provider ?? "—"} />
            <DetailRow
              label={t("context.status")}
              value={metrics?.isRunning ? t("context.working") : t("context.idle")}
            />
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
