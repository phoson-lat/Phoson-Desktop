/**
 * Panel «Ejecuciones»: el historial de lanzamientos de swarms. Cada fila enlaza
 * con la conversación donde el maestro trabajó ese swarm.
 *
 * El estado se deriva en vivo de la sesión (ver `runStatus`), no se guarda.
 */

import { CheckCircle2, CircleDashed, History, MessageSquare, Trash2, XCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useSession } from "@/stores/session";
import { useSwarmRuns, type SwarmRun } from "@/stores/swarm-runs";

type RunStatus = "running" | "done" | "error" | "cancelled" | "sent";

const RUN_STATUS: Record<RunStatus, { label: string; dot: string; text: string; Icon: typeof CheckCircle2 }> = {
  running: { label: "en curso", dot: "bg-amber-500 animate-pulse", text: "text-amber-500", Icon: CircleDashed },
  done: { label: "completado", dot: "bg-emerald-500", text: "text-emerald-500", Icon: CheckCircle2 },
  error: { label: "error", dot: "bg-destructive", text: "text-destructive", Icon: XCircle },
  cancelled: { label: "cancelado", dot: "bg-muted-foreground", text: "text-muted-foreground", Icon: XCircle },
  sent: { label: "enviado", dot: "bg-sky-500", text: "text-sky-500", Icon: CircleDashed },
};

/** Estado de una ejecución, derivado de la sesión vinculada. */
function useRunStatus(run: SwarmRun): RunStatus {
  const sending = useSession((s) => Boolean(run.sessionKey && s.sessions[run.sessionKey]?.sending));
  const last = useSession((s) => {
    const messages = run.sessionKey ? s.sessions[run.sessionKey]?.messages : undefined;
    if (!messages) return undefined;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "assistant") return messages[i].status;
    }
    return undefined;
  });

  if (sending) return "running";
  if (last === "done") return "done";
  if (last === "error") return "error";
  if (last === "cancelled") return "cancelled";
  return "sent";
}

function timeAgo(ts: number): string {
  const seconds = Math.round((Date.now() - ts) / 1000);
  if (seconds < 60) return "ahora mismo";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `hace ${hours} h`;
  return `hace ${Math.round(hours / 24)} d`;
}

function RunRow({ run, onOpen }: { run: SwarmRun; onOpen: (sessionKey: string) => void }) {
  const status = useRunStatus(run);
  const meta = RUN_STATUS[status];
  const remove = useSwarmRuns((s) => s.remove);
  const canOpen = Boolean(run.sessionKey);

  return (
    <div className="rounded-lg border border-[var(--dashboard-border)] bg-[var(--phoson-surface-2)]/40 p-2">
      <div className="flex items-center gap-1.5 text-[0.68rem]">
        <span className={cn("flex items-center gap-1 font-medium", meta.text)}>
          <span className={cn("size-1.5 rounded-full", meta.dot)} />
          {meta.label}
        </span>
        <span className="ml-auto text-muted-foreground">{timeAgo(run.startedAt)}</span>
      </div>

      <p className="mt-1 truncate text-[0.75rem] font-medium" title={run.name}>
        {run.name}
      </p>
      {run.mission && (
        <p className="mt-0.5 line-clamp-2 text-[0.68rem] leading-relaxed text-muted-foreground">
          {run.mission}
        </p>
      )}
      <p className="mt-1 text-[0.62rem] text-muted-foreground">
        {run.agentCount} {run.agentCount === 1 ? "rol" : "roles"} · topología {run.topology}
      </p>

      <div className="mt-1.5 flex items-center gap-1">
        <Button
          size="sm"
          variant="ghost"
          className="h-7 px-2 text-[0.66rem]"
          disabled={!canOpen}
          onClick={() => run.sessionKey && onOpen(run.sessionKey)}
          title={canOpen ? "Abrir la conversación de esta ejecución" : "La sesión ya no está disponible"}
        >
          <MessageSquare className="size-3" /> Abrir chat
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="ml-auto h-7 px-2 text-[0.66rem] text-muted-foreground hover:text-destructive"
          onClick={() => remove(run.id)}
          aria-label="Eliminar ejecución"
        >
          <Trash2 className="size-3" />
        </Button>
      </div>
    </div>
  );
}

export function SwarmRuns({ onOpen }: { onOpen: (sessionKey: string) => void }) {
  const runs = useSwarmRuns((s) => s.runs);
  const clear = useSwarmRuns((s) => s.clear);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 px-3 pb-2">
        <History className="size-3.5 shrink-0 text-violet" />
        <span className="text-[0.7rem] font-medium">Ejecuciones</span>
        <span className="ml-auto text-[0.62rem] text-muted-foreground">{runs.length}</span>
        {runs.length > 0 && (
          <Button
            size="sm"
            variant="ghost"
            className="h-6 px-1.5 text-[0.62rem]"
            onClick={() => clear()}
            title="Vaciar el historial"
          >
            Limpiar
          </Button>
        )}
      </div>

      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 pb-3">
        {runs.length === 0 ? (
          <div className="rounded-lg border border-dashed border-[var(--dashboard-border)] p-3">
            <p className="text-[0.7rem] leading-relaxed text-muted-foreground">
              Aquí quedará el registro de cada lanzamiento: con qué misión, cuándo y en qué
              conversación trabajó el maestro. Pulsa «Lanzar» para crear la primera.
            </p>
          </div>
        ) : (
          runs.map((run) => <RunRow key={run.id} run={run} onOpen={onOpen} />)
        )}
      </div>
    </div>
  );
}
