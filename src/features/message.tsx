import { Wrench, Loader2, Check, AlertTriangle, ChevronRight } from "lucide-react";
import { useState } from "react";

import { MarkdownRenderer } from "@/components/ui/markdown-renderer";
import { cn } from "@/lib/utils";
import type { ChatMessage, ToolCard } from "@/stores/session";

/* ── Llamada a herramienta (fila discreta, expandible) ──────────────────── */
function ToolRow({ tool }: { tool: ToolCard }) {
  const [open, setOpen] = useState(false);
  const Icon = tool.status === "running" ? Loader2 : tool.status === "error" ? AlertTriangle : Check;
  return (
    <div className="my-1">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-xs dashboard-hover"
      >
        <ChevronRight
          className={cn("size-3 text-muted-foreground transition-transform", open && "rotate-90")}
        />
        <Wrench className="size-3 text-muted-foreground" />
        <span className="font-mono text-[0.72rem] text-foreground/85">{tool.name}</span>
        <Icon
          className={cn(
            "ml-auto size-3",
            tool.status === "running" && "animate-spin text-violet",
            tool.status === "done" && "text-emerald-500",
            tool.status === "error" && "text-destructive",
          )}
        />
      </button>
      {open && (tool.result || tool.error) ? (
        <pre className="mt-1 max-h-56 overflow-auto rounded-lg border border-[var(--dashboard-border)] bg-[var(--muted)] px-3 py-2 font-mono text-[0.72rem] text-muted-foreground">
          {tool.error ?? tool.result}
        </pre>
      ) : null}
    </div>
  );
}

export function MessageRow({ message }: { message: ChatMessage }) {
  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="chat-bubble-user max-w-[76%] whitespace-pre-wrap">{message.text}</div>
      </div>
    );
  }

  // Agente: sin tarjeta. Se renderizan las partes EN ORDEN (texto y tools
  // intercalados, tal como los emite el bucle ReAct del engine).
  const lastIndex = message.parts.length - 1;

  return (
    <div className="flex flex-col">
      {message.parts.length === 0 ? (
        <span className="inline-flex gap-1 py-1">
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className="size-1.5 animate-pulse rounded-full bg-violet"
              style={{ animationDelay: `${i * 150}ms` }}
            />
          ))}
        </span>
      ) : (
        message.parts.map((part, index) =>
          part.kind === "tool" ? (
            <ToolRow key={`tool-${part.tool.id}-${index}`} tool={part.tool} />
          ) : (
            <div key={`text-${index}`} className="text-[0.9375rem] text-foreground">
              <MarkdownRenderer
                content={part.text}
                // Solo el último bloque (el que aún llega) se renderiza en modo stream.
                streaming={message.status === "streaming" && index === lastIndex}
              />
            </div>
          ),
        )
      )}
    </div>
  );
}
