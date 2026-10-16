/**
 * Viewport «Control de pantalla»: el screenshot que ve el agente con sus
 * acciones superpuestas EN VIVO (ripples de clic, cursor fantasma, keycaps,
 * trayectorias de drag y flechas de scroll), con tratamiento HUD (retícula,
 * scanline, esquinas de cámara).
 *
 * Las coordenadas llegan en el espacio de la IMAGEN del último frame (el
 * plugin computeruse mapea DPI/Retina internamente), así que el overlay se
 * posiciona en porcentajes: la escala del panel nunca desalinea las marcas.
 */
import { Check, ChevronDown, ChevronUp, Loader2, Monitor, MousePointer2, X } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import {
  lastPointerPosition,
  latestFrame,
  useComputerUse,
  type CuAction,
  type CuFrame,
} from "@/stores/computer-use";
import { cn } from "@/lib/utils";

/** Acciones puntuales que se quedan marcadas sobre el frame. */
const MARKED_KINDS = new Set(["click", "scroll", "drag"]);
/** Cuántos marcadores recientes se dibujan a la vez. */
const MAX_MARKERS = 10;

/** Porcentaje del frame (posiciona el overlay sin importar la escala). */
const pct = (v: number, total: number): string => `${(v / total) * 100}%`;

/** Esquinas de cámara (HUD) en los 4 vértices del frame. */
function HudCorners() {
  const corner = "pointer-events-none absolute size-4 border-violet-soft/70";
  return (
    <>
      <span className={cn(corner, "left-1.5 top-1.5 border-l-2 border-t-2")} />
      <span className={cn(corner, "right-1.5 top-1.5 border-r-2 border-t-2")} />
      <span className={cn(corner, "bottom-1.5 left-1.5 border-b-2 border-l-2")} />
      <span className={cn(corner, "bottom-1.5 right-1.5 border-b-2 border-r-2")} />
    </>
  );
}

/** Marcador persistente + ripple del clic más reciente. */
function ClickMarker({ action, frame, fresh }: { action: CuAction; frame: CuFrame; fresh: boolean }) {
  if (action.x == null || action.y == null) return null;
  const style = { left: pct(action.x, frame.width), top: pct(action.y, frame.height) };
  return (
    <>
      <span
        className="cu-marker-in pointer-events-none absolute size-2 rounded-full bg-violet-soft shadow-[0_0_10px_var(--violet)]"
        style={style}
      />
      {fresh && (
        <>
          <span
            className="cu-ripple pointer-events-none absolute size-14 rounded-full border-2 border-violet-soft"
            style={style}
          />
          <span
            className="cu-ripple-late pointer-events-none absolute size-14 rounded-full border border-violet-soft/60"
            style={style}
          />
        </>
      )}
    </>
  );
}

/** Trayectoria de un drag (línea con guion animado + flecha de destino). */
function DragPaths({ actions, frame }: { actions: CuAction[]; frame: CuFrame }) {
  const drags = actions.filter(
    (a) => a.kind === "drag" && a.x != null && a.y != null && a.x2 != null && a.y2 != null,
  );
  if (drags.length === 0) return null;
  return (
    <svg
      className="pointer-events-none absolute inset-0 size-full"
      viewBox={`0 0 ${frame.width} ${frame.height}`}
      preserveAspectRatio="none"
    >
      <defs>
        <linearGradient id="cu-drag-grad" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="var(--violet-soft)" stopOpacity="0.2" />
          <stop offset="1" stopColor="var(--violet-soft)" />
        </linearGradient>
      </defs>
      {drags.map((a) => (
        <g key={a.id}>
          <line
            x1={a.x}
            y1={a.y}
            x2={a.x2}
            y2={a.y2}
            stroke="url(#cu-drag-grad)"
            strokeWidth="3"
            strokeLinecap="round"
            className="cu-drag-path"
          />
          <circle cx={a.x2} cy={a.y2} r="7" fill="none" stroke="var(--violet-soft)" strokeWidth="2" />
        </g>
      ))}
    </svg>
  );
}

/** Flechas animadas en el punto del último scroll. */
function ScrollIndicator({ action, frame }: { action: CuAction; frame: CuFrame }) {
  if (action.x == null || action.y == null) return null;
  const down = (action.dy ?? 1) > 0;
  const Icon = down ? ChevronDown : ChevronUp;
  return (
    <span
      className="pointer-events-none absolute flex flex-col items-center text-violet-soft"
      style={{ left: pct(action.x, frame.width), top: pct(action.y, frame.height) }}
    >
      {[0, 1].map((i) => (
        <Icon
          key={i}
          className={cn("size-5 drop-shadow-[0_0_6px_var(--violet)]", down ? "cu-scroll-down" : "cu-scroll-up")}
          style={{ animationDelay: `${i * 0.18}s` }}
        />
      ))}
    </span>
  );
}

/** Keycaps flotantes del último `type`/`key`, junto al cursor. */
function KeycapToast({ action, point, frame }: { action: CuAction; point: { x: number; y: number } | null; frame: CuFrame }) {
  if (!point) return null;
  const keys = action.kind === "key" ? (action.keys ?? []) : [action.text ?? ""];
  return (
    <span
      className="cu-keycap-in pointer-events-none absolute flex -translate-x-1/2 gap-1"
      style={{ left: pct(point.x, frame.width), top: `calc(${pct(point.y, frame.height)} - 2.4rem)` }}
    >
      {keys.slice(0, 4).map((k, i) => (
        <kbd
          key={`${action.id}-${i}`}
          className="max-w-36 truncate rounded-md border border-violet-soft/60 bg-[var(--violet-deep)]/90 px-1.5 py-0.5 font-mono text-[0.62rem] text-violet-soft shadow-[0_0_12px_color-mix(in_srgb,var(--violet)_45%,transparent)]"
        >
          {k}
        </kbd>
      ))}
    </span>
  );
}

/** Cursor fantasma: se desliza entre acciones (transición CSS en left/top). */
function GhostCursor({ point, frame }: { point: { x: number; y: number }; frame: CuFrame }) {
  return (
    <span
      className="pointer-events-none absolute z-10 transition-all duration-500 ease-[cubic-bezier(0.22,1,0.36,1)]"
      style={{ left: pct(point.x, frame.width), top: pct(point.y, frame.height) }}
    >
      <span className="cu-cursor-halo absolute left-0 top-0 size-8 rounded-full bg-violet/40" />
      <MousePointer2 className="relative size-4 -translate-x-0.5 -translate-y-0.5 fill-violet-soft text-white drop-shadow-[0_0_6px_var(--violet)]" />
    </span>
  );
}

export function ComputerUseViewport() {
  const { t } = useTranslation("chat");
  const frames = useComputerUse((s) => s.frames);
  const actions = useComputerUse((s) => s.actions);
  const active = useComputerUse((s) => s.active);
  const closePanel = useComputerUse((s) => s.closePanel);

  const frame = latestFrame({ frames });
  // El overlay dibuja sobre el frame VIGENTE solo las acciones de ese frame
  // (las sin frameId — llegaron antes de la primera captura — también valen).
  const frameActions = frame
    ? actions.filter((a) => a.frameId == null || a.frameId === frame.id)
    : actions;
  const pointer = lastPointerPosition(frameActions);
  // Marcadores: los últimos N con coordenadas; el ripple solo en el más reciente.
  const markers = frameActions
    .filter((a) => MARKED_KINDS.has(a.kind) && a.kind !== "drag")
    .slice(-MAX_MARKERS);
  const lastMarker = markers[markers.length - 1];
  const lastAction = actions[actions.length - 1];
  const lastScroll = [...frameActions].reverse().find((a) => a.kind === "scroll" && a.status === "running");
  const lastKeys =
    lastAction && (lastAction.kind === "type" || lastAction.kind === "key") && frameActions.includes(lastAction)
      ? lastAction
      : undefined;
  const running = actions.some((a) => a.status === "running");

  return (
    <aside
      className="cu-panel-in flex w-[26rem] shrink-0 flex-col border-l border-dashboard-border-soft bg-[var(--phoson-surface-1)]"
      aria-label={t("computerUse.panel.title")}
    >
      {/* Cabecera */}
      <header className="flex items-center gap-2 border-b border-dashboard-border-soft px-3 py-2.5">
        <Monitor className="size-4 text-violet-soft" />
        <span className="text-sm font-medium">{t("computerUse.panel.title")}</span>
        {(active || running) && (
          <span className="flex items-center gap-1.5 rounded-full border border-violet-soft/40 bg-violet/10 px-2 py-0.5 text-[0.62rem] font-semibold tracking-widest text-violet-soft">
            <span className="cu-live-dot size-1.5 rounded-full bg-violet-soft" />
            {t("computerUse.panel.live")}
          </span>
        )}
        <span className="ml-auto text-[0.68rem] tabular-nums text-muted-foreground">
          {t("computerUse.panel.actions", { count: actions.length })}
        </span>
        <Button variant="ghost" size="icon" className="size-7" onClick={closePanel} title={t("computerUse.panel.close")}>
          <X className="size-4" />
        </Button>
      </header>

      {/* Frame con overlay */}
      <div className="flex-1 overflow-y-auto p-3">
        <div className="relative overflow-hidden rounded-lg border border-violet-soft/25 bg-black/40 shadow-[0_0_40px_color-mix(in_srgb,var(--violet)_18%,transparent)]">
          {frame ? (
            <div className="relative w-full" style={{ aspectRatio: `${frame.width} / ${frame.height}` }}>
              <img
                src={frame.dataUrl}
                alt={t("computerUse.panel.title")}
                draggable={false}
                className="absolute inset-0 size-full object-cover"
              />
              <div className="cu-grid-overlay pointer-events-none absolute inset-0" />
              {/* Scanline: solo mientras hay control activo */}
              {(active || running) && (
                <div
                  className="cu-scanline pointer-events-none absolute inset-x-0 h-16"
                  style={{
                    background:
                      "linear-gradient(to bottom, transparent, color-mix(in srgb, var(--violet-soft) 16%, transparent), transparent)",
                  }}
                />
              )}
              <HudCorners />
              <span className="pointer-events-none absolute left-3 top-2 font-mono text-[0.58rem] tracking-[0.2em] text-violet-soft/80">
                {t("computerUse.panel.vision")}
              </span>

              <DragPaths actions={frameActions} frame={frame} />
              {markers.map((a) => (
                <ClickMarker key={a.id} action={a} frame={frame} fresh={a === lastMarker} />
              ))}
              {lastScroll && <ScrollIndicator action={lastScroll} frame={frame} />}
              {lastKeys && <KeycapToast action={lastKeys} point={pointer} frame={frame} />}
              {pointer && <GhostCursor point={pointer} frame={frame} />}
            </div>
          ) : (
            <div className="grid aspect-[8/5] place-items-center">
              <div className="flex flex-col items-center gap-2 text-muted-foreground">
                <Monitor className="size-6 animate-pulse text-violet-soft/60" />
                <span className="text-xs">{t("computerUse.panel.waiting")}</span>
              </div>
            </div>
          )}
        </div>

        {/* Estado actual: última acción del agente */}
        {lastAction && (
          <div className="mt-3 flex items-center gap-2 rounded-lg border border-dashboard-border-soft bg-[var(--phoson-surface-2)] px-3 py-2 text-xs">
            {lastAction.status === "running" ? (
              <Loader2 className="size-3.5 animate-spin text-violet" />
            ) : (
              <Check className="size-3.5 text-success" />
            )}
            <span className="text-muted-foreground">
              {t(`tools.verbs.computer_${lastAction.kind}`)}
            </span>
            <span className="truncate font-mono text-[0.68rem] text-foreground/80">
              {lastAction.text ??
                (lastAction.keys?.join(" + ") ||
                  (lastAction.x != null ? `(${lastAction.x}, ${lastAction.y})` : ""))}
            </span>
          </div>
        )}
      </div>
    </aside>
  );
}
