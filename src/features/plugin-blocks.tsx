/**
 * Bloques de UI publicados por plugins (`UiBlock` del engine): avisos, tarjetas
 * clave-valor, listas de tareas y progreso. Llegan neutros por `plugin.block`
 * (ver `bridge/phoson_bridge/plugin_ui.py`) y se actualizan en sitio; este
 * componente los pinta como bloque nativo en el flujo de la conversación.
 */

import { AlertTriangle, CheckCircle2, Circle, Info, XCircle } from "lucide-react";

import type { PluginBlock } from "@/bridge/protocol";
import { cn } from "@/lib/utils";

function NoticeLine({ kind, message }: { kind: string; message: string }) {
  const Icon = kind === "warn" ? AlertTriangle : kind === "error" ? XCircle : Info;
  return (
    <div
      className={cn(
        "flex items-start gap-2 rounded-lg border px-3 py-2 text-[0.8125rem]",
        kind === "warn"
          ? "border-amber-500/30 text-amber-500"
          : kind === "error"
            ? "border-destructive/30 text-destructive"
            : "border-dashboard-border-soft text-muted-foreground",
      )}
    >
      <Icon className="mt-0.5 size-3.5 shrink-0" />
      <span className="min-w-0 flex-1 whitespace-pre-wrap">{message}</span>
    </div>
  );
}

function BlockCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-dashboard-border-soft p-3">
      <div className="mb-1.5 text-[0.7rem] font-medium text-muted-foreground">{title}</div>
      {children}
    </div>
  );
}

function PluginBlockCard({ block }: { block: PluginBlock }) {
  switch (block.type) {
    case "NoticeBlock":
      return <NoticeLine kind={block.kind} message={block.message} />;

    case "KeyValueBlock":
      return (
        <BlockCard title={block.title}>
          <dl className="space-y-1">
            {(block.items ?? []).map(([key, value], i) => (
              <div key={`${key}-${i}`} className="flex gap-2 text-[0.8125rem]">
                <dt className="w-40 shrink-0 truncate font-medium">{key}</dt>
                <dd className="min-w-0 flex-1 whitespace-pre-wrap text-muted-foreground">{value}</dd>
              </div>
            ))}
          </dl>
        </BlockCard>
      );

    case "TodoListBlock":
      return (
        <BlockCard title={block.title}>
          <ul className="space-y-1">
            {(block.items ?? []).map((item) => (
              <li key={item.id} className="flex items-start gap-2 text-[0.8125rem]">
                {item.completed ? (
                  <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-emerald-500" />
                ) : (
                  <Circle className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                )}
                <span className="min-w-0 flex-1">
                  <span className={cn(item.completed && "text-muted-foreground line-through")}>
                    {item.title}
                  </span>
                  {item.detail && (
                    <span className="text-muted-foreground"> · {item.detail}</span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </BlockCard>
      );

    case "ProgressBlock": {
      const { completed, total, detail } = block;
      const percent =
        typeof completed === "number" && typeof total === "number" && total > 0
          ? Math.max(0, Math.min(100, Math.round((completed / total) * 100)))
          : null;
      return (
        <BlockCard title={block.label}>
          {percent !== null && (
            <div className="mb-1.5 h-1 w-full overflow-hidden rounded-full bg-violet/15">
              <div className="h-full rounded-full bg-violet transition-[width]" style={{ width: `${percent}%` }} />
            </div>
          )}
          <div className="flex items-baseline gap-2 text-[0.8125rem]">
            {typeof completed === "number" && (
              <span className="tabular-nums text-muted-foreground">
                {completed}
                {typeof total === "number" ? `/${total}` : ""}
              </span>
            )}
            {detail && <span className="min-w-0 flex-1 truncate text-muted-foreground">{detail}</span>}
          </div>
        </BlockCard>
      );
    }

    default:
      return null;
  }
}

export function PluginBlocks({ blocks }: { blocks: PluginBlock[] }) {
  if (!blocks.length) return null;
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-2 px-3 py-2 sm:px-4">
      {blocks.map((block) => (
        <PluginBlockCard key={block.id} block={block} />
      ))}
    </div>
  );
}
