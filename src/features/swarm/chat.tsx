/**
 * Composer del swarm, embebido en el panel «Mensajes».
 *
 * Aquí hablas con el **equipo**: escribes un mensaje y decides su destinatario
 * con `@rol`.
 * - Sin mención → va al **maestro/orquestador** como un turno normal.
 * - Con una o varias menciones → se le pide al maestro que **detenga a esos
 *   roles, les entregue el mensaje** (`swarm_message`) y vuelva a ponerlos a
 *   trabajar (`swarm_assign`) para que lean su bandeja y respondan.
 *
 * No hay canal directo persona→miembro: el engine retira las tools `swarm_*` a
 * los roles, así que el maestro sigue siendo el único enrutador. La mención es
 * una instrucción fuerte para él, no un contrato forzado.
 */

import { Bot } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { Composer } from "@/features/composer";
import type { SwarmAgent } from "@/lib/swarm";
import { cn } from "@/lib/utils";
import { useSession } from "@/stores/session";

/** Menciones `@rol` del texto que corresponden a roles reales del swarm. */
function matchMentions(text: string, agents: SwarmAgent[]): SwarmAgent[] {
  const found = new Map<string, SwarmAgent>();
  // El `@` debe ir al inicio o tras algo que no sea palabra (así `a@b` no cuenta).
  const re = /(?:^|[^\w@])@([a-zA-Z0-9_-]+)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    const name = match[1].toLowerCase();
    const agent = agents.find((a) => a.name.trim().toLowerCase() === name);
    if (agent) found.set(agent.id, agent);
  }
  return [...found.values()];
}

/** El turno que se manda al maestro para que enrute el mensaje a los roles. */
function toAgentInstruction(targets: SwarmAgent[], text: string): string {
  const at = targets.map((a) => `@${a.name.trim()}`).join(", ");
  const plain = targets.map((a) => `"${a.name.trim()}"`).join(", ");
  return [
    `Necesito hablar con ${at}. Antes de nada, **detén a ${at} si está(n) trabajando** para que pueda(n) leer mi mensaje.`,
    `Entrégale(s) el mensaje de abajo con \`swarm_message\` (recipient = el nombre sin arroba: ${plain}) y luego vuelve a`,
    `ponerle(s) a trabajar con \`swarm_assign\` para que procese(n) su bandeja y me devuelvas su respuesta.`,
    "",
    `Mensaje: ${text}`,
  ].join("\n");
}

export function SwarmChatComposer({ agents, active }: { agents: SwarmAgent[]; active: boolean }) {
  const activeKey = useSession((s) => s.activeKey);
  const view = useSession((s) => (activeKey ? s.sessions[activeKey] : undefined));
  const ready = useSession((s) => s.ready);
  const send = useSession((s) => s.send);
  const cancel = useSession((s) => s.cancel);
  const newSession = useSession((s) => s.newSession);
  const addFiles = useSession((s) => s.addFiles);
  const removeAttachment = useSession((s) => s.removeAttachment);
  const removeUpload = useSession((s) => s.removeUpload);

  const [draft, setDraft] = useState("");

  const metrics = view?.metrics ?? null;
  const notice = view?.notifications?.length
    ? view.notifications[view.notifications.length - 1].message
    : null;
  const mentioned = useMemo(() => matchMentions(draft, agents), [draft, agents]);

  const submit = async (text?: string) => {
    const value = (text ?? draft).trim();
    if (!value) return;
    if (!ready) {
      toast.error("Sin conexión con el engine", { description: "El maestro no puede recibir el mensaje." });
      return;
    }
    const targets = matchMentions(value, agents);
    setDraft("");
    try {
      if (!activeKey) await newSession();
      await send(targets.length ? toAgentInstruction(targets, value) : value);
    } catch (e) {
      toast.error("No se pudo enviar", { description: String(e) });
      setDraft(value);
    }
  };

  const mention = (name: string) => {
    setDraft((current) => `${current}${current && !current.endsWith(" ") ? " " : ""}@${name} `);
  };

  const recipient = mentioned.length
    ? mentioned.map((a) => `@${a.name.trim()}`).join(", ")
    : "Orquestador (maestro)";

  return (
    <div className="shrink-0 pt-1">
      <p className="px-4 pt-1 text-[0.62rem] text-muted-foreground">
        Enviar a{" "}
        <span className={cn("font-medium", mentioned.length ? "text-violet-soft" : "text-foreground")}>
          {recipient}
        </span>
      </p>

      {/* Atajos de mención: insertan `@rol` en el borrador */}
      {agents.length > 0 && (
        <div className="flex flex-wrap items-center gap-1 px-4 pt-1">
          <Bot className="size-2.5 text-muted-foreground" />
          {agents.map((agent) => (
            <button
              key={agent.id}
              onClick={() => mention(agent.name)}
              disabled={!agent.name.trim()}
              className="rounded-md border border-[var(--dashboard-border)] px-1.5 py-0.5 text-[0.62rem] text-violet-soft transition-colors dashboard-hover disabled:opacity-40"
            >
              @{agent.name.trim() || "sin nombre"}
            </button>
          ))}
        </div>
      )}

      <Composer
        value={draft}
        onChange={setDraft}
        onSend={(text) => void submit(text)}
        onStop={() => void cancel()}
        sending={!!view?.sending}
        disabled={!ready || !active}
        sessionId={activeKey}
        model={metrics?.model}
        provider={metrics?.provider}
        attachments={view?.attachments ?? []}
        uploads={view?.uploads ?? []}
        onAddFiles={(files) => void addFiles(files)}
        onRemoveAttachment={(path) => void removeAttachment(path)}
        onRemoveUpload={removeUpload}
        notice={notice}
        dense
      />
    </div>
  );
}
