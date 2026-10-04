/**
 * Historial de **ejecuciones** de un swarm.
 *
 * Un swarm es una plantilla; cada vez que pulsas «Lanzar» se crea una
 * *ejecución*: guarda quién, con qué misión, cuándo y en qué sesión se lanzó.
 * Así el editor deja de ser «plantillas sin memoria» y se puede volver a la
 * conversación de cualquier lanzamiento anterior.
 *
 * El estado (en curso / completado / error) **no se persiste**: se deriva en
 * vivo de la sesión vinculada (`sending` + estado del último mensaje). Una vez
 * cerrada la app, y como la sesión sigue existiendo, esa derivación se mantiene.
 */

import { create } from "zustand";

import type { SwarmTopology } from "@/lib/swarm";

export interface SwarmRun {
  id: string;
  swarmId: string;
  name: string;
  mission: string;
  topology: SwarmTopology;
  agentCount: number;
  /** Sesión del engine a la que se envió el turno de lanzamiento. */
  sessionKey: string | null;
  startedAt: number;
}

const STORAGE_KEY = "phoson.swarm-runs.v1";
const MAX_RUNS = 50;

const uid = (): string => `run_${Math.random().toString(36).slice(2, 9)}${Date.now().toString(36).slice(-3)}`;

function loadRuns(): SwarmRun[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter(isRun) : [];
  } catch {
    return [];
  }
}

function persistRuns(runs: SwarmRun[]): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(runs));
  } catch {
    /* almacenamiento lleno o no disponible: el historial es prescindible */
  }
}

function isRun(value: unknown): value is SwarmRun {
  const r = value as Partial<SwarmRun>;
  return Boolean(r && typeof r.id === "string" && typeof r.startedAt === "number");
}

interface SwarmRunsState {
  runs: SwarmRun[];
  load: () => void;
  add: (run: Omit<SwarmRun, "id" | "startedAt">) => SwarmRun;
  remove: (id: string) => void;
  clear: () => void;
}

export const useSwarmRuns = create<SwarmRunsState>((set, get) => ({
  runs: [],

  load: () => set({ runs: loadRuns() }),

  add: (run) => {
    const created: SwarmRun = { ...run, id: uid(), startedAt: Date.now() };
    const runs = [created, ...get().runs].slice(0, MAX_RUNS);
    persistRuns(runs);
    set({ runs });
    return created;
  },

  remove: (id) => {
    const runs = get().runs.filter((r) => r.id !== id);
    persistRuns(runs);
    set({ runs });
  },

  clear: () => {
    persistRuns([]);
    set({ runs: [] });
  },
}));
