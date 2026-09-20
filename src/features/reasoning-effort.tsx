import { Gauge } from "lucide-react";
import { useEffect, useState, type CSSProperties } from "react";

import { phoson } from "@/bridge/client";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";
import { isEditableTarget, isModalOpen, shortcutLabel } from "@/lib/platform";
import {
  REASONING_EFFORTS,
  effortColor,
  effortIndex,
  effortLabel,
} from "@/lib/reasoning";

/** Barras del indicador: se "suben" como un volumen/brillo, con el color del nivel. */
function LevelBars({
  index,
  color,
  className,
}: {
  index: number;
  color: string;
  className?: string;
}) {
  return (
    <span className={cn("flex items-end gap-[2px]", className)} aria-hidden>
      {REASONING_EFFORTS.map((_, i) => {
        const on = i <= index;
        return (
          <span
            key={i}
            className={cn(
              "w-[3px] rounded-full transition-all duration-200",
              !on && "bg-[var(--dashboard-border)]",
            )}
            style={{
              height: 5 + i * 2,
              background: on ? color : undefined,
              boxShadow: on ? `0 0 ${3 + i * 2}px ${color}` : "none",
            }}
          />
        );
      })}
    </span>
  );
}

/**
 * Medidor de "velocidad": la pista se **rellena** hasta el nivel activo y las
 * partículas cruzan en el **color del nivel**, más rápidas y densas cuanto más
 * alto es el esfuerzo.
 */
function SpeedParticles({ index, color }: { index: number; color: string }) {
  const level = Math.max(index, 0); // auto (-1) → nivel mínimo
  const count = 5 + level * 2; // 5 → 13 partículas
  const duration = 2.4 - level * 0.42; // 2.4s → ~0.72s
  const width = 6 + level * 5; // estela
  const travel = 180 + level * 45; // recorrido en px
  const glow = 3 + level * 3;
  /** % de relleno de la pista (auto = 0). */
  const fill = index < 0 ? 0 : ((index + 1) / REASONING_EFFORTS.length) * 100;

  return (
    <div className="relative mt-3 h-9 overflow-hidden rounded-md bg-[var(--phoson-surface-2)]">
      {/* Relleno por nivel */}
      {fill > 0 && (
        <div
          className="absolute inset-y-0 left-0 transition-[width] duration-300 ease-out"
          style={{
            width: `${fill}%`,
            background: `linear-gradient(90deg, ${color}12, ${color}3d)`,
          }}
        />
      )}
      {/* Borde del relleno, con glow */}
      {fill > 0 && (
        <div
          className="absolute inset-y-0 w-px transition-[left] duration-300 ease-out"
          style={{ left: `${fill}%`, background: color, boxShadow: `0 0 10px ${color}` }}
        />
      )}

      {Array.from({ length: count }).map((_, i) => (
        <span
          key={i}
          className="absolute h-[2px] rounded-full"
          style={
            {
              width,
              left: 0,
              top: `${22 + (i % 3) * 26}%`,
              background: color,
              "--particle-travel": `${travel}px`,
              animationName: "phoson-particle",
              animationDuration: `${duration.toFixed(2)}s`,
              animationTimingFunction: "linear",
              animationIterationCount: "infinite",
              animationDelay: `-${((i / count) * duration).toFixed(2)}s`,
              boxShadow: `0 0 ${glow}px ${color}`,
            } as CSSProperties
          }
        />
      ))}

      {/* Desvanecido en el borde derecho */}
      <span className="pointer-events-none absolute inset-y-0 right-0 w-12 bg-gradient-to-l from-[var(--phoson-surface-2)] to-transparent" />
    </div>
  );
}

interface ReasoningEffortProps {
  sessionId: string | null;
  className?: string;
}

/**
 * Esfuerzo de razonamiento como un control de brillo/volumen: relleno + barras
 * que se encienden, **color por nivel** (frío → caliente) y partículas que ganan
 * velocidad y densidad al subir.
 *
 * Lee/escribe `config.reasoning_effort`; el engine lo consulta en vivo durante
 * el run (`make_live_scheduler`), así que el cambio aplica sin reiniciar nada.
 */
export function ReasoningEffortPicker({ sessionId, className }: ReasoningEffortProps) {
  const [effort, setEffort] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!sessionId) return;
    phoson
      .getConfig(sessionId)
      .then((c) => setEffort(c.reasoningEffort))
      .catch(() => {})
      .finally(() => setReady(true));
  }, [sessionId]);

  // Atajo global Ctrl/⌘+E → abrir/cerrar el selector de esfuerzo.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) return;
      if (event.key.toLowerCase() !== "e" && event.code !== "KeyE") return;
      // No robar el foco a un campo editable, a un modal abierto, ni abrir el
      // selector cuando aún no hay sesión.
      if (isModalOpen() || isEditableTarget(event.target) || !sessionId) return;
      event.preventDefault();
      setOpen((o) => !o);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [sessionId]);

  const index = effortIndex(effort);
  const color = effortColor(effort);
  /** El deslizador siempre tiene una posición (auto se muestra en el mínimo). */
  const sliderIndex = index < 0 ? 0 : index;

  const apply = async (value: string | null) => {
    if (!sessionId) return;
    setEffort(value); // optimista
    try {
      await phoson.setConfig(sessionId, { reasoning_effort: value });
    } catch {
      /* silencioso: la UI ya reflejó el cambio */
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          className={cn(
            "flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors dashboard-hover hover:text-foreground",
            className,
          )}
          title={`Esfuerzo de razonamiento (${shortcutLabel("E")})`}
          disabled={!ready}
        >
          <Gauge className="size-3.5" style={{ color }} />
          <LevelBars index={index} color={color} />
          <span className="tabular-nums">{effortLabel(effort)}</span>
        </button>
      </PopoverTrigger>

      <PopoverContent align="start" side="top" className="w-64 p-0">
        <div
          className="effort-scope p-3"
          style={{ "--effort-color": color } as CSSProperties}
        >
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Razonamiento</span>
            <span style={{ color }}>{effortLabel(effort)}</span>
          </div>

          <SpeedParticles index={index} color={color} />

          <Slider
            className="mt-4"
            min={0}
            max={REASONING_EFFORTS.length - 1}
            step={1}
            value={[sliderIndex]}
            onValueChange={([v]) => void apply(REASONING_EFFORTS[v])}
          />

          <div className="mt-2 flex justify-between text-[0.6rem] text-muted-foreground">
            {REASONING_EFFORTS.map((e, i) => (
              <span key={e} className={cn(i <= sliderIndex && index >= 0 && "text-foreground/70")}>
                {e}
              </span>
            ))}
          </div>

          <button
            onClick={() => void apply(null)}
            className={cn(
              "mt-3 w-full rounded-md px-2 py-1.5 text-left text-[0.7rem] transition-colors dashboard-hover",
              index < 0 ? "text-violet" : "text-muted-foreground",
            )}
          >
            Auto — usa el perfil del modelo
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
