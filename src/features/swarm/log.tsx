/**
 * Panel «Mensajes entre agentes»: el registro del tráfico del swarm.
 *
 * No es un chat en vivo —el engine no permite a los miembros hablar entre ellos
 * directamente— así que aquí se muestra lo que de verdad ocurre: las llamadas
 * `swarm_*` del maestro, reconstruidas desde los `ToolCard` del stream de la
 * sesión activa. `swarm_message` se pinta como un mensaje `@emisor → @destino`,
 * y `swarm_assign` como una asignación de trabajo.
 */

import { ArrowRight, Bot, Crown, Inbox, Radio, Wrench } from "lucide-react";

import type { ToolCard } from "@/stores/session";
import { cn } from "@/lib/utils";
import { TITLES, asRecord, asText, useSwarmTraffic, type Entry } from "./live";

/** Resalta las menciones `@rol` dentro de un texto. */
function Mentions({ text }: { text: string }) {
  const parts = text.split(/(@[a-zA-Z0-9_-]+)/g);
  return (
    <>
      {parts.map((part, index) =>
        part.startsWith("@") && part.length > 1 ? (
          <span
            key={index}
            className="rounded bg-violet/15 px-1 font-medium text-violet-soft"
          >
            {part}
          </span>
        ) : (
          <span key={index}>{part}</span>
        ),
      )}
    </>
  );
}

function StatusDot({ card }: { card: ToolCard }) {
  const color =
    card.status === "running" ? "bg-amber-500" : card.status === "error" ? "bg-destructive" : "bg-emerald-500";
  return (
    <span
      className={cn("size-1.5 shrink-0 rounded-full", color, card.status === "running" && "animate-pulse")}
      title={card.status}
    />
  );
}

/** Un mensaje enrutado a la bandeja de otro agente. */
function MessageRow({ entry }: { entry: Extract<Entry, { role: "message" }> }) {
  const broadcast = entry.recipient === "*";
  return (
    <div className="rounded-lg border border-[var(--dashboard-border)] bg-[var(--phoson-surface-2)]/40 p-2">
      <div className="flex flex-wrap items-center gap-1 text-[0.68rem]">
        <StatusDot card={entry.card} />
        <span className="font-medium text-violet-soft">@{entry.sender}</span>
        <ArrowRight className="size-3 text-muted-foreground" />
        {broadcast ? (
          <span className="flex items-center gap-1 rounded bg-[var(--phoson-surface-2)] px-1 text-[0.66rem]">
            <Radio className="size-2.5" /> todos
          </span>
        ) : (
          <span className="rounded bg-[var(--phoson-surface-2)] px-1 font-medium text-emerald-400">
            @{entry.recipient}
          </span>
        )}
        {entry.topic && <span className="text-muted-foreground">· {entry.topic}</span>}
        {broadcast && <span className="text-muted-foreground">(bandeja compartida)</span>}
      </div>

      {entry.content && (
        <p className="mt-1.5 whitespace-pre-wrap break-words text-[0.72rem] leading-relaxed">
          <Mentions text={entry.content} />
        </p>
      )}

      {entry.card.status === "error" && entry.card.error && (
        <p className="mt-1 text-[0.68rem] text-destructive">{entry.card.error}</p>
      )}
      {entry.card.status === "done" && entry.card.result && (
        <p className="mt-1 text-[0.64rem] text-muted-foreground">
          <Inbox className="mr-1 inline size-2.5" />
          {entry.card.result.slice(0, 160)}
        </p>
      )}
    </div>
  );
}

/** Una llamada del ciclo de vida del swarm (crear, asignar, recoger…). */
function EventRow({ entry }: { entry: Extract<Entry, { role: "event" }> }) {
  const { card } = entry;
  const args = asRecord(card.args);
  const title = TITLES[card.name] ?? card.name;

  const details: string[] = [];
  if (card.name === "swarm_create") {
    const agents = Array.isArray(args.agents) ? args.agents : [];
    const topology = asText(args.topology) || "star";
    details.push(`${agents.length} ${agents.length === 1 ? "rol" : "roles"} · topología ${topology}`);
    for (const agent of agents) {
      const record = asRecord(agent);
      const name = asText(record.name);
      const tools = Array.isArray(record.tools_allowlist) ? record.tools_allowlist.length : 0;
      if (name) details.push(`@${name}${tools ? ` · ${tools} tools` : " · todas las tools"}`);
    }
  }
  if (card.name === "swarm_assign") {
    const target = asText(args.target);
    details.push(target ? `→ @${target}` : "→ todo el swarm");
    const task = asText(args.task);
    if (task) details.push(task);
  }
  if (card.name === "swarm_collect" || card.name === "swarm_dissolve" || card.name === "swarm_status") {
    if (card.result) details.push(card.result.slice(0, 220));
  }

  return (
    <div className="rounded-lg border border-dashed border-[var(--dashboard-border)] p-2">
      <div className="flex items-center gap-1.5 text-[0.68rem]">
        <StatusDot card={card} />
        <Crown className="size-3 text-violet" />
        <span className="font-medium">Maestro</span>
        <span className="text-muted-foreground">·</span>
        <span>{title}</span>
        {card.status === "error" && <span className="text-destructive">· error</span>}
      </div>
      {details.length > 0 && (
        <div className="mt-1 space-y-0.5">
          {details.map((line, index) => (
            <p
              key={index}
              className={cn(
                "break-words text-[0.68rem] leading-relaxed",
                index === 0 ? "text-muted-foreground" : "text-foreground/90",
              )}
            >
              <Mentions text={line} />
            </p>
          ))}
        </div>
      )}
      {card.status === "error" && card.error && (
        <p className="mt-1 text-[0.68rem] text-destructive">{card.error}</p>
      )}
    </div>
  );
}

export function AgentLog({ sessionKey }: { sessionKey: string | null }) {
  const { entries, messages, running } = useSwarmTraffic(sessionKey);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 px-3 pb-2">
        <Bot className="size-3.5 shrink-0 text-violet" />
        <span className="text-[0.7rem] font-medium">Tráfico de agentes</span>
        {running && <span className="text-[0.62rem] text-amber-500">en curso…</span>}
        <span className="ml-auto text-[0.62rem] text-muted-foreground">
          {entries.length} eventos · {messages} mensajes
        </span>
      </div>

      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 pb-3">
        {entries.length === 0 ? (
          <div className="rounded-lg border border-dashed border-[var(--dashboard-border)] p-3">
            <p className="text-[0.7rem] leading-relaxed text-muted-foreground">
              Aquí verás el swarm en marcha: la creación del equipo, el trabajo asignado y
              los mensajes que el maestro enruta entre agentes.
            </p>
            <p className="mt-1.5 text-[0.68rem] leading-relaxed text-muted-foreground">
              Lanza el swarm desde esta sección (con una sesión activa): verás el
              registro crecer en vivo mientras el maestro reparte el trabajo.
            </p>
          </div>
        ) : (
          entries.map((entry) =>
            entry.role === "message" ? (
              <MessageRow key={entry.id} entry={entry} />
            ) : (
              <EventRow key={entry.id} entry={entry} />
            ),
          )
        )}
      </div>

      <p className="border-t border-[var(--dashboard-border)] px-3 py-2 text-[0.62rem] leading-relaxed text-muted-foreground">
        <Wrench className="mr-1 inline size-2.5" />
        Los mensajes se entregan en la siguiente ejecución del destinatario: el registro
        muestra el enrutado, no una conversación en vivo.
      </p>
    </div>
  );
}
