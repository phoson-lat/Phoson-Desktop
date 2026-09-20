import { AlertTriangle, Bot, Check, Loader2 } from "lucide-react";

import type { SubagentTask } from "@/bridge/protocol";

const fmt = (n?: number) =>
  n == null ? "—" : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);

/**
 * Progreso en vivo de los subagentes (`agent`/`agents` tools) que el engine
 * empuja por `on_subagent_progress`. El sidecar añade `null` al terminar, así
 * que la lista vacía oculta el panel.
 */
export function SubagentPanel({ tasks }: { tasks: SubagentTask[] }) {
  if (tasks.length === 0) return null;
  const done = tasks.filter((t) => t.done || t.status === "done").length;

  return (
    <div className="dashboard-panel-strong mx-3 mb-2 rounded-xl border p-3 text-xs sm:mx-auto sm:w-full sm:max-w-3xl">
      <div className="mb-1.5 flex items-center gap-2 font-medium">
        <Bot className="size-3.5 text-violet" />
        Subagentes
        <span className="text-muted-foreground">
          ({done}/{tasks.length})
        </span>
      </div>
      <div className="space-y-1">
        {tasks.map((t) => (
          <div key={t.index} className="flex items-center gap-2">
            {t.status === "error" ? (
              <AlertTriangle className="size-3 shrink-0 text-destructive" />
            ) : t.done || t.status === "done" ? (
              <Check className="size-3 shrink-0 text-emerald-500" />
            ) : (
              <Loader2 className="size-3 shrink-0 animate-spin text-violet" />
            )}
            <span className="min-w-0 flex-1 truncate text-muted-foreground" title={t.task}>
              {t.task}
            </span>
            <span className="shrink-0 tabular-nums text-[0.65rem] text-muted-foreground">
              {fmt(t.input_tokens)}/{fmt(t.output_tokens)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
