import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface Team {
  id: string;
  /** Nombre normalizado: también es el namespace del bus peers. */
  name: string;
}

export interface TeamAgent {
  id: string;
  teamId: string;
  /** Nombre único dentro del equipo, válido para peer_ask/peer_send. */
  name: string;
  role: string;
  workspace: string;
  /** Claves efímeras/persistidas de la sesión de chat asociada. */
  sessionKey?: string;
  engineId?: string;
}

interface TeamsState {
  teams: Team[];
  agents: TeamAgent[];
  activeTeamId: string;
  activeAgentId: string | null;
  createTeam: (name: string) => string;
  addAgent: (agent: Omit<TeamAgent, "id">) => string;
  updateAgent: (id: string, patch: Partial<TeamAgent>) => void;
  removeAgent: (id: string) => void;
  setActiveTeam: (id: string) => void;
  setActiveAgent: (id: string | null) => void;
}

const uid = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2, 12);

const DEFAULT_TEAM: Team = { id: "general", name: "general" };

/** Metadatos de Equipos; las conversaciones siguen en el storage del engine. */
export const useTeams = create<TeamsState>()(
  persist(
    (set) => ({
      teams: [DEFAULT_TEAM],
      agents: [],
      activeTeamId: DEFAULT_TEAM.id,
      activeAgentId: null,
      createTeam: (name) => {
        const id = uid();
        set((state) => ({
          teams: [...state.teams, { id, name }],
          activeTeamId: id,
          activeAgentId: null,
        }));
        return id;
      },
      addAgent: (agent) => {
        const id = uid();
        set((state) => ({
          agents: [...state.agents, { ...agent, id }],
          activeAgentId: id,
        }));
        return id;
      },
      updateAgent: (id, patch) =>
        set((state) => ({
          agents: state.agents.map((agent) => (agent.id === id ? { ...agent, ...patch } : agent)),
        })),
      removeAgent: (id) =>
        set((state) => ({
          agents: state.agents.filter((agent) => agent.id !== id),
          activeAgentId: state.activeAgentId === id ? null : state.activeAgentId,
        })),
      setActiveTeam: (id) =>
        set((state) => ({
          activeTeamId: id,
          activeAgentId: state.agents.find((agent) => agent.teamId === id)?.id ?? null,
        })),
      setActiveAgent: (id) => set({ activeAgentId: id }),
    }),
    {
      name: "phoson.teams",
      version: 1,
      partialize: (state) => ({
        teams: state.teams,
        agents: state.agents,
        activeTeamId: state.activeTeamId,
        activeAgentId: state.activeAgentId,
      }),
    },
  ),
);
