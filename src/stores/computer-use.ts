/**
 * Store del «control de pantalla» (plugin computeruse).
 *
 * Alimenta el viewport futurista (panel con el screenshot vivo y las acciones
 * del agente superpuestas) y las action chips del thread. Lo llena
 * `stores/session.ts` al interceptar los eventos de tools `computer_*`:
 *
 *  - `AgentToolStartEvent` de `computer_move/click/drag/scroll/type/key/wait`
 *    → `startAction` (coordenadas en el ESPACIO DE LA IMAGEN del último
 *    screenshot, garantía del plugin: se dibujan 1:1 sobre el frame).
 *  - `AgentToolDoneEvent` → `finishAction`.
 *  - Notificación `computer.frame` → `pushFrame` (el screenshot).
 *
 * HOY los frames llegan solo del MockBridge (demo «computer»); el sidecar real
 * emitirá `computer.frame` cuando resuelva la ruta del PNG que el plugin
 * guarda en `$TMPDIR/computer-screenshot/frame-NNNNN.png` (trabajo pendiente
 * de bridge, marcado como tal en client.ts).
 */
import { create } from "zustand";

/** Tipos de acción de input que el overlay sabe dibujar. */
export type CuActionKind = "move" | "click" | "drag" | "scroll" | "type" | "key" | "wait";

/** Tool del plugin computeruse → tipo de acción para el overlay/chip. */
export const CU_TOOL_KIND: Record<string, CuActionKind> = {
  computer_move: "move",
  computer_click: "click",
  computer_drag: "drag",
  computer_scroll: "scroll",
  computer_type: "type",
  computer_key: "key",
  computer_wait: "wait",
};

/** ¿Tool del plugin computeruse? (incluye `computer_screenshot`, solo lectura). */
export const isComputerTool = (name: string): boolean => name.startsWith("computer_");

export interface CuFrame {
  id: string;
  /** Imagen lista para <img>/background (data URL en el mock). */
  dataUrl: string;
  /** Tamaño del frame: el espacio de coordenadas de las acciones. */
  width: number;
  height: number;
  ts: number;
}

export interface CuAction {
  id: string;
  kind: CuActionKind;
  /** Punto (y destino, en drags) en coordenadas del frame. */
  x?: number;
  y?: number;
  x2?: number;
  y2?: number;
  button?: string;
  text?: string;
  keys?: string[];
  /** Scroll: desplazamiento vertical pedido (signo = dirección). */
  dy?: number;
  /**
   * Frame vigente cuando arrancó la acción: el overlay solo dibuja sobre un
   * frame las acciones de ESE frame, y las chips recortan la captura que el
   * agente veía al actuar (no la última, que puede ser otra pantalla).
   */
  frameId?: string;
  status: "running" | "done" | "error";
  ts: number;
}

/** Acciones conservadas (suficiente para overlays y chips; se poda lo viejo). */
const MAX_ACTIONS = 120;
/** Frames conservados (el viewport usa el último). */
const MAX_FRAMES = 12;

interface ComputerUseState {
  /** Hay una sesión de control en curso (chip ambiental + glow de ventana). */
  active: boolean;
  frames: CuFrame[];
  actions: CuAction[];
  panelOpen: boolean;
  /** El usuario cerró el panel a mano: no reabrirlo solo con cada frame. */
  dismissed: boolean;
  startAction: (action: CuAction) => void;
  finishAction: (id: string, ok: boolean) => void;
  pushFrame: (frame: CuFrame) => void;
  setActive: (active: boolean) => void;
  openPanel: () => void;
  closePanel: () => void;
  /** Limpia la sesión de control (cambio de sesión de chat, nueva demo…). */
  reset: () => void;
}

export const useComputerUse = create<ComputerUseState>((set) => ({
  active: false,
  frames: [],
  actions: [],
  panelOpen: false,
  dismissed: false,
  startAction: (action) =>
    set((s) => ({
      active: true,
      actions: [
        ...s.actions,
        { ...action, frameId: action.frameId ?? s.frames[s.frames.length - 1]?.id },
      ].slice(-MAX_ACTIONS),
    })),
  finishAction: (id, ok) =>
    set((s) => ({
      actions: s.actions.map((a) =>
        a.id === id ? { ...a, status: ok ? ("done" as const) : ("error" as const) } : a,
      ),
    })),
  pushFrame: (frame) =>
    set((s) => ({
      active: true,
      frames: [...s.frames, frame].slice(-MAX_FRAMES),
      // Auto-apertura solo en el primer frame (o si no se cerró a mano).
      panelOpen: s.dismissed ? s.panelOpen : true,
    })),
  setActive: (active) => set({ active }),
  openPanel: () => set({ panelOpen: true, dismissed: false }),
  closePanel: () => set({ panelOpen: false, dismissed: true }),
  reset: () => set({ active: false, frames: [], actions: [], panelOpen: false, dismissed: false }),
}));

/** Último frame recibido (el lienzo del viewport), o `null` si aún no hay. */
export const latestFrame = (s: { frames: CuFrame[] }): CuFrame | null =>
  s.frames.length > 0 ? s.frames[s.frames.length - 1] : null;

/** Última posición conocida del puntero (para el cursor fantasma y los keycaps). */
export const lastPointerPosition = (actions: CuAction[]): { x: number; y: number } | null => {
  for (let i = actions.length - 1; i >= 0; i--) {
    const a = actions[i];
    if (a.kind === "drag" && a.x2 != null && a.y2 != null) return { x: a.x2, y: a.y2 };
    if (a.x != null && a.y != null) return { x: a.x, y: a.y };
  }
  return null;
};
