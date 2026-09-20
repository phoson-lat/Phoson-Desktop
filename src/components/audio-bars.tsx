import { useEffect, useRef } from "react";

import { cn } from "@/lib/utils";

interface AudioBarsProps {
  active: boolean;
  /** Nº de barras (LiveKit recomienda 5 para interfaces limpias). */
  barCount?: number;
  /** Altura máxima en px. */
  height?: number;
  /** Ancho de cada barra en px. */
  barWidth?: number;
  className?: string;
}

/**
 * Visualizador de voz minimalista: barras verticales centradas que siguen el
 * volumen. Inspirado en `AgentAudioVisualizerBar` de **LiveKit Agents UI**
 * (Apache-2.0) — su variante recomendada para interfaces limpias y discretas.
 *
 * Cada barra toma una banda del espectro (agudos → graves invertidos), con
 * suavizado temporal y normalización por pico para que la dinámica se vea bien
 * con cualquier entrada. Respeta `prefers-reduced-motion`.
 */
export function AudioBars({
  active,
  barCount = 5,
  height = 18,
  barWidth = 3,
  className,
}: AudioBarsProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    if (!active) return;
    const container = containerRef.current;
    if (!container) return;

    const reduced =
      typeof matchMedia !== "undefined" &&
      matchMedia("(prefers-reduced-motion: reduce)").matches;

    const bars = Array.from(container.children) as HTMLElement[];
    let analyser: AnalyserNode | null = null;
    let freq: Uint8Array | null = null;
    let raf: number | null = null;
    let disposed = false;
    const levels = new Float32Array(barCount);
    let phase = 0;

    // Bandas perceptivas (los graves, donde vive la voz, ocupan más rango).
    const edges = Array.from({ length: barCount + 1 }, (_, i) =>
      Math.pow(i / barCount, 1.8),
    );

    const draw = () => {
      if (disposed) return;
      if (analyser && freq) analyser.getByteFrequencyData(freq);
      if (!reduced) phase += 0.06;

      let peak = 0;
      for (let i = 0; i < barCount; i++) {
        let target: number;
        if (freq) {
          const span = Math.floor(freq.length * 0.68);
          const from = Math.floor(edges[i] * span);
          const to = Math.max(from + 1, Math.floor(edges[i + 1] * span));
          let sum = 0;
          for (let k = from; k < to; k++) sum += freq[k];
          target = sum / (to - from) / 255;
        } else {
          target = 0.25 + 0.3 * Math.abs(Math.sin(phase * 1.2 + i * 0.8));
        }
        levels[i] += (target - levels[i]) * (reduced ? 1 : 0.22);
        if (levels[i] > peak) peak = levels[i];
      }
      const scale = 1 / Math.max(peak, 0.2);

      bars.forEach((bar, i) => {
        // Las barras centrales son un poco más altas (silueta tipo voz).
        const envelope = 0.6 + 0.4 * Math.sin(((i + 0.5) / barCount) * Math.PI);
        const idle = 0.08 * Math.abs(Math.sin(phase * 1.5 + i));
        const norm = Math.min(1, levels[i] * scale + idle);
        const h = Math.max(3, norm * height * envelope);
        bar.style.height = `${h.toFixed(1)}px`;
        bar.style.opacity = `${(0.55 + norm * 0.45).toFixed(2)}`;
      });

      raf = requestAnimationFrame(draw);
    };

    const start = async () => {
      if (!reduced) {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          if (disposed) {
            stream.getTracks().forEach((t) => t.stop());
            return;
          }
          const Ctor =
            window.AudioContext ??
            (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
          const ctx = new Ctor();
          ctxRef.current = ctx;
          streamRef.current = stream;
          const source = ctx.createMediaStreamSource(stream);
          analyser = ctx.createAnalyser();
          analyser.fftSize = 256;
          analyser.smoothingTimeConstant = 0.8;
          source.connect(analyser);
          freq = new Uint8Array(analyser.frequencyBinCount);
        } catch {
          // Sin micrófono accesible: animación sintética igualmente.
        }
      }
      if (!disposed) draw();
    };

    void start();

    return () => {
      disposed = true;
      if (raf) cancelAnimationFrame(raf);
      streamRef.current?.getTracks().forEach((t) => t.stop());
      void ctxRef.current?.close();
      streamRef.current = null;
      ctxRef.current = null;
    };
  }, [active, barCount, height]);

  if (!active) return null;

  return (
    <div
      ref={containerRef}
      aria-hidden
      className={cn("flex items-center justify-center gap-[3px]", className)}
      style={{ height }}
    >
      {Array.from({ length: barCount }).map((_, i) => (
        <span
          key={i}
          className="rounded-full bg-violet transition-[height,opacity] duration-75 ease-out"
          style={{ width: barWidth, height: 3, opacity: 0.6 }}
        />
      ))}
    </div>
  );
}
