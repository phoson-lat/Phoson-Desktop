import { ArrowUp, FileText, Image as ImageIcon, Mic, Paperclip, Square, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import type { Attachment, UploadedFile } from "@/bridge/protocol";
import { AudioBars } from "@/components/audio-bars";
import { UploadedFiles } from "@/components/uploads-block";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ModelPicker } from "@/features/model-picker";
import { ReasoningEffortPicker } from "@/features/reasoning-effort";
import { useVoiceInput } from "@/hooks/use-voice-input";
import { cn } from "@/lib/utils";

interface ComposerProps {
  value: string;
  onChange: (v: string) => void;
  /** Recibe el texto del DOM (puede ir por delante del estado). */
  onSend: (text?: string) => void;
  onStop: () => void;
  sending: boolean;
  disabled?: boolean;
  /** Contexto para los controles del composer (modelo / razonamiento). */
  sessionId: string | null;
  model?: string;
  provider?: string;
  /** Adjuntos pendientes (pegar, arrastrar o elegir). */
  attachments: Attachment[];
  /** Archivos no nativos ya subidos al workspace (se referencian en el prompt). */
  uploads: UploadedFile[];
  onAddFiles: (files: File[]) => void;
  onRemoveAttachment: (path: string) => void;
  onRemoveUpload: (path: string) => void;
  /** Aviso puntual (p. ej. tipo de archivo no soportado). */
  notice?: string | null;
}

/**
 * Continúa listas markdown al pulsar **Shift/Ctrl/Cmd + Enter** (el salto de
 * línea manual): repite el marcador (`-`, `*`, `+`) o incrementa el número. Con
 * el marcador vacío, sale de la lista. Enter a secas envía el mensaje.
 */
function continueList(text: string, caret: number): { text: string; caret: number } | null {
  const before = text.slice(0, caret);
  const lineStart = before.lastIndexOf("\n") + 1;
  const line = before.slice(lineStart);
  const match = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(line);
  if (!match) return null;
  const [, indent, marker, rest] = match;

  if (rest.trim() === "") {
    // Marcador sin contenido → termina la lista.
    return {
      text: text.slice(0, lineStart) + indent + text.slice(caret),
      caret: lineStart + indent.length,
    };
  }

  const nextMarker = /\d/.test(marker)
    ? `${parseInt(marker, 10) + 1}${marker.replace(/^\d+/, "")}`
    : marker;
  const insert = `\n${indent}${nextMarker} `;
  return {
    text: text.slice(0, caret) + insert + text.slice(caret),
    caret: caret + insert.length,
  };
}

const kindIcon = (kind: string) => (kind === "image" ? ImageIcon : FileText);

export function Composer({
  value,
  onChange,
  onSend,
  onStop,
  sending,
  disabled,
  sessionId,
  model,
  provider,
  attachments,
  uploads,
  onAddFiles,
  onRemoveAttachment,
  onRemoveUpload,
  notice,
}: ComposerProps) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  /** Aviso visible temporalmente (tipo no soportado, etc.). */
  const [shownNotice, setShownNotice] = useState<string | null>(null);
  /** Texto previo al dictado, para ir sustituyendo el resultado interino. */
  const voiceBase = useRef("");

  // Auto-grow
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [value]);

  const { supported, listening, error, toggle } = useVoiceInput({
    sessionId,
    onText: (text, final) => {
      if (final) {
        voiceBase.current = `${voiceBase.current} ${text}`.trimStart();
        onChange(voiceBase.current);
      } else {
        onChange(`${voiceBase.current} ${text}`.trimStart());
      }
    },
  });

  // Mantén la base en sync cuando se escribe a mano (fuera del dictado).
  useEffect(() => {
    if (!listening) voiceBase.current = value;
  }, [value, listening]);

  // Muestra el aviso entrante durante unos segundos.
  useEffect(() => {
    if (!notice) return;
    setShownNotice(notice);
    const timer = setTimeout(() => setShownNotice(null), 6000);
    return () => clearTimeout(timer);
  }, [notice]);

  const submit = (text?: string) => {
    if (!(text ?? value).trim() || disabled) return;
    // Reenvía el texto del DOM cuando lo tenemos: puede ir por delante del
    // estado de React (tecleo rápido / IME) y no debe perderse.
    onSend(text);
  };

  return (
    <div className="shrink-0 px-4 pb-4">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setDragging(true);
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          // El contenedor raíz también acepta drops: no duplicar.
          e.stopPropagation();
          setDragging(false);
          const files = Array.from(e.dataTransfer.files ?? []);
          if (files.length) onAddFiles(files);
        }}
        className={cn(
          "dashboard-panel relative mx-auto max-w-3xl overflow-hidden rounded-2xl border p-2 transition-colors",
          sending && "phoson-sending",
          dragging && "border-violet",
        )}
      >
        {dragging && (
          <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center rounded-2xl bg-[var(--background)]/85 text-xs text-violet">
            Suelta los archivos para adjuntarlos
          </div>
        )}

        {/* Adjuntos pendientes */}
        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-1.5 px-1 pb-1.5">
            {attachments.map((a) => {
              const Icon = kindIcon(a.kind);
              return (
                <span
                  key={a.path}
                  className="flex max-w-[14rem] items-center gap-1.5 rounded-lg bg-[var(--phoson-surface-2)] px-2 py-1 text-[0.68rem]"
                >
                  <Icon className="size-3 shrink-0 text-violet" />
                  <span className="truncate" title={a.path}>
                    {a.name}
                  </span>
                  <button
                    onClick={() => onRemoveAttachment(a.path)}
                    title="Quitar"
                    className="shrink-0 text-muted-foreground transition-colors hover:text-destructive"
                  >
                    <X className="size-3" />
                  </button>
                </span>
              );
            })}
          </div>
        )}

        {/* Archivos subidos al workspace (no nativos): se referencian en el prompt */}
        <UploadedFiles files={uploads} onRemove={onRemoveUpload} className="px-1 pb-1.5" />

        <Textarea
          ref={ref}
          value={value}
          disabled={disabled}
          rows={1}
          placeholder={
            listening
              ? "Escuchando…"
              : "Escribe un mensaje…  (Enter envía · Shift/Ctrl+Enter salto de línea)"
          }
          onChange={(e) => {
            // Si el usuario edita a mano mientras dicta, sincroniza la base para
            // que el siguiente fragmento no sobrescriba lo escrito.
            if (listening) voiceBase.current = e.target.value;
            onChange(e.target.value);
          }}
          onPaste={(e) => {
            const files = Array.from(e.clipboardData.files ?? []);
            if (files.length) {
              e.preventDefault();
              onAddFiles(files);
            }
          }}
          onKeyDown={(e) => {
            // Escape detiene la generación (convención de los chats de agente).
            if (e.key === "Escape" && sending) {
              e.preventDefault();
              onStop();
              return;
            }
            if (e.key !== "Enter") return;
            const el = e.currentTarget;
            // El DOM es la fuente de verdad: el estado de React puede ir un paso
            // por detrás al teclear rápido.
            const domValue = el.value;
            const start = el.selectionStart ?? domValue.length;
            const end = el.selectionEnd ?? start;
            const base = domValue.slice(0, start) + domValue.slice(end);

            /** Salto de línea manual: Shift+Enter, Ctrl+Enter o Cmd+Enter. */
            const manualBreak = e.shiftKey || e.ctrlKey || e.metaKey;
            if (manualBreak) {
              const cont = continueList(base, start);
              if (cont) {
                // Continúa/sale de la lista en vez del salto simple.
                e.preventDefault();
                onChange(cont.text);
                requestAnimationFrame(() => {
                  const ta = ref.current;
                  if (ta) ta.selectionStart = ta.selectionEnd = cont.caret;
                });
              } else if (e.ctrlKey || e.metaKey) {
                // Ctrl/Cmd+Enter no inserta salto por defecto: lo hacemos aquí.
                e.preventDefault();
                onChange(`${base.slice(0, start)}\n${base.slice(start)}`);
                requestAnimationFrame(() => {
                  const ta = ref.current;
                  if (ta) ta.selectionStart = ta.selectionEnd = start + 1;
                });
              }
              return;
            }

            // Enter a secas: siempre envía.
            e.preventDefault();
            submit(domValue);
          }}
          className="min-h-11 resize-none border-0 bg-transparent shadow-none focus-visible:ring-0"
        />

        <div className="flex items-center justify-between gap-2 px-1 pt-1">
          <div className="flex min-w-0 items-center gap-1">
            <input
              ref={fileInput}
              type="file"
              multiple
              hidden
              onChange={(e) => {
                const files = Array.from(e.target.files ?? []);
                if (files.length) onAddFiles(files);
                e.target.value = "";
              }}
            />
            <Button
              variant="ghost"
              size="icon"
              className="size-8 shrink-0 text-muted-foreground"
              onClick={() => fileInput.current?.click()}
              title="Adjuntar archivos"
            >
              <Paperclip className="size-4" />
            </Button>
            <ModelPicker sessionId={sessionId} current={model} provider={provider} compact />
            <ReasoningEffortPicker sessionId={sessionId} />
          </div>

          <div className="flex shrink-0 items-center gap-1">
            <button
              onClick={toggle}
              disabled={!supported}
              title={
                supported
                  ? listening
                    ? "Detener dictado"
                    : "Dictado por voz"
                  : "El dictado no está soportado en este sistema"
              }
              className={cn(
                "relative grid shrink-0 place-items-center rounded-md transition-all",
                listening
                  ? "size-8"
                  : "size-8 text-muted-foreground dashboard-hover hover:text-foreground",
                !supported && "opacity-40",
              )}
            >
              {listening ? <AudioBars active barCount={5} height={16} /> : <Mic className="size-4" />}
            </button>

            {sending ? (
              <Button
                size="icon"
                variant="secondary"
                className="size-8 shrink-0 rounded-full"
                onClick={onStop}
              >
                <Square className="size-3.5 fill-current" />
              </Button>
            ) : (
              <Button
                size="icon"
                className="size-8 shrink-0 rounded-full bg-violet text-white hover:bg-violet/90"
                onClick={() => submit()}
                disabled={!value.trim()}
              >
                <ArrowUp className="size-4" />
              </Button>
            )}
          </div>
        </div>
      </div>

      <p
        className={cn(
          "mt-2 text-center text-[0.7rem]",
          error || shownNotice ? "text-amber-500" : "text-muted-foreground",
        )}
      >
        {error ?? shownNotice ?? "El agente puede ejecutar herramientas. Revisa las acciones sensibles."}
      </p>
    </div>
  );
}
