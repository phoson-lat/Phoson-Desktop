/**
 * Store de swarms (zustand). Capa de persistencia: mantiene la lista guardada y
 * su escritura en `localStorage` (`lib/swarm.ts`). La sección trabaja sobre un
 * borrador propio y solo llama a `upsert` al guardar.
 */

import { create } from "zustand";

import {
  createAgent,
  loadSwarms,
  newSwarm,
  normalize,
  persistSwarms,
  uid,
  type Swarm,
} from "../lib/swarm";

interface SwarmsState {
  swarms: Swarm[];
  load: () => void;
  create: (name?: string) => Swarm;
  upsert: (swarm: Swarm) => void;
  remove: (id: string) => void;
  duplicate: (id: string) => Swarm | null;
}

export const useSwarms = create<SwarmsState>((set, get) => ({
  swarms: [],

  load: () => set({ swarms: loadSwarms() }),

  create: (name) => {
    const swarm = newSwarm(name);
    get().upsert(swarm);
    return swarm;
  },

  upsert: (swarm) => {
    const next = { ...normalize(swarm), updatedAt: Date.now() };
    const swarms = get().swarms;
    const index = swarms.findIndex((s) => s.id === next.id);
    const merged = index === -1 ? [next, ...swarms] : swarms.map((s) => (s.id === next.id ? next : s));
    persistSwarms(merged);
    set({ swarms: merged });
  },

  remove: (id) => {
    const merged = get().swarms.filter((s) => s.id !== id);
    persistSwarms(merged);
    set({ swarms: merged });
  },

  duplicate: (id) => {
    const source = get().swarms.find((s) => s.id === id);
    if (!source) return null;
    // Los ids de agente se reasignan: dos swarms con los mismos ids de nodo
    // confundirían al canvas al alternar entre ellos.
    const copy: Swarm = {
      ...source,
      id: uid("s"),
      name: `${source.name} (copia)`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      agents: source.agents.map((agent) => ({ ...createAgent(agent.position), ...agent, id: uid() })),
    };
    get().upsert(copy);
    return copy;
  },
}));
