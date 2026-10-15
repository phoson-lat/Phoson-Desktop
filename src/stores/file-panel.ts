/**
 * Store del panel lateral de archivos (`FilePanel`).
 *
 * El panel muestra una tool de escritura (`write_file`/`patch_file`) **en vivo**:
 * para que su estado (running → done, args, resultado) se actualice conforme
 * llegan los eventos del engine, aquí solo se guarda la *referencia* (sesión +
 * mensaje + tool) y el panel resuelve la tarjeta real desde `useSession` con un
 * selector. Sin `toolId` (el mensaje aún está «redactando archivo…») el panel
 * engancha con la última tool de escritura de ese mensaje cuando aparezca.
 *
 * `width` es el ancho elegido arrastrando el borde; se fija solo en memoria
 * (se re-clampa al viewport al montar).
 */
import { create } from "zustand";

export interface FilePanelTarget {
  sessionId: string;
  messageId: string;
  /** Tool concreta; si falta, el panel sigue a la tool de escritura del mensaje. */
  toolId?: string;
}

interface FilePanelState {
  target: FilePanelTarget | null;
  /** Ancho del panel en px (lo ajusta el asa de redimensión). */
  width: number;
  /** Abre (o repunta) el panel sobre una tool de escritura. */
  open: (target: FilePanelTarget) => void;
  close: () => void;
  setWidth: (width: number) => void;
}

export const useFilePanel = create<FilePanelState>((set) => ({
  target: null,
  width: 480,
  open: (target) => set({ target }),
  close: () => set({ target: null }),
  setWidth: (width) => set({ width }),
}));

/** Nombres de tools cuyo resultado es un archivo escrito/editado en disco. */
export const FILE_TOOLS = new Set(["write_file", "patch_file"]);
