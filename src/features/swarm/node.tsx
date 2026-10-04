/**
 * Tarjeta de un nodo del árbol de agentes: el **maestro** (raíz, el agente de la
 * sesión) o un **rol** del swarm.
 *
 * El árbol es de profundidad 2 a propósito: el engine retira a los miembros las
 * herramientas de delegación, así que un miembro no puede tener sub-agentes. Lo
 * que sí cambia con la topología es la forma: en `pipeline` los roles se pintan
 * como una cadena vertical (el orden real de ejecución) y en `star`/`mesh` como
 * un abanico bajo el maestro.
 */

import { Crown, UserRound, Wrench } from "lucide-react";
import { createContext, useContext, type CSSProperties } from "react";
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";

import { cn } from "@/lib/utils";
import { agentKey, type AgentStatus } from "./live";

export type SwarmNodeData = {
  role: "master" | "agent";
  name: string;
  purpose: string;
  model: string;
  tools: string[];
  maxTokens: number | null;
  /** Posición en el swarm (1-based), para pintar el orden de la cadena. */
  order: number;
};

export type SwarmNode = Node<SwarmNodeData, "swarm">;

/**
 * Estado en vivo del swarm, inyectado por la sección. Va por contexto (y no en
 * `node.data`) para que los cambios de estado **no** marquen el borrador como
 * sucio ni obliguen a reescribir los nodos.
 */
export const SwarmLiveContext = createContext<{ agents: Record<string, AgentStatus>; master: AgentStatus }>({
  agents: {},
  master: "idle",
});

const STATUS_META: Record<AgentStatus, { label: string; dot: string; text: string } | null> = {
  idle: null,
  assigned: { label: "asignado", dot: "bg-sky-500", text: "text-sky-500" },
  messaged: { label: "mensaje", dot: "bg-violet", text: "text-violet-soft" },
  running: { label: "en curso", dot: "bg-amber-500 animate-pulse", text: "text-amber-500" },
  error: { label: "error", dot: "bg-destructive", text: "text-destructive" },
};

const MASTER_ACCENT = "#5b2eff";
const AGENT_ACCENT = "#14b8a6";

/** Lados por los que se puede tirar una conexión (estilo pizarra: los 4). */
const SIDES = [
  { id: "top", position: Position.Top },
  { id: "right", position: Position.Right },
  { id: "bottom", position: Position.Bottom },
  { id: "left", position: Position.Left },
] as const;

function Anchor({ id, position, accent }: { id: string; position: Position; accent: string }) {
  return (
    <Handle
      id={id}
      type="source"
      position={position}
      style={{ "--node-accent": accent } as CSSProperties}
      className="size-2.5! border-2! border-[var(--phoson-surface)]! bg-[var(--node-accent)]! opacity-0 transition-opacity group-hover/node:opacity-100"
    />
  );
}

export function SwarmNodeCard({ data, selected }: NodeProps<SwarmNode>) {
  const isMaster = data.role === "master";
  const accent = isMaster ? MASTER_ACCENT : AGENT_ACCENT;
  const Icon = isMaster ? Crown : UserRound;

  const live = useContext(SwarmLiveContext);
  const status: AgentStatus = isMaster ? live.master : (live.agents[agentKey(data.name)] ?? "idle");
  const statusMeta = STATUS_META[status];

  const chips = [
    data.model.trim(),
    data.tools.length ? `${data.tools.length} tools` : "todas las tools",
    data.maxTokens ? `${data.maxTokens} tk` : "",
  ].filter(Boolean);

  return (
    <div
      style={{ "--node-accent": accent } as CSSProperties}
      className={cn(
        "group/node w-[220px] rounded-xl border bg-[var(--phoson-surface)] text-left shadow-sm transition-shadow",
        isMaster ? "border-violet/60" : "border-[var(--dashboard-border)]",
        status === "running" && "border-amber-500/60",
        status === "error" && "border-destructive/70",
        selected ? "shadow-md ring-2 ring-[var(--node-accent)]/60" : "hover:shadow-md",
      )}
    >
      {/* Un punto por lado (oculto hasta el hover). Con `ConnectionMode.Loose`
          cualquier lado sirve para empezar y para soltar. */}
      {SIDES.map((side) => (
        <Anchor key={side.id} id={side.id} position={side.position} accent={accent} />
      ))}

      <div className="flex items-start gap-2 p-2.5">
        <span
          className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-md"
          style={{ backgroundColor: `${accent}22`, color: accent }}
        >
          <Icon className="size-3.5" />
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            {!isMaster && (
              <span className="shrink-0 rounded bg-[var(--phoson-surface-2)] px-1 text-[0.6rem] tabular-nums text-muted-foreground">
                {data.order}
              </span>
            )}
            <span className="truncate text-[0.78rem] font-medium">
              {isMaster ? "Maestro" : data.name.trim() || "Sin nombre"}
            </span>
            {statusMeta && (
              <span
                title={`Estado: ${statusMeta.label}`}
                className={cn(
                  "ml-auto flex shrink-0 items-center gap-1 text-[0.6rem] font-medium",
                  statusMeta.text,
                )}
              >
                <span className={cn("size-1.5 rounded-full", statusMeta.dot)} />
                {statusMeta.label}
              </span>
            )}
          </div>

          {isMaster ? (
            <p className="mt-1 text-[0.68rem] leading-snug text-muted-foreground">
              Es el agente de la sesión: recibe tu petición y reparte el trabajo.
            </p>
          ) : (
            <>
              <p className="mt-1 line-clamp-3 text-[0.7rem] leading-snug text-muted-foreground">
                {data.purpose.trim() || <span className="italic opacity-70">Sin propósito</span>}
              </p>
              <div className="mt-1.5 flex flex-wrap items-center gap-1">
                {chips.map((chip) => (
                  <span
                    key={chip}
                    className="flex items-center gap-0.5 rounded bg-[var(--phoson-surface-2)] px-1 py-0.5 text-[0.6rem] text-muted-foreground"
                  >
                    {chip.includes("tools") && <Wrench className="size-2.5" />}
                    {chip}
                  </span>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

    </div>
  );
}
