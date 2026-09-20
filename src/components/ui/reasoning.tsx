"use client";

/**
 * `Reasoning` — bloque de razonamiento del modelo (estilo "thinking").
 *
 * Adaptado del patrón de **Vercel AI Elements** (`Reasoning`) y **shadcn.io AI
 * Reasoning**: un colapsable que
 *   - se **abre solo** al empezar a pensar y se **cierra solo** al terminar,
 *   - muestra un **barrido (shimmer)** y "<Pensando…" mientras llega texto,
 *   - al acabar, "Razonó durante X s" (duración medida en cliente),
 *   - y deja reabrirlo a mano para leer el razonamiento completo.
 *
 * Construido sobre el primitivo Radix `Collapsible` que ya usa el design system.
 */

import { Brain, ChevronDown } from "lucide-react";
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";

import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { MarkdownRenderer } from "@/components/ui/markdown-renderer";
import { cn } from "@/lib/utils";

/** Barrido de brillo sobre el texto (reutiliza el keyframe global). */
export const shimmerTextStyle: CSSProperties = {
  backgroundImage:
    "linear-gradient(90deg, var(--muted-foreground) 0%, var(--foreground) 50%, var(--muted-foreground) 100%)",
  backgroundSize: "200% 100%",
  backgroundClip: "text",
  WebkitBackgroundClip: "text",
  color: "transparent",
  animation: "phoson-shimmer 1.6s linear infinite",
};

interface ReasoningContextValue {
  isStreaming: boolean;
  isOpen: boolean;
  setOpen: (open: boolean) => void;
  /** Segundos de razonamiento medidos, si se conocen. */
  duration?: number;
}

const ReasoningContext = createContext<ReasoningContextValue | null>(null);

export function useReasoning(): ReasoningContextValue {
  const ctx = useContext(ReasoningContext);
  if (!ctx) throw new Error("useReasoning debe usarse dentro de <Reasoning>");
  return ctx;
}

const formatDuration = (seconds: number): string => {
  if (seconds < 1) return "menos de 1 s";
  if (seconds < 60) return `${Math.round(seconds)} s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes} min ${Math.round(seconds % 60)} s`;
};

interface ReasoningProps {
  /** El razonamiento sigue llegando. */
  isStreaming?: boolean;
  /** Duración conocida (p. ej. desde el historial); si falta, se mide. */
  duration?: number;
  defaultOpen?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  className?: string;
  children: ReactNode;
}

export function Reasoning({
  isStreaming = false,
  duration,
  defaultOpen = false,
  open: openProp,
  onOpenChange,
  className,
  children,
}: ReasoningProps) {
  const [open, setOpen] = useState(openProp ?? defaultOpen);
  const [measured, setMeasured] = useState<number | undefined>(duration);
  const startedAt = useRef<number | null>(null);
  const wasStreaming = useRef(false);
  /** Solo cerramos solos si fuimos nosotros quienes abrimos. */
  const autoOpened = useRef(false);

  useEffect(() => {
    if (openProp !== undefined) setOpen(openProp);
  }, [openProp]);

  // Duración: cronometra entre el primer y el último token de razonamiento.
  useEffect(() => {
    if (duration !== undefined) {
      setMeasured(duration);
      return;
    }
    if (isStreaming) {
      startedAt.current ??= Date.now();
      setMeasured(undefined);
    } else if (startedAt.current !== null) {
      setMeasured((Date.now() - startedAt.current) / 1000);
      startedAt.current = null;
    }
  }, [isStreaming, duration]);

  // Auto-apertura al empezar; auto-cierre (con retardo) al acabar.
  useEffect(() => {
    if (isStreaming) {
      if (!wasStreaming.current) {
        wasStreaming.current = true;
        autoOpened.current = true;
        setOpen(true);
      }
      return;
    }
    if (wasStreaming.current) {
      wasStreaming.current = false;
      const timer = setTimeout(() => {
        if (autoOpened.current) setOpen(false);
      }, 800);
      return () => clearTimeout(timer);
    }
  }, [isStreaming]);

  const handleOpenChange = (next: boolean) => {
    autoOpened.current = false; // intervención manual: respétala
    setOpen(next);
    onOpenChange?.(next);
  };

  return (
    <ReasoningContext.Provider value={{ isStreaming, isOpen: open, setOpen, duration: measured }}>
      <Collapsible
        open={open}
        onOpenChange={handleOpenChange}
        className={cn("w-full", className)}
      >
        {children}
      </Collapsible>
    </ReasoningContext.Provider>
  );
}

export function ReasoningTrigger({ className }: { className?: string }) {
  const { isStreaming, isOpen, duration } = useReasoning();
  const done = !isStreaming && duration != null;

  return (
    <CollapsibleTrigger asChild>
      <button
        type="button"
        className={cn(
          "group flex items-center gap-2 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors dashboard-hover hover:text-foreground",
          className,
        )}
      >
        <Brain
          className={cn(
            "size-3.5 shrink-0 text-violet",
            isStreaming && "animate-pulse",
            !isStreaming && "text-violet/60",
          )}
        />
        <span className="flex items-center font-medium">
          {isStreaming ? (
            <>
              <span style={shimmerTextStyle}>Pensando</span>
              <span className="phoson-dots ml-0.5 flex text-violet" aria-hidden>
                <span>.</span>
                <span>.</span>
                <span>.</span>
              </span>
            </>
          ) : (
            <>Razonó durante {done ? formatDuration(duration!) : "un momento"}</>
          )}
        </span>
        <ChevronDown
          className={cn("size-3 shrink-0 transition-transform", isOpen && "rotate-180")}
        />
      </button>
    </CollapsibleTrigger>
  );
}

export function ReasoningContent({
  children,
  className,
}: {
  children: string;
  className?: string;
}) {
  const { isStreaming, isOpen } = useReasoning();
  const ref = useRef<HTMLDivElement>(null);

  // Mientras "piensa", sigue la última línea (si no, ves el principio del texto).
  useEffect(() => {
    const el = ref.current;
    if (!el || !isStreaming || !isOpen) return;
    el.scrollTop = el.scrollHeight;
  }, [children, isStreaming, isOpen]);

  return (
    <CollapsibleContent>
      <div
        ref={ref}
        className={cn(
          "mt-1 max-h-72 overflow-auto rounded-lg border border-[var(--dashboard-border)] bg-[var(--phoson-surface-2)]/60 px-3 py-2",
          className,
        )}
      >
        <MarkdownRenderer
          content={children}
          streaming={isStreaming}
          className="text-[0.82rem] text-muted-foreground"
        />
      </div>
    </CollapsibleContent>
  );
}
