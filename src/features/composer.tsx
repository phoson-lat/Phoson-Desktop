import { ArrowUp, Square, Paperclip } from "lucide-react";
import { useEffect, useRef } from "react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ModelPicker } from "@/features/model-picker";
import { ReasoningEffortPicker } from "@/features/reasoning-effort";
import { cn } from "@/lib/utils";

interface ComposerProps {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  onStop: () => void;
  sending: boolean;
  disabled?: boolean;
  /** Contexto para los controles del composer (modelo / razonamiento). */
  sessionId: string | null;
  model?: string;
  provider?: string;
}

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
}: ComposerProps) {
  const ref = useRef<HTMLTextAreaElement>(null);

  // Auto-grow
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [value]);

  return (
    <div className="shrink-0 px-4 pb-4">
      <div
        className={cn(
          "dashboard-panel relative mx-auto max-w-3xl overflow-hidden rounded-2xl border p-2",
          sending && "phoson-sending",
        )}
      >
        <Textarea
          ref={ref}
          value={value}
          disabled={disabled}
          rows={1}
          placeholder="Escribe un mensaje…  (Enter para enviar, Shift+Enter salto de línea)"
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              onSend();
            }
          }}
          className="min-h-11 resize-none border-0 bg-transparent shadow-none focus-visible:ring-0"
        />
        <div className="flex items-center justify-between gap-2 px-1 pt-1">
          <div className="flex min-w-0 items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="size-8 shrink-0 text-muted-foreground"
              disabled
            >
              <Paperclip className="size-4" />
            </Button>
            <ModelPicker
              sessionId={sessionId}
              current={model}
              provider={provider}
              compact
            />
            <ReasoningEffortPicker sessionId={sessionId} />
          </div>
          {sending ? (
            <Button size="icon" variant="secondary" className="size-8 shrink-0 rounded-full" onClick={onStop}>
              <Square className="size-3.5 fill-current" />
            </Button>
          ) : (
            <Button
              size="icon"
              className="size-8 shrink-0 rounded-full bg-violet text-white hover:bg-violet/90"
              onClick={onSend}
              disabled={!value.trim()}
            >
              <ArrowUp className="size-4" />
            </Button>
          )}
        </div>
      </div>
      <p className="mt-2 text-center text-[0.7rem] text-muted-foreground">
        El agente puede ejecutar herramientas. Revisa las acciones sensibles.
      </p>
    </div>
  );
}
