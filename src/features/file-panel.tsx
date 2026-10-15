import {
  AlertTriangle,
  Check,
  CodeXml,
  Eye,
  FileDiff,
  FileText,
  Loader2,
  MessageSquarePlus,
  RefreshCw,
  Send,
  X,
} from "lucide-react";
import { useTheme } from "next-themes";
import type { PointerEvent as ReactPointerEvent } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { DiffView } from "@/components/diff-view";
import { PhosonLogo } from "@/components/phoson-logo";
import { Button } from "@/components/ui/button";
import { MarkdownRenderer } from "@/components/ui/markdown-renderer";
import { isTauri, phoson } from "@/bridge/client";
import type { FsReadResult } from "@/bridge/protocol";
import { openWithPreferredEditor } from "@/lib/desktop";
import { highlight } from "@/lib/highlighter";
import { unifiedDiffRows } from "@/lib/diff";
import { langFor } from "@/lib/code-lang";
import { cn } from "@/lib/utils";
import { useSession, type ToolCard } from "@/stores/session";
import { FILE_TOOLS, useFilePanel } from "@/stores/file-panel";

const basename = (p: string) => p.split("/").filter(Boolean).pop() ?? p;

/** Límites y geometría del panel. */
const MIN_WIDTH = 420;
const MIN_MAIN = 560;
const DEFAULT_WIDTH = 480;
const POPUP_WIDTH = 320;

/** Args de una tool, normalizados a registro (como hace `ToolRow`). */
const argsOf = (tool: ToolCard | undefined): Record<string, unknown> | undefined =>
  tool ? (tool.args as Record<string, unknown> | undefined) : undefined;

/** Escape mínimo para inyectar texto plano en HTML. */
const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** HTML resaltado dividido: cabecera `<pre…><code>` + una entrada por línea. */
interface HighlightedLines {
  head: string;
  lines: string[];
}

/**
 * Divide el HTML de shiki por líneas: la salida clásica envuelve cada línea en
 * `<span class="line">…</span>` separadas por `\n` de primer nivel, así que
 * partir el cuerpo por `\n` da exactamente una entrada por línea (los spans
 * anidados nunca contienen saltos). Permite revelar líneas ya resaltadas.
 */
function splitHighlighted(html: string): HighlightedLines | null {
  const start = html.indexOf("<code>");
  const end = html.lastIndexOf("</code>");
  if (start < 0 || end < start) return null;
  const open = "<code>".length;
  return {
    head: html.slice(0, start + open),
    lines: html.slice(start + open, end).split("\n"),
  };
}

/** Líneas sin resaltado con la misma forma que `splitHighlighted`. */
const plainLines = (text: string): HighlightedLines => ({
  head: '<pre class="shiki"><code>',
  lines: text.split("\n").map((l) => (l ? escapeHtml(l) : " ")),
});

/** Fallback sin resaltado como HTML completo (vista final del archivo). */
const plainLinesHtml = (text: string): string =>
  `<pre class="shiki"><code>${plainLines(text).lines.join("\n")}</code></pre>`;

/**
 * Conteo progresivo (typewriter): revela `total` unidades en ~3 s mientras
 * `active`, y salta al total en cuanto `active` pasa a false. Se usa para
 * líneas resaltadas (`write_file`), filas de diff (`patch_file`) y el Markdown
 * en vivo (cuantizado por el llamante).
 */
function useProgressive(total: number, active: boolean): number {
  const [count, setCount] = useState(total);
  useEffect(() => {
    if (!active) {
      setCount(total);
      return;
    }
    setCount(0);
    if (total === 0) return;
    const step = Math.max(1, Math.ceil(total / 100));
    const timer = setInterval(() => {
      setCount((c) => {
        if (c >= total) return c;
        return Math.min(total, c + step);
      });
    }, 30);
    return () => clearInterval(timer);
  }, [total, active]);
  return Math.min(count, total);
}

/**
 * Escena de escritura a pantalla completa: sobre una retícula tenue, una banda
 * de luz violeta barre el panel mientras el logo de Phoson respira en el
 * centro. Cubre los estados «redactando» (sin args) y «escribiendo» (aún sin
 * contenido que revelar).
 */
function WritingScene({ label }: { label: string }) {
  const { t } = useTranslation("tools");
  return (
    <div
      className="file-writing-backdrop absolute inset-0 flex flex-col items-center justify-center gap-5 overflow-hidden px-6"
      aria-busy
      aria-label={t("filePanel.writingAria")}
    >
      <div className="file-scanline" aria-hidden />
      <PhosonLogo showText={false} size={72} animated />
      <div className="flex flex-col items-center gap-1.5">
        <span className="text-sm font-medium text-foreground/80">
          {t("filePanel.writingTitle")}
        </span>
        <span className="text-xs text-muted-foreground">{label}</span>
        <div className="mt-2.5 flex w-48 flex-col gap-1.5">
          {[100, 72, 88].map((w, i) => (
            <div
              key={i}
              className="phoson-shimmer h-2.5 rounded bg-[var(--muted)]"
              style={{ width: `${w}%` }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * Escritura en vivo ya resaltada: revela líneas completas de shiki y añade el
 * cursor parpadeante al final. El HTML es seguro (shiki escapa el código).
 */
function LiveCode({ code, count }: { code: HighlightedLines; count: number }) {
  const html = `${code.head}${code.lines
    .slice(0, count)
    .join("\n")}<span class="file-caret" aria-hidden>▍</span></code></pre>`;
  return (
    <div
      className={cn(
        "p-4 font-mono text-[0.72rem] leading-relaxed",
        "[&_pre]:!bg-transparent [&_pre]:!p-0 [&_code]:!bg-transparent",
      )}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

/**
 * Vista de código con líneas numeradas y comentables: shiki envuelve cada línea
 * en `<span class="line">`, así que los números salen de contadores CSS y el
 * clic se resuelve por delegación sobre el propio HTML resaltado (no son nodos
 * de React). Las líneas con comentario se marcan imperativamente.
 */
function CodeLines({
  html,
  commentLines,
  onLineClick,
}: {
  html: string;
  commentLines: ReadonlySet<number>;
  onLineClick: (line: number, el: HTMLElement) => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.querySelectorAll(".line").forEach((line, i) => {
      line.classList.toggle("file-line-commented", commentLines.has(i + 1));
    });
  }, [html, commentLines]);

  return (
    <div
      ref={ref}
      className={cn(
        "file-panel-lines p-4 text-[0.72rem] leading-relaxed",
        "[&_pre]:!bg-transparent [&_code]:!bg-transparent",
      )}
      dangerouslySetInnerHTML={{ __html: html }}
      onClick={(e) => {
        const line = (e.target as HTMLElement).closest(".line");
        const el = ref.current;
        if (!line || !el) return;
        const index = Array.from(el.querySelectorAll(".line")).indexOf(line);
        if (index >= 0) onLineClick(index + 1, line as HTMLElement);
      }}
    />
  );
}

/** Comentario pendiente de enviar: anclado a una línea o general. */
interface LineComment {
  /** 1-based; `null` = comentario general del archivo. */
  line: number | null;
  text: string;
}

/** Pop-up de comentario posicionado junto a la línea (o al pie, si es general). */
interface CommentPopup {
  line: number | null;
  top: number;
  left: number;
  text: string;
}

interface FilePanelProps {
  /** En ventanas estrechas se muestra como panel superpuesto. */
  overlay?: boolean;
}

/**
 * Panel lateral de archivos del agente, redimensionable con el asa del borde
 * izquierdo y con animación de entrada/salida. La fila de «escribiendo/editando
 * archivo» del thread lo abre. Mientras la tool corre: escena de marca a pantalla
 * completa, escritura en vivo ya resaltada (línea a línea), diff animado o vista
 * previa de Markdown renderizada; al terminar: el archivo real (leído de disco),
 * el diff o la vista previa. Clic en una línea abre un pop-up para comentarla;
 * los comentarios se acumulan citando ruta y líneas y «Enviar» los manda como
 * turno. En la cabecera, botón para abrirlo en el editor externo.
 */
export function FilePanel({ overlay = false }: FilePanelProps) {
  const { t } = useTranslation(["tools", "common"]);
  const { resolvedTheme } = useTheme();
  const target = useFilePanel((s) => s.target);
  const close = useFilePanel((s) => s.close);
  const width = useFilePanel((s) => s.width);
  const setWidth = useFilePanel((s) => s.setWidth);
  const sessionId = target?.sessionId;
  const messageId = target?.messageId;
  const toolId = target?.toolId;

  // Tarjeta en vivo: el store de sesión la sustituye en cada evento (start →
  // done), así que el panel siempre pinta el estado real de la tool.
  const tool = useSession((s) => {
    if (!sessionId || !messageId) return undefined;
    const msg = s.sessions[sessionId]?.messages.find((m) => m.id === messageId);
    if (!msg) return undefined;
    if (toolId) {
      const part = msg.parts.find((p) => p.kind === "tool" && p.tool.id === toolId);
      return part?.kind === "tool" && FILE_TOOLS.has(part.tool.name) ? part.tool : undefined;
    }
    // Sin tool concreta (fila «redactando archivo…»): engancha con la última
    // tool de escritura del mensaje en cuanto el engine la arranque.
    for (let i = msg.parts.length - 1; i >= 0; i--) {
      const p = msg.parts[i];
      if (p.kind === "tool" && FILE_TOOLS.has(p.tool.name)) return p.tool;
    }
    return undefined;
  });

  // Sesión o mensaje ya no existen (sesión cerrada): el panel se cierra solo.
  const messageExists = useSession(
    (s) =>
      !!sessionId &&
      !!messageId &&
      s.sessions[sessionId]?.messages.some((m) => m.id === messageId),
  );
  useEffect(() => {
    if (target && !messageExists) close();
  }, [target, messageExists, close]);

  // Abierto desde la fila «redactando archivo…» (sin toolId): en cuanto la tool
  // aparece se fija, para que el panel no salte a otro archivo del mismo turno.
  const pinTool = useFilePanel((s) => s.open);
  useEffect(() => {
    if (target && !target.toolId && tool && messageExists) {
      pinTool({ sessionId: target.sessionId, messageId: target.messageId, toolId: tool.id });
    }
  }, [target, tool, messageExists, pinTool]);

  const send = useSession((s) => s.send);
  const ready = useSession((s) => s.ready);

  const args = argsOf(tool);
  const path = typeof args?.path === "string" ? args.path : undefined;
  const writeContent =
    tool?.name === "write_file" && typeof args?.content === "string" ? args.content : undefined;
  const patchRows = useMemo(() => {
    if (tool?.name !== "patch_file") return null;
    const oldContent = args?.old_content;
    const newContent = args?.new_content;
    if (typeof oldContent !== "string" || typeof newContent !== "string") return null;
    const rows = unifiedDiffRows(oldContent, newContent);
    return rows.length > 0 ? rows : null;
  }, [tool?.name, args?.old_content, args?.new_content]);

  const writing = !tool || tool.status === "running";
  const failed = tool?.status === "error";

  // Vista de una tool terminada: `patch_file` abre en el diff; los Markdown
  // admiten además «Preview» (render del contenido, también en vivo mientras
  // se escribe).
  const isMarkdown = !!path && ["markdown", "mdx"].includes(langFor(path));
  const [view, setView] = useState<"file" | "diff" | "preview">("file");
  useEffect(() => {
    setView(tool?.name === "patch_file" && patchRows ? "diff" : "file");
  }, [tool?.name, patchRows, toolId, sessionId, messageId]);

  // ── Entrada/salida: fundido ────────────────────────────────────────────────
  // Sin transform ni blur: en WKWebView (macOS), la combinación de entrada con
  // transform + `backdrop-filter` congela la presentación de frames y la
  // ventana se queda en negro (wry#1848). El panel se mantiene montado durante
  // el fundido de salida y se desmonta al acabarlo.
  const [mounted, setMounted] = useState(false);
  const [openCls, setOpenCls] = useState(false);
  useEffect(() => {
    if (target) {
      setMounted(true);
      const raf = requestAnimationFrame(() => setOpenCls(true));
      return () => cancelAnimationFrame(raf);
    }
    setOpenCls(false);
    const id = window.setTimeout(() => setMounted(false), 220);
    return () => window.clearTimeout(id);
  }, [target]);

  // ── Redimensión (asa del borde izquierdo) ──────────────────────────────────
  const [dragging, setDragging] = useState(false);
  const startResize = useCallback(
    (e: ReactPointerEvent) => {
      e.preventDefault();
      const startX = e.clientX;
      const startW = width;
      const maxWidth = () => Math.max(MIN_WIDTH, window.innerWidth - (overlay ? 0 : MIN_MAIN));
      setDragging(true);
      const onMove = (ev: PointerEvent) => {
        setWidth(Math.round(Math.min(Math.max(startW - (ev.clientX - startX), MIN_WIDTH), maxWidth())));
      };
      const onUp = () => {
        setDragging(false);
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [width, setWidth, overlay],
  );

  // ── Archivo en disco (vista «Archivo», «Preview» y estado final) ───────────
  const [file, setFile] = useState<FsReadResult | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  // Se lee de disco cuando ya terminó la tool (durante la escritura se usa el
  // contenido de los args) y la vista actual lo necesita.
  const wantFile = !writing && !failed && !!path && (view === "file" || view === "preview");
  useEffect(() => {
    if (!path || !wantFile) return;
    setFile(null);
    setFileError(null);
    phoson
      .fsRead(path)
      .then((d) => setFile(d))
      .catch((e) => setFileError(String(e)));
  }, [path, wantFile, reloadKey]);

  // Resaltado del archivo final (vista «Archivo»).
  const [html, setHtml] = useState("");
  useEffect(() => {
    if (!wantFile || view !== "file" || !file || file.binary) {
      setHtml("");
      return;
    }
    let cancelled = false;
    highlight(file.text, langFor(file.path), resolvedTheme === "dark")
      .then((h) => {
        if (!cancelled) setHtml(h ?? "");
      })
      .catch(() => {
        if (!cancelled) setHtml("");
      });
    return () => {
      cancelled = true;
    };
  }, [wantFile, view, file, resolvedTheme]);

  // Resaltado del contenido en vivo (`write_file`): se resalta el archivo
  // completo de una vez y se revela línea a línea — así los colores de los
  // tokens son correctos desde el primer tick del typewriter.
  const [writeCode, setWriteCode] = useState<HighlightedLines | null>(null);
  useEffect(() => {
    if (tool?.name !== "write_file" || !writeContent) {
      setWriteCode(null);
      return;
    }
    let cancelled = false;
    highlight(writeContent, path ? langFor(path) : "text", resolvedTheme === "dark")
      .then((h) => {
        if (cancelled) return;
        setWriteCode(h ? (splitHighlighted(h) ?? plainLines(writeContent)) : plainLines(writeContent));
      })
      .catch(() => {
        if (!cancelled) setWriteCode(plainLines(writeContent));
      });
    return () => {
      cancelled = true;
    };
  }, [tool?.name, writeContent, path, resolvedTheme]);

  // ── Animación de escritura ─────────────────────────────────────────────────
  // Líneas resaltadas (write_file) o filas de diff (patch_file).
  const revealedLines = useProgressive(writeCode?.lines.length ?? 0, writing && !!writeCode);
  const revealedRows = useProgressive(patchRows?.length ?? 0, writing && !!patchRows);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const scrollToEnd = useCallback(() => {
    const el = bodyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []);
  useEffect(() => {
    if (writing && view !== "preview") scrollToEnd();
  }, [revealedLines, revealedRows, writing, view, scrollToEnd]);

  // Para la vista previa en vivo se cuantiza el revelado (~20 repintados) para
  // no reprocesar el Markdown en cada tick del typewriter.
  const previewShownLines = useMemo(() => {
    const total = writeContent?.split("\n").length ?? 0;
    if (total === 0) return 0;
    const quantum = Math.max(1, Math.ceil(total / 20));
    return Math.floor(revealedLines / quantum) * quantum;
  }, [writeContent, revealedLines]);
  const previewText = writing
    ? tool?.name === "write_file" && writeContent
      ? writeContent.split("\n").slice(0, previewShownLines).join("\n")
      : null
    : file && !file.binary
      ? file.text
      : null;

  // ── Comentarios al agente (pop-up junto a la línea) ────────────────────────
  const [comments, setComments] = useState<LineComment[]>([]);
  const [popup, setPopup] = useState<CommentPopup | null>(null);
  const popupRef = useRef<HTMLDivElement | null>(null);

  // Al cambiar de archivo (o de tool) se descartan los comentarios en curso.
  const targetKey = target ? `${target.sessionId}:${target.messageId}:${target.toolId ?? ""}` : "";
  useEffect(() => {
    setComments([]);
    setPopup(null);
  }, [targetKey]);

  const commentLines = useMemo(
    () => new Set(comments.flatMap((c) => (c.line != null ? [c.line] : []))),
    [comments],
  );

  /**
   * Abre el pop-up de comentario: junto a la línea clicada (`anchorEl`, en
   * coordenadas del contenido del cuerpo, para que desplace con el scroll) o al
   * pie del área visible (diff y comentario general).
   */
  const openPopup = useCallback((line: number | null, anchorEl?: HTMLElement | null) => {
    const body = bodyRef.current;
    if (!body) return;
    let top: number;
    let left: number;
    if (anchorEl) {
      const r = anchorEl.getBoundingClientRect();
      const b = body.getBoundingClientRect();
      top = r.bottom - b.top + body.scrollTop + 6;
      left = r.left - b.left + body.scrollLeft + 16;
    } else {
      top = body.scrollTop + body.clientHeight - 180;
      left = 16;
    }
    left = Math.max(12, Math.min(left, Math.max(12, body.clientWidth - POPUP_WIDTH - 12)));
    setPopup({ line, top, left, text: "" });
  }, []);

  // El pop-up recién abierto debe quedar a la vista.
  useEffect(() => {
    popupRef.current?.scrollIntoView({ block: "nearest" });
  }, [popup?.top, popup?.left]);

  const addPopupComment = () => {
    const text = popup?.text.trim();
    if (!popup || !text) return;
    const line = popup.line;
    setComments((cs) => [...cs, { line, text }]);
    setPopup(null);
  };

  const [sending, setSending] = useState(false);
  const submitComments = async () => {
    if (comments.length === 0 || !path || sending) return;
    // Misma convención que el chat del swarm: instrucción en español, cita la
    // ruta y cada línea para que el agente sepa a qué se refiere cada cosa.
    const body = comments
      .map((c) => (c.line != null ? `- Línea ${c.line}: ${c.text}` : c.text))
      .join("\n");
    setSending(true);
    try {
      await send(`Sobre el archivo \`${path}\`:\n\n${body}`);
      setComments([]);
      setPopup(null);
      toast.success(t("filePanel.sent"));
    } catch (e) {
      toast.error(t("filePanel.sendError"), { description: String(e) });
    } finally {
      setSending(false);
    }
  };

  // Escape cierra primero el pop-up; en modo superpuesto, luego el panel.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (popup) {
        event.preventDefault();
        setPopup(null);
        return;
      }
      if (!overlay) return;
      event.preventDefault();
      close();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [overlay, close, popup]);

  // Vistas disponibles: durante la escritura solo tiene sentido el archivo en
  // vivo (`write_file`) y, si es Markdown, su vista previa renderizada; el diff
  // y el archivo de disco requieren la tool terminada.
  // NOTA: este useMemo va ANTES del early return de `mounted` — todo hook debe
  // ejecutarse en cada render o React crashea («more hooks than previous render»).
  const views = useMemo<[typeof FileDiff, "file" | "diff" | "preview", string][]>(() => {
    const list: [typeof FileDiff, "file" | "diff" | "preview", string][] = [];
    if (!writing) {
      if (tool?.name === "patch_file" && patchRows) {
        list.push([FileDiff, "diff", t("filePanel.viewDiff")]);
      }
      list.push([FileText, "file", t("filePanel.viewFile")]);
    } else if (tool?.name === "write_file") {
      list.push([FileText, "file", t("filePanel.viewFile")]);
    }
    if (isMarkdown && (!writing || tool?.name === "write_file")) {
      list.push([Eye, "preview", t("filePanel.viewPreview")]);
    }
    return list;
  }, [writing, tool?.name, patchRows, isMarkdown, t]);

  if (!mounted) return null;

  const statusIcon = failed ? (
    <AlertTriangle className="size-3.5 shrink-0 text-destructive" />
  ) : writing ? (
    <PhosonLogo showText={false} size={15} animated />
  ) : (
    <Check className="size-3.5 shrink-0 text-success" />
  );
  const statusLabel = failed
    ? t("filePanel.failed")
    : writing
      ? t(tool ? "filePanel.writing" : "filePanel.composing")
      : t("filePanel.written");

  // Ancho final: el elegido con el asa, acotado por el hueco disponible.
  const panelWidth = overlay
    ? `min(${Math.max(width, MIN_WIDTH)}px, 92vw)`
    : `min(${Math.max(width, MIN_WIDTH)}px, calc(100vw - ${MIN_MAIN}px))`;

  return (
    <aside
      role={overlay ? "dialog" : undefined}
      aria-modal={overlay || undefined}
      aria-label={t("filePanel.ariaLabel")}
      aria-hidden={!openCls || undefined}
      className={cn(
        "file-panel-surface relative flex shrink-0 flex-col border-[var(--dashboard-border)]",
        "transition-opacity duration-200 ease-out",
        overlay ? "fixed inset-y-0 right-0 z-50 border-l shadow-2xl" : "border-l",
        !openCls && "pointer-events-none opacity-0",
        dragging && "cursor-col-resize select-none",
      )}
      style={{ width: panelWidth }}
    >
      {/* Asa de redimensión (doble clic restaura el ancho por defecto). */}
      <div
        onPointerDown={startResize}
        onDoubleClick={() => setWidth(DEFAULT_WIDTH)}
        title={t("filePanel.resize")}
        className="group absolute inset-y-0 left-0 z-20 w-1.5 cursor-col-resize touch-none"
        aria-hidden
      >
        <div
          className={cn(
            "mx-auto h-full w-px bg-transparent transition-colors duration-150 group-hover:bg-violet/60",
            dragging && "bg-violet",
          )}
        />
      </div>

      {/* Cabecera: estado, ruta, vistas, abrir en editor, cerrar. */}
      <div className="flex items-center gap-2 border-b border-[var(--dashboard-border)] px-3 py-2.5">
        <FileText className="size-4 shrink-0 text-violet" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 text-sm font-medium">
            {statusIcon}
            <span className="truncate">{path ? basename(path) : t("filePanel.title")}</span>
          </div>
          {path ? (
            <div className="truncate text-[0.68rem] text-muted-foreground" title={path}>
              {path}
              {file?.truncated && t("viewer.truncated")}
            </div>
          ) : null}
        </div>

        {/* Cambio de vista (más de una disponible). */}
        {views.length > 1 && (
          <div className="flex shrink-0 rounded-md border border-[var(--dashboard-border)] p-0.5">
            {views.map(([Icon, key, title]) => (
              <button
                key={key}
                onClick={() => setView(key)}
                title={title}
                aria-label={title}
                aria-pressed={view === key}
                className={cn(
                  "grid size-6 place-items-center rounded text-muted-foreground transition-colors dashboard-hover",
                  view === key && "bg-[var(--muted)] text-foreground",
                )}
              >
                <Icon className="size-3.5" />
              </button>
            ))}
          </div>
        )}

        {!writing && !failed && path && view !== "diff" && (
          <button
            onClick={() => setReloadKey((k) => k + 1)}
            title={t("filePanel.reload")}
            className="grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors dashboard-hover hover:text-foreground"
          >
            <RefreshCw className="size-3.5" />
          </button>
        )}
        {path && isTauri() && (
          <button
            onClick={() =>
              void openWithPreferredEditor(path).catch((e) =>
                toast.error(t("editor.openError"), { description: String(e) }),
              )
            }
            title={t("editor.openInEditor")}
            aria-label={t("editor.openInEditor")}
            className="grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors dashboard-hover hover:text-foreground"
          >
            <CodeXml className="size-3.5" />
          </button>
        )}
        <button
          onClick={close}
          title={t("common:actions.close")}
          className="grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors dashboard-hover hover:text-foreground"
        >
          <X className="size-3.5" />
        </button>
      </div>

      {/* Cuerpo: escena de marca / escritura resaltada / diff / preview. */}
      <div ref={bodyRef} className="relative min-h-0 flex-1 overflow-auto bg-[var(--phoson-surface-2)]">
        {/* Tool en redacción o contenido aún no disponible: escena de marca. */}
        {!tool ||
        (writing && view !== "preview" && tool.name === "write_file" && !writeCode) ? (
          <WritingScene label={t(tool ? "filePanel.writing" : "filePanel.composing")} />
        ) : writing && view !== "preview" ? (
          tool.name === "patch_file" ? (
            patchRows ? (
              <DiffView rows={patchRows.slice(0, revealedRows)} className="m-2" />
            ) : (
              <WritingScene label={t("filePanel.writing")} />
            )
          ) : (
            <LiveCode code={writeCode!} count={revealedLines} />
          )
        ) : failed ? (
          <div className="flex flex-col gap-2 p-4 text-xs">
            <div className="flex items-center gap-2 font-medium text-destructive">
              <AlertTriangle className="size-3.5 shrink-0" /> {t("filePanel.failed")}
            </div>
            <pre className="overflow-auto whitespace-pre-wrap rounded-md border border-[var(--dashboard-border)] bg-[var(--muted)] p-2 text-[0.72rem] text-muted-foreground">
              {tool.error ?? t("filePanel.readError")}
            </pre>
          </div>
        ) : view === "diff" && patchRows ? (
          <DiffView
            rows={patchRows}
            maxLines={5000}
            className="m-2"
            onOpenLine={(line) => openPopup(line)}
            lineTitle={t("filePanel.commentLineTitle")}
          />
        ) : view === "preview" && previewText != null ? (
          <div className="p-4">
            <MarkdownRenderer content={previewText} streaming={writing} />
          </div>
        ) : fileError ? (
          <p className="p-4 text-xs text-destructive">{fileError}</p>
        ) : !file ? (
          <div className="flex items-center gap-2 p-4 text-xs text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" /> {t("viewer.opening")}
          </div>
        ) : file.binary ? (
          <p className="p-4 text-xs text-muted-foreground">{t("viewer.binary")}</p>
        ) : file.text.length === 0 ? (
          <p className="p-4 text-xs text-muted-foreground">{t("filePanel.empty")}</p>
        ) : (
          <CodeLines
            html={html || plainLinesHtml(file.text)}
            commentLines={commentLines}
            onLineClick={(line, el) => openPopup(line, el)}
          />
        )}

        {/* Pop-up de comentario sobre la línea (o general, al pie). */}
        {popup && (
          <div
            ref={popupRef}
            role="dialog"
            aria-label={t("filePanel.commentPlaceholder")}
            className="absolute z-10 flex w-80 flex-col gap-1.5 rounded-lg border border-[var(--dashboard-border)] bg-[var(--popover)] p-2 shadow-xl"
            style={{ top: popup.top, left: popup.left }}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="rounded-md bg-violet/15 px-1.5 py-0.5 text-[0.62rem] font-medium text-violet">
                {popup.line != null
                  ? t("filePanel.anchoredLine", { line: popup.line })
                  : t("filePanel.generalComment")}
              </span>
              <button
                onClick={() => setPopup(null)}
                title={t("common:actions.close")}
                aria-label={t("common:actions.close")}
                className="grid size-6 place-items-center rounded-md text-muted-foreground transition-colors dashboard-hover hover:text-foreground"
              >
                <X className="size-3.5" />
              </button>
            </div>
            <textarea
              autoFocus
              rows={3}
              value={popup.text}
              onChange={(e) => setPopup((p) => (p ? { ...p, text: e.target.value } : p))}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  addPopupComment();
                }
              }}
              spellCheck
              placeholder={
                popup.line != null
                  ? t("filePanel.commentLine", { line: popup.line })
                  : t("filePanel.commentPlaceholder")
              }
              aria-label={t("filePanel.commentPlaceholder")}
              className="w-full resize-none rounded-md border border-[var(--dashboard-border)] bg-transparent px-2 py-1.5 text-xs leading-relaxed outline-none placeholder:text-muted-foreground focus:border-violet/60"
            />
            <div className="flex justify-end">
              <Button
                size="sm"
                className="h-7 gap-1 bg-violet text-xs text-white hover:bg-violet/90"
                disabled={!popup.text.trim()}
                onClick={addPopupComment}
              >
                {t("filePanel.add")}
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Comentarios pendientes: la lista vive en el pie; se crean desde el
          pop-up de cada línea (clic en la línea) o el botón de comentario
          general. */}
      <div className="border-t border-[var(--dashboard-border)] p-2">
        {comments.length > 0 ? (
          <ul className="flex flex-col gap-1">
            {comments.map((c, i) => (
              <li
                key={i}
                className="flex items-start gap-1.5 rounded-md border border-[var(--dashboard-border)] bg-[var(--muted)] px-2 py-1.5 text-[0.68rem]"
              >
                <span
                  className={cn(
                    "mt-px shrink-0 rounded px-1 tabular-nums",
                    c.line != null ? "bg-violet/15 text-violet" : "text-muted-foreground",
                  )}
                >
                  {c.line != null
                    ? t("filePanel.anchoredLine", { line: c.line })
                    : t("filePanel.generalComment")}
                </span>
                <span className="min-w-0 flex-1 leading-snug">{c.text}</span>
                <button
                  onClick={() => setComments((cs) => cs.filter((_, j) => j !== i))}
                  title={t("filePanel.removeComment")}
                  aria-label={t("filePanel.removeComment")}
                  className="mt-px shrink-0 rounded-sm text-muted-foreground transition-colors dashboard-hover hover:text-foreground"
                >
                  <X className="size-3" />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <button
            onClick={() => openPopup(null)}
            disabled={!path}
            className="flex w-full items-center gap-2 rounded-md border border-dashed border-[var(--dashboard-border)] px-2 py-1.5 text-[0.68rem] text-muted-foreground transition-colors dashboard-hover hover:text-foreground disabled:opacity-50"
          >
            <MessageSquarePlus className="size-3.5 shrink-0" />
            {t("filePanel.newGeneralComment")}
          </button>
        )}
        <div className="mt-1.5 flex items-center justify-between gap-2">
          <span className="truncate text-[0.62rem] text-muted-foreground">{statusLabel}</span>
          <Button
            size="sm"
            className="h-7 shrink-0 gap-1.5 bg-violet text-xs text-white hover:bg-violet/90"
            disabled={comments.length === 0 || !path || !ready || sending}
            onClick={() => void submitComments()}
          >
            {sending ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Send className="size-3.5" />
            )}
            {t("filePanel.send")}
          </Button>
        </div>
      </div>
    </aside>
  );
}
