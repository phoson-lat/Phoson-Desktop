import {
  Loader2,
  Check,
  AlertTriangle,
  AlertCircle,
  ChevronRight,
  Copy,
  PanelRightOpen,
  RotateCcw,
  Settings2,
  Square,
} from "lucide-react";
import { memo, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

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
import { useThrottledValue } from "@/hooks/use-throttled-value";
import { fileUrlToPath } from "@/lib/files";
import {
  bashOutput,
  errorHeadline,
  formatDurationMs,
  toolDetail,
  toolGroupSummary,
  toolPresentation,
} from "@/lib/tool-labels";
import { cn } from "@/lib/utils";
import {
  messageText,
  useSession,
  type ChatMessage,
  type MessagePart,
  type ToolCard,
} from "@/stores/session";
import { FILE_TOOLS, useFilePanel } from "@/stores/file-panel";

/* ── Llamada a herramienta (fila discreta, expandible) ──────────────────── */
function ToolRow({ tool, messageId }: { tool: ToolCard; messageId: string }) {
  const { t } = useTranslation("chat");
  const [open, setOpen] = useState(false);
  // Tools de escritura: la fila abre el panel lateral en vez del desplegable
  // (el diff/archivo se ve ahí, en vivo y con comentarios para el agente).
  const isFileTool = FILE_TOOLS.has(tool.name);
  const sessionId = useSession((s) => s.activeKey);
  const openFilePanel = useFilePanel((s) => s.open);
  const Icon = tool.status === "running" ? Loader2 : tool.status === "error" ? AlertTriangle : Check;
  const args = tool.args as Record<string, unknown> | undefined;
  const filePath = typeof args?.path === "string" ? args.path : undefined;
  // `view_image` recibe la ruta en los args (el resultado de la tool solo lleva
  // texto), así que la previsualización se resuelve desde aquí. Puede llegar como
  // `file://…` (menciones): se normaliza a ruta local para leerla y abrirla.
  const imagePath = tool.name === "view_image" && filePath ? fileUrlToPath(filePath) : undefined;
  // La fila se lee como una acción ("leyendo archivo · src/App.tsx"), igual que
  // en el CLI; el nombre crudo queda en el tooltip. El verbo viene del catálogo,
  // así que `t` entra en las dependencias: al cambiar de idioma se recalcula.
  const presentation = useMemo(() => toolPresentation(tool.name, t), [tool.name, t]);
  const detail = useMemo(() => toolDetail(tool.name, args), [tool.name, args]);
  const ToolIcon = presentation.icon;

  return (
    <div className="my-1">
      <button
        onClick={() => {
          if (isFileTool && sessionId) {
            openFilePanel({ sessionId, messageId, toolId: tool.id });
            return;
          }
          setOpen((o) => !o);
        }}
        aria-expanded={isFileTool ? undefined : open}
        title={isFileTool ? t("message.openFilePanel") : tool.name}
        className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-xs dashboard-hover"
      >
        {isFileTool ? (
          // Pista visual de que la fila abre el panel lateral, no un desplegable.
          <PanelRightOpen className="size-3 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight
            className={cn("size-3 text-muted-foreground transition-transform", open && "rotate-90")}
          />
        )}
        <ToolIcon className="size-3 shrink-0 text-muted-foreground" />
        <span
          className="min-w-0 truncate"
          style={tool.status === "running" ? shimmerTextStyle : undefined}
        >
          {presentation.verb}
        </span>
        {detail ? (
          <span
            className="min-w-0 truncate font-mono text-[0.7rem] text-muted-foreground"
            title={detail}
          >
            · {detail}
          </span>
        ) : null}
        {/* Como en el CLI: la duración cierra la fila (0 = desconocida). */}
        {tool.status !== "running" && tool.durationMs ? (
          <span className="shrink-0 font-mono text-[0.7rem] text-muted-foreground">
            · {formatDurationMs(tool.durationMs)}
          </span>
        ) : null}
        <Icon
          className={cn(
            "ml-auto size-3",
            tool.status === "running" && "animate-spin text-violet",
            tool.status === "done" && "text-success",
            tool.status === "error" && "text-destructive",
          )}
        />
      </button>
      {/* El fallo se lee sin desplegar: su primera línea bajo la fila (CLI). */}
      {tool.status === "error" && tool.error && !open ? (
        <p className="truncate pr-2 pl-[2.6rem] font-mono text-[0.7rem] text-destructive" title={tool.error}>
          {errorHeadline(tool.error)}
        </p>
      ) : null}
      {open && imagePath ? <ImagePreview path={imagePath} className="px-2" /> : null}
      {open && tool.name === "bash" && !tool.error && tool.result ? (
        <BashOutput result={tool.result} />
      ) : open && (tool.result || tool.error) ? (
        <pre className="mt-1 max-h-56 overflow-auto rounded-lg border border-[var(--dashboard-border)] bg-[var(--muted)] px-3 py-2 font-mono text-[0.72rem] text-muted-foreground">
          {tool.error || tool.result}
        </pre>
      ) : null}
    </div>
  );
}

/**
 * Salida de `bash` como en el CLI: sin escapes de terminal, las primeras líneas
 * y «… +N líneas más» para ver el resto.
 */
function BashOutput({ result }: { result: string }) {
  const { t } = useTranslation("chat");
  const [all, setAll] = useState(false);
  const output = useMemo(() => bashOutput(result), [result]);
  if (output.all.length === 0) return null;
  return (
    <div className="mt-1 rounded-lg border border-[var(--dashboard-border)] bg-[var(--muted)] px-3 py-2">
      <pre className="max-h-72 overflow-auto font-mono text-[0.72rem] text-muted-foreground">
        {(all ? output.all : output.preview).join("\n")}
      </pre>
      {output.hidden > 0 ? (
        <button
          onClick={() => setAll((v) => !v)}
          className="mt-1 font-mono text-[0.7rem] text-muted-foreground hover:text-foreground"
        >
          {all ? t("tools.showLess") : t("tools.moreLines", { count: output.hidden })}
        </button>
      ) : null}
    </div>
  );
}

/** Racha de tools consecutivas (entre dos trozos de texto del agente). */
type MessageSegment =
  | { kind: "text"; text: string; index: number }
  | { kind: "tools"; tools: ToolCard[]; index: number };

/** Agrupa las partes en texto y rachas de tools, conservando el orden. */
const segmentParts = (parts: MessagePart[]): MessageSegment[] => {
  const out: MessageSegment[] = [];
  parts.forEach((part, index) => {
    const prev = out[out.length - 1];
    if (part.kind === "text") out.push({ kind: "text", text: part.text, index });
    else if (prev?.kind === "tools") prev.tools.push(part.tool);
    else out.push({ kind: "tools", tools: [part.tool], index });
  });
  return out;
};

/**
 * Racha de tools: mientras corre (o si es una sola) se ve llamada a llamada; una
 * vez cerrada se pliega en una línea, como el modo `summary` del `/details` del
 * CLI: «⚙ 4 herramientas usadas · bash ×2, read_file, grep · ✗ 1 error · 3.2s».
 * Al desplegarla vuelven las filas de cada llamada.
 */
function ToolGroup({
  tools,
  closed,
  messageId,
}: {
  tools: ToolCard[];
  closed: boolean;
  messageId: string;
}) {
  const { t } = useTranslation("chat");
  const [open, setOpen] = useState(false);
  const foldable = closed && tools.length > 1 && tools.every((tool) => tool.status !== "running");
  const summary = useMemo(() => toolGroupSummary(tools), [tools]);
  const rows = tools.map((tool, i) => (
    <ToolRow key={`tool-${tool.id}-${i}`} tool={tool} messageId={messageId} />
  ));
  if (!foldable) return <>{rows}</>;
  return (
    <div className="my-1">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-xs dashboard-hover"
      >
        <ChevronRight
          className={cn("size-3 text-muted-foreground transition-transform", open && "rotate-90")}
        />
        <Settings2 className="size-3 shrink-0 text-muted-foreground" />
        <span className="shrink-0">{t("tools.group", { count: summary.count })}</span>
        <span className="min-w-0 truncate font-mono text-[0.7rem] text-muted-foreground">
          · {summary.names.join(", ")}
        </span>
        {summary.errors > 0 ? (
          <span className="shrink-0 font-mono text-[0.7rem] text-destructive">
            · ✗ {t("tools.errors", { count: summary.errors })}
          </span>
        ) : null}
        {summary.totalMs > 0 ? (
          <span className="shrink-0 font-mono text-[0.7rem] text-muted-foreground">
            · {formatDurationMs(summary.totalMs)}
          </span>
        ) : null}
        {summary.errors > 0 ? (
          <AlertTriangle className="ml-auto size-3 text-destructive" />
        ) : (
          <Check className="ml-auto size-3 text-success" />
        )}
      </button>
      {open ? <div className="ml-3 border-l border-[var(--dashboard-border)] pl-1">{rows}</div> : null}
    </div>
  );
}

/**
 * «✍ escribiendo archivo…»: el modelo está redactando una llamada a tool.
 *
 * Mientras genera argumentos largos (un `write_file` de 200 líneas, un `bash`
 * enorme) el engine no emite nada visible hasta que la tool arranca; el evento
 * `AgentToolComposingEvent` (I-128) solo trae el nombre, y con él se da
 * feedback real en vez de dejar la respuesta muda. Si es una tool de escritura,
 * la fila abre el panel lateral (que enganchará con la tool en cuanto exista).
 */
function ComposingRow({ tool, messageId }: { tool: string; messageId: string }) {
  const { t } = useTranslation("chat");
  const sessionId = useSession((s) => s.activeKey);
  const openFilePanel = useFilePanel((s) => s.open);
  const { verb, icon: Icon } = toolPresentation(tool, t);
  const clickable = FILE_TOOLS.has(tool) && !!sessionId;

  const content = (
    <>
      <Loader2 className="size-3 shrink-0 animate-spin text-violet" />
      <Icon className="size-3 shrink-0 text-muted-foreground" />
      <span style={shimmerTextStyle}>{verb}</span>
      <span className="phoson-dots flex text-violet" aria-hidden>
        <span>.</span>
        <span>.</span>
        <span>.</span>
      </span>
    </>
  );

  return clickable ? (
    <button
      onClick={() => sessionId && openFilePanel({ sessionId, messageId })}
      title={t("message.openFilePanel")}
      className="my-1 flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-xs dashboard-hover"
    >
      {content}
    </button>
  ) : (
    <div
      className="my-1 flex items-center gap-2 px-2 py-1 text-xs"
      aria-live="polite"
      aria-busy
      title={tool}
    >
      {content}
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

/** Botón «copiar» con confirmación breve (agente y turno del usuario). */
function CopyAction({ getText, label }: { getText: () => string; label: string }) {
  const { t } = useTranslation("common");
  const [copied, setCopied] = useState(false);
  return (
    <MessageAction
      icon={copied ? Check : Copy}
      label={copied ? t("actions.copied") : label}
      onClick={() => {
        void navigator.clipboard.writeText(getText()).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
    />
  );
}

/**
 * Bloque de texto del agente. Durante el streaming el valor que llega cambia cada
 * ~32 ms (volcado del buffer en el store) y cada cambio re-ejecutaba remark +
 * rehype + KaTeX sobre el bloque en curso; aquí se limita a ~140 ms y el valor
 * final se pinta exacto al terminar el turno.
 */
function TextBlock({ text, streaming }: { text: string; streaming: boolean }) {
  const shown = useThrottledValue(text, streaming);
  return (
    <div className="text-[0.9375rem] text-foreground">
      <MarkdownRenderer content={shown} streaming={streaming} />
    </div>
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
  const { t } = useTranslation(["chat", "common"]);
  if (message.role === "user") {
    return (
      <div className="group/msg flex flex-col items-end gap-1">
        {message.images && message.images.length > 0 && (
          <ImageGrid paths={message.images} className="justify-end" />
        )}
        {message.uploads && message.uploads.length > 0 && (
          <UploadedFiles files={message.uploads} />
        )}
        {message.text.trim() ? (
          <div className="chat-bubble-user max-w-[76%] whitespace-pre-wrap">{message.text}</div>
        ) : null}
        {/* Acciones del turno del usuario: antes solo el agente las tenía, así que
            recopiar lo que escribiste obligaba a seleccionar el texto a mano. */}
        <div className="flex items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover/msg:opacity-100">
          <CopyAction getText={() => message.text} label={t("message.copyUser")} />
        </div>
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
          <ComposingRow tool={composing} messageId={message.id} />
        ) : (
          message.status === "streaming" && !reasoning && <ThinkingIndicator />
        )
      ) : (
        <>
          {segmentParts(message.parts).map((segment, i, segments) =>
            segment.kind === "tools" ? (
              <ToolGroup
                key={`tools-${segment.tools[0].id}-${segment.index}`}
                tools={segment.tools}
                // Cerrada = ya hay texto después o el turno terminó (= CLI).
                closed={i < segments.length - 1 || message.status !== "streaming"}
                messageId={message.id}
              />
            ) : (
              <TextBlock
                key={`text-${segment.index}`}
                text={segment.text}
                // Solo el último bloque (el que aún llega) se renderiza en modo stream.
                streaming={message.status === "streaming" && segment.index === lastIndex}
              />
            ),
          )}
          {composing ? <ComposingRow tool={composing} messageId={message.id} /> : null}
        </>
      )}

      {/* Fallo del turno: se pinta aparte del contenido (el error NO es texto del
          modelo) con la salida para reintentar desde el mismo sitio. */}
      {message.status === "error" && (
        <div
          role="status"
          className="mt-2 flex items-start gap-2 rounded-lg border border-danger/35 bg-danger/[0.07] px-3 py-2 text-xs"
        >
          <AlertCircle className="mt-px size-3.5 shrink-0 text-danger" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="font-medium text-danger">{t("message.turnFailed")}</p>
            <p className="mt-0.5 break-words text-muted-foreground">
              {message.error ?? t("message.noDetail")}
            </p>
          </div>
          {isLast && onRegenerate && (
            <button
              onClick={onRegenerate}
              className="shrink-0 rounded-md border border-danger/40 px-2 py-1 font-medium text-danger transition-colors hover:bg-danger/10"
            >
              {t("common:actions.retry")}
            </button>
          )}
        </div>
      )}

      {/* Turno detenido por el usuario: nota discreta (el contenido ya emitido se
          conserva). «Continuar» necesitaría un turno de continuación en el engine. */}
      {message.status === "cancelled" && (
        <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
          <Square className="size-3 shrink-0" aria-hidden />
          <span>{t("message.stoppedByYou")}</span>
        </div>
      )}

      {/* Acciones (hover/focus): copiar siempre; regenerar solo el último turno. */}
      {message.status !== "streaming" && (
        <div className="mt-1 flex items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover/msg:opacity-100">
          <CopyAction getText={() => messageText(message)} label={t("message.copyReply")} />
          {isLast && onRegenerate && (
            <MessageAction icon={RotateCcw} label={t("message.regenerate")} onClick={onRegenerate} />
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
