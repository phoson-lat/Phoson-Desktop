import { Wrench, Loader2, Check, AlertTriangle, ChevronRight } from "lucide-react";
import { useState, type ReactNode } from "react";

import { cn } from "@/lib/utils";
import type { ChatMessage, ToolCard } from "@/stores/session";

/* ── Inline: `code`, **bold**, *italic* ─────────────────────────────────── */
function Inline({ text }: { text: string }) {
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*)/g);
  return (
    <>
      {parts.map((p, i) => {
        if (p.startsWith("`") && p.endsWith("`")) {
          return (
            <code
              key={i}
              className="rounded-[4px] bg-[var(--muted)] px-1.5 py-0.5 font-mono text-[0.85em]"
            >
              {p.slice(1, -1)}
            </code>
          );
        }
        if (p.startsWith("**") && p.endsWith("**")) {
          return (
            <strong key={i} className="font-semibold">
              {p.slice(2, -2)}
            </strong>
          );
        }
        if (p.startsWith("*") && p.endsWith("*") && p.length > 2) {
          return <em key={i}>{p.slice(1, -1)}</em>;
        }
        return <span key={i}>{p}</span>;
      })}
    </>
  );
}

/* ── Bloque de código (con etiqueta de lenguaje) ────────────────────────── */
function CodeBlock({ lang, code }: { lang?: string; code: string }) {
  return (
    <div className="my-4 overflow-hidden rounded-xl border border-[var(--dashboard-border)] bg-[var(--muted)]">
      {lang ? (
        <div className="border-b border-[var(--dashboard-border)] px-3 py-1.5 text-[0.68rem] uppercase tracking-wide text-muted-foreground">
          {lang}
        </div>
      ) : null}
      <pre className="overflow-x-auto p-3 font-mono text-[0.8rem] leading-relaxed">
        <code>{code.replace(/\n$/, "")}</code>
      </pre>
    </div>
  );
}

/* ── Markdown mínimo basado en líneas (robusto en streaming) ────────────── */
function MarkdownLite({ text }: { text: string }) {
  const lines = text.split("\n");
  const out: ReactNode[] = [];
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Bloque de código (tolera fence sin cerrar mientras llega el stream).
    if (line.trimStart().startsWith("```")) {
      const lang = line.trim().slice(3).trim() || undefined;
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !lines[i].trimStart().startsWith("```")) {
        body.push(lines[i]);
        i += 1;
      }
      if (i < lines.length) i += 1; // consume el cierre
      out.push(<CodeBlock key={key++} lang={lang} code={body.join("\n")} />);
      continue;
    }

    // Títulos.
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    if (h) {
      const level = h[1].length;
      const sizes = ["text-lg", "text-base", "text-[0.95rem]", "text-[0.9rem]"];
      out.push(
        <p key={key++} className={cn("mt-4 mb-1.5 font-semibold first:mt-0", sizes[level - 1])}>
          <Inline text={h[2]} />
        </p>,
      );
      i += 1;
      continue;
    }

    // Listas.
    if (/^\s*([-*]|\d+\.)\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*([-*]|\d+\.)\s+/, ""));
        i += 1;
      }
      out.push(
        <ul key={key++} className="my-2 list-disc space-y-1 pl-5">
          {items.map((it, j) => (
            <li key={j}>
              <Inline text={it} />
            </li>
          ))}
        </ul>,
      );
      continue;
    }

    // Línea vacía: separador.
    if (!line.trim()) {
      i += 1;
      continue;
    }

    // Párrafo: agrupa líneas consecutivas normales.
    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !lines[i].trimStart().startsWith("```") &&
      !/^(#{1,4})\s+/.test(lines[i]) &&
      !/^\s*([-*]|\d+\.)\s+/.test(lines[i])
    ) {
      para.push(lines[i]);
      i += 1;
    }
    out.push(
      <p key={key++} className="my-2.5 first:mt-0 last:mb-0 leading-7">
        <Inline text={para.join("\n")} />
      </p>,
    );
  }

  return <>{out}</>;
}

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
        <ChevronRight className={cn("size-3 text-muted-foreground transition-transform", open && "rotate-90")} />
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

  // Agente: sin tarjeta. Texto plano sobre el fondo (estilo ChatGPT).
  return (
    <div className="flex flex-col">
      {message.tools.length > 0 && (
        <div className="mb-2 space-y-0.5">{message.tools.map((t) => <ToolRow key={t.id} tool={t} />)}</div>
      )}
      {message.text ? (
        <div className="text-[0.9375rem] text-foreground">
          <MarkdownLite text={message.text} />
        </div>
      ) : (
        <span className="inline-flex gap-1 py-1">
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className="size-1.5 animate-pulse rounded-full bg-violet"
              style={{ animationDelay: `${i * 150}ms` }}
            />
          ))}
        </span>
      )}
    </div>
  );
}
