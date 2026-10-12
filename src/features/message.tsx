import { Loader2, Check, AlertTriangle, ChevronRight, Copy, RotateCcw } from "lucide-react";
import { memo, useMemo, useState } from "react";

import { DiffView } from "@/components/diff-view";
import { ImageGrid } from "@/components/image-grid";
import { ImagePreview } from "@/components/image-preview";
import { UploadedFiles } from "@/components/uploads-block";
import { MarkdownRenderer } from "@/components/ui/markdown-renderer";
import {
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
  shimmerTextStyle,
} from "@/components/ui/reasoning";
import { ThinkingIndicator } from "@/components/thinking-indicator";
import { additionsRows, unifiedDiffRows } from "@/lib/diff";
import { fileUrlToPath } from "@/lib/files";
import { toolDetail, toolPresentation } from "@/lib/tool-labels";
import { cn } from "@/lib/utils";
import { messageText, type ChatMessage, type ToolCard } from "@/stores/session";

/* ── Llamada a herramienta (fila discreta, expandible) ──────────────────── */
function ToolRow({ tool }: { tool: ToolCard }) {
  const [open, setOpen] = useState(false);
  const Icon = tool.status === "running" ? Loader2 : tool.status === "error" ? AlertTriangle : Check;
  const args = tool.args as Record<string, unknown> | undefined;
  const filePath = typeof args?.path === "string" ? args.path : undefined;
  // `view_image` recibe la ruta en los args (el resultado de la tool solo lleva
  // texto), así que la previsualización se resuelve desde aquí. Puede llegar como
  // `file://…` (menciones): se normaliza a ruta local para leerla y abrirla.
  const imagePath = tool.name === "view_image" && filePath ? fileUrlToPath(filePath) : undefined;
  // La fila se lee como una acción ("leyendo archivo · src/App.tsx"), igual que
  // en el CLI; el nombre crudo queda en el tooltip.
  const presentation = useMemo(() => toolPresentation(tool.name), [tool.name]);
  const detail = useMemo(() => toolDetail(tool.name, args), [tool.name, args]);
  const ToolIcon = presentation.icon;

  /**
   * Diff para las tools de edición, reconstruido desde sus argumentos —
   * `patch_file` trae el bloque viejo y el nuevo, así que el diff es exacto;
   * `write_file` reescribe el archivo entero, así que se muestra como
   * adiciones (con el verbo creado/actualizado del resultado).
   *
   * Solo cuando la tool terminó: los args llegan incompletos mientras el
   * modelo los redacta (`AgentToolComposingEvent`).
   */
  const diff = useMemo(() => {
    if (tool.status === "running") return null;
    const a = args ?? {};
    if (tool.name === "patch_file") {
      const oldContent = a.old_content;
      const newContent = a.new_content;
      if (typeof oldContent !== "string" || typeof newContent !== "string") return null;
      const rows = unifiedDiffRows(oldContent, newContent);
      return rows.length > 0 ? { rows, note: undefined } : null;
    }
    if (tool.name === "write_file" && typeof a.content === "string") {
      const rows = additionsRows(a.content);
      if (rows.length === 0) return null;
      const verb = tool.result?.trim().toLowerCase().startsWith("updated")
        ? "actualizado"
        : "creado";
      return { rows, note: `${verb} · archivo completo` };
    }
    return null;
  }, [args, tool.name, tool.status, tool.result]);

  return (
    <div className="my-1">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        title={tool.name}
        className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-xs dashboard-hover"
      >
        <ChevronRight
          className={cn("size-3 text-muted-foreground transition-transform", open && "rotate-90")}
        />
        <ToolIcon className="size-3 shrink-0 text-muted-foreground" />
        <span
          className="min-w-0 truncate"
          style={tool.status === "running" ? shimmerTextStyle : undefined}
        >
          {presentation.verb}
        </span>
        {detail ? (
          <span className="min-w-0 truncate font-mono text-[0.7rem] text-muted-foreground">
            · {detail}
          </span>
        ) : null}
        <Icon
          className={cn(
            "ml-auto size-3",
            tool.status === "running" && "animate-spin text-violet",
            tool.status === "done" && "text-emerald-500",
            tool.status === "error" && "text-destructive",
          )}
        />
      </button>
      {open && imagePath ? <ImagePreview path={imagePath} className="px-2" /> : null}
      {open && diff && !tool.error ? (
        <DiffView rows={diff.rows} path={filePath} note={diff.note} className="px-2" />
      ) : null}
      {open && !(diff && !tool.error) && (tool.result || tool.error) ? (
        <pre className="mt-1 max-h-56 overflow-auto rounded-lg border border-[var(--dashboard-border)] bg-[var(--muted)] px-3 py-2 font-mono text-[0.72rem] text-muted-foreground">
          {tool.error ?? tool.result}
        </pre>
      ) : null}
    </div>
  );
}

/**
 * «✍ escribiendo archivo…»: el modelo está redactando una llamada a tool.
 *
 * Mientras genera argumentos largos (un `write_file` de 200 líneas, un `bash`
 * enorme) el engine no emite nada visible hasta que la tool arranca; el evento
 * `AgentToolComposingEvent` (I-128) solo trae el nombre, y con él se da
 * feedback real en vez de dejar la respuesta muda.
 */
function ComposingRow({ tool }: { tool: string }) {
  const { verb, icon: Icon } = toolPresentation(tool);
  return (
    <div
      className="my-1 flex items-center gap-2 px-2 py-1 text-xs"
      aria-live="polite"
      aria-busy
      title={tool}
    >
      <Loader2 className="size-3 shrink-0 animate-spin text-violet" />
      <Icon className="size-3 shrink-0 text-muted-foreground" />
      <span style={shimmerTextStyle}>{verb}</span>
      <span className="phoson-dots flex text-violet" aria-hidden>
        <span>.</span>
        <span>.</span>
        <span>.</span>
      </span>
    </div>
  );
}

/** Acción discreta por mensaje (copiar / regenerar). */
function MessageAction({
  icon: Icon,
  label,
  onClick,
}: {
  icon: typeof Copy;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      aria-label={label}
      className="grid size-6 place-items-center rounded-md text-muted-foreground transition-colors dashboard-hover hover:text-foreground"
    >
      <Icon className="size-3.5" />
    </button>
  );
}

function MessageRowView({
  message,
  isLast,
  onRegenerate,
}: {
  message: ChatMessage;
  isLast?: boolean;
  onRegenerate?: () => void;
}) {
  const [copied, setCopied] = useState(false);
  if (message.role === "user") {
    return (
      <div className="flex flex-col items-end gap-1">
        {message.images && message.images.length > 0 && (
          <ImageGrid paths={message.images} className="justify-end" />
        )}
        {message.uploads && message.uploads.length > 0 && (
          <UploadedFiles files={message.uploads} />
        )}
        {message.text.trim() ? (
          <div className="chat-bubble-user max-w-[76%] whitespace-pre-wrap">{message.text}</div>
        ) : null}
      </div>
    );
  }

  // Agente: sin tarjeta. Se renderizan las partes EN ORDEN (texto y tools
  // intercalados, tal como los emite el bucle ReAct del engine).
  const lastIndex = message.parts.length - 1;
  const reasoning = message.reasoning ?? "";
  // El razonamiento precede a la acción: en cuanto aparece texto o una tool,
  // "pensar" ha terminado (y el bloque se cierra solo).
  const outputStarted = message.parts.length > 0;
  const reasoningStreaming =
    message.status === "streaming" && reasoning.length > 0 && !outputStarted;
  // Tool en redacción (`AgentToolComposingEvent`): información más concreta que
  // un "Pensando…", así que la sustituye cuando llega.
  const composing = message.status === "streaming" ? message.composingTool : undefined;

  return (
    <div className="group/msg flex flex-col">
      {reasoning && (
        <Reasoning isStreaming={reasoningStreaming} defaultOpen={reasoningStreaming}>
          <ReasoningTrigger />
          <ReasoningContent>{reasoning}</ReasoningContent>
        </Reasoning>
      )}

      {message.parts.length === 0 ? (
        // Aún sin salida: o el modelo piensa de verdad, o ya está escribiendo
        // la llamada a una tool.
        composing ? (
          <ComposingRow tool={composing} />
        ) : (
          message.status === "streaming" && !reasoning && <ThinkingIndicator />
        )
      ) : (
        <>
          {message.parts.map((part, index) =>
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
          )}
          {composing ? <ComposingRow tool={composing} /> : null}
        </>
      )}

      {/* Acciones (hover/focus): copiar siempre; regenerar solo el último turno. */}
      {message.status !== "streaming" && (
        <div className="mt-1 flex items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover/msg:opacity-100">
          <MessageAction
            icon={copied ? Check : Copy}
            label={copied ? "Copiado" : "Copiar respuesta"}
            onClick={() => {
              void navigator.clipboard.writeText(messageText(message)).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              });
            }}
          />
          {isLast && onRegenerate && (
            <MessageAction icon={RotateCcw} label="Regenerar" onClick={onRegenerate} />
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Memoizado: durante el streaming solo cambia el ÚLTIMO mensaje (el store
 * conserva la identidad del resto), así que los anteriores no se re-renderizan
 * ni vuelven a parsear su markdown en cada flush del rAF.
 */
export const MessageRow = memo(MessageRowView);
