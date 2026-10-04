/**
 * Estado **en vivo** del swarm derivado del stream de tool calls de la sesión.
 *
 * El engine no expone un estado por agente, así que reconstruimos una señal
 * honesta a partir de lo que sí vemos: las llamadas `swarm_*` del maestro.
 * - `running` — una tool del ciclo está en curso ahora mismo.
 * - `error`   — la última llamada relevante falló.
 * - `assigned`— se le asignó trabajo (`swarm_assign` con `target`).
 * - `messaged`— recibió un mensaje (`swarm_message` con `recipient`).
 * - `idle`    — nada de lo anterior.
 *
 * Ojo con la semántica: `assigned`/`messaged` significan «enrutado hacia él»,
 * no «ejecutándose»: el engine entrega la bandeja en la siguiente ejecución.
 */

import { useEffect, useState } from "react";

import { useSession, type ToolCard } from "@/stores/session";

/** Tools que forman parte del ciclo de vida del swarm. */
export const SWARM_TOOLS = new Set([
  "swarm_create",
  "swarm_assign",
  "swarm_message",
  "swarm_collect",
  "swarm_status",
  "swarm_dissolve",
]);

/** Cómo se titula cada llamada dentro del registro. */
export const TITLES: Record<string, string> = {
  swarm_create: "Crea el swarm",
  swarm_assign: "Asigna trabajo",
  swarm_message: "Envía un mensaje",
  swarm_collect: "Recoge los informes",
  swarm_status: "Consulta el estado",
  swarm_dissolve: "Disuelve el swarm",
};

export type AgentStatus = "idle" | "assigned" | "messaged" | "running" | "error";

export type Entry =
  | { role: "event"; id: string; card: ToolCard }
  | {
      role: "message";
      id: string;
      card: ToolCard;
      sender: string;
      recipient: string;
      content: string;
      topic: string;
    };

export interface SwarmTraffic {
  entries: Entry[];
  /** Estado por nombre de rol (clave normalizada con `agentKey`). */
  agents: Record<string, AgentStatus>;
  /** Estado del maestro (los roles no enrutan, así que es el único global). */
  master: AgentStatus;
  messages: number;
  running: boolean;
}

export const EMPTY_TRAFFIC: SwarmTraffic = {
  entries: [],
  agents: {},
  master: "idle",
  messages: 0,
  running: false,
};

export const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" ? (value as Record<string, unknown>) : {};

export const asText = (value: unknown): string => (typeof value === "string" ? value : "");

/** Clave canónica de un rol: sin arroba, sin espacios sobrantes, en minúsculas. */
export function agentKey(name: string): string {
  return name.trim().replace(/^@/, "").toLowerCase();
}

/** Extrae las tool calls `swarm_*` de los mensajes de una sesión, en orden. */
export function swarmToolCalls(messages: { parts?: { kind: string; tool?: ToolCard }[] }[]): ToolCard[] {
  const calls: ToolCard[] = [];
  for (const message of messages) {
    for (const part of message.parts ?? []) {
      if (part.kind === "tool" && part.tool && SWARM_TOOLS.has(part.tool.name)) {
        calls.push(part.tool);
      }
    }
  }
  return calls;
}

// Relevancia de cada estado: un estado «más fuerte» pisa a uno más débil, pero
// nunca al revés (que un mensaje antiguo no borre un «error» reciente).
const RANK: Record<AgentStatus, number> = {
  idle: 0,
  messaged: 1,
  assigned: 2,
  running: 3,
  error: 4,
};

function bump(map: Record<string, AgentStatus>, name: string, status: AgentStatus) {
  const key = agentKey(name);
  if (!key) return;
  const previous = map[key] ?? "idle";
  if (RANK[status] >= RANK[previous]) map[key] = status;
}

export function collectSwarmTraffic(toolCalls: ToolCard[]): SwarmTraffic {
  const entries: Entry[] = [];
  const agents: Record<string, AgentStatus> = {};
  let anyRunning = false;
  let lastFailed = false;
  let broadcast = false;

  for (const card of toolCalls) {
    const args = asRecord(card.args);
    const failed = card.status === "error";
    const running = card.status === "running";
    if (running) anyRunning = true;
    lastFailed = failed;

    if (card.name === "swarm_message") {
      const recipient = asText(args.recipient).trim() || "*";
      entries.push({
        role: "message",
        id: card.id,
        card,
        sender: asText(args.sender).trim() || "maestro",
        recipient,
        content: asText(args.content),
        topic: asText(args.topic),
      });
      if (recipient === "*") broadcast = true;
      else bump(agents, recipient, failed ? "error" : running ? "running" : "messaged");
      continue;
    }

    entries.push({ role: "event", id: card.id, card });

    if (card.name === "swarm_assign") {
      const target = asText(args.target).trim();
      if (target) bump(agents, target, failed ? "error" : running ? "running" : "assigned");
    }
  }

  // Un mensaje difundido a `*` va a la bandeja compartida: lo marcamos en todos
  // los roles conocidos, sin pisar estados más fuertes.
  if (broadcast) for (const name of Object.keys(agents)) bump(agents, name, "messaged");

  const master: AgentStatus = anyRunning ? "running" : lastFailed ? "error" : "idle";

  return {
    entries,
    agents,
    master,
    messages: entries.filter((entry) => entry.role === "message").length,
    running: anyRunning,
  };
}

/**
 * Suscribe el estado del swarm a la sesión, **coalescido por rAF** y publicado
 * solo cuando cambia de verdad. Así el lienzo no se re-renderiza en cada token
 * del streaming: solo cuando aparece/termina una llamada `swarm_*`.
 */
export function useSwarmTraffic(sessionKey: string | null): SwarmTraffic {
  const [traffic, setTraffic] = useState<SwarmTraffic>(EMPTY_TRAFFIC);

  useEffect(() => {
    if (!sessionKey) {
      setTraffic(EMPTY_TRAFFIC);
      return;
    }

    const read = (): SwarmTraffic => {
      const session = useSession.getState().sessions[sessionKey];
      return collectSwarmTraffic(swarmToolCalls(session?.messages ?? []));
    };

    setTraffic(read());

    let frame = 0;
    let signature = "";
    const unsubscribe = useSession.subscribe(() => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const next = read();
        // Firma ligera: solo estado, no contenido, para no setState por texto.
        const nextSignature = `${next.master}|${Object.entries(next.agents)
          .map(([k, v]) => `${k}:${v}`)
          .join(",")}|${next.entries.length}`;
        if (nextSignature === signature) return;
        signature = nextSignature;
        setTraffic(next);
      });
    });

    return () => {
      unsubscribe();
      if (frame) cancelAnimationFrame(frame);
    };
  }, [sessionKey]);

  return traffic;
}
