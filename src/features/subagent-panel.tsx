import { AlertTriangle, Bot, Check, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";

import type { SubagentTask } from "@/bridge/protocol";

const fmt = (n?: number) =>
  n == null ? "—" : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);

/**
 * Progreso en vivo de los subagentes (`agent`/`agents` tools) que el engine
 * empuja por `on_subagent_progress`. El sidecar añade `null` al terminar, así
 * que la lista vacía oculta el panel.
 */
export function SubagentPanel({ tasks }: { tasks: SubagentTask[] }) {
  // El hook va antes del return temprano: los hooks no pueden quedar tras un `return`.
  const { t } = useTranslation("tools");
  if (tasks.length === 0) return null;
  // Ojo: el parámetro se llama `task` y no `t` para no tapar la función de traducción.
  const done = tasks.filter((task) => task.done || task.status === "done").length;

  return (
    <div className="dashboard-panel-strong mx-3 mb-2 rounded-xl border p-3 text-xs sm:mx-auto sm:w-full sm:max-w-3xl">
      <div className="mb-1.5 flex items-center gap-2 font-medium">
        <Bot className="size-3.5 text-violet" />
        {t("subagents.title")}
        <span className="text-muted-foreground">
          ({done}/{tasks.length})
        </span>
      </div>
      <div className="space-y-1">
        {tasks.map((task) => (
          <div key={task.index} className="flex items-center gap-2">
            {task.status === "error" ? (
              <AlertTriangle className="size-3 shrink-0 text-destructive" />
            ) : task.done || task.status === "done" ? (
              <Check className="size-3 shrink-0 text-success" />
            ) : (
              <Loader2 className="size-3 shrink-0 animate-spin text-violet" />
            )}
            <span className="min-w-0 flex-1 truncate text-muted-foreground" title={task.task}>
              {task.task}
            </span>
            <span className="shrink-0 tabular-nums text-[0.65rem] text-muted-foreground">
              {fmt(task.input_tokens)}/{fmt(task.output_tokens)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
