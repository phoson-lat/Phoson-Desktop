import {
  ChevronDown,
  Columns2,
  FolderOpen,
  Loader2,
  Plus,
  Trash2,
  Users,
} from "lucide-react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { isTauri, phoson } from "@/bridge/client";
import type { PeerPresence } from "@/bridge/protocol";
import { TeamChatPane } from "@/features/team-chat-pane";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { loadDrafts, saveDrafts } from "@/lib/drafts";
import { addAgentToSplit, normalizePeerName, PEER_NAME_PATTERN } from "@/lib/teams";
import { cn } from "@/lib/utils";
import { useSession } from "@/stores/session";
import { useTeams, type TeamAgent } from "@/stores/teams";

interface TeamsViewProps {
  currentWorkspace: string;
}

const basename = (path: string) => path.split(/[\\/]/).filter(Boolean).pop() ?? path;

export function TeamsView({ currentWorkspace }: TeamsViewProps) {
  const { t } = useTranslation(["teams", "common", "chrome"]);
  const {
    teams,
    agents,
    activeTeamId,
    activeAgentId,
    createTeam,
    addAgent,
    updateAgent,
    removeAgent,
    setActiveTeam,
    setActiveAgent,
  } = useTeams();
  const sessions = useSession((state) => state.sessions);
  const closeSession = useSession((state) => state.closeSession);

  const activeTeam = teams.find((team) => team.id === activeTeamId) ?? teams[0];
  const teamAgents = useMemo(
    () => agents.filter((agent) => agent.teamId === activeTeam?.id),
    [agents, activeTeam?.id],
  );
  const activeAgent = teamAgents.find((agent) => agent.id === activeAgentId) ?? null;
  const [presence, setPresence] = useState<PeerPresence[]>([]);
  const [connectingId, setConnectingId] = useState<string | null>(null);
  const [creatingAgent, setCreatingAgent] = useState(false);
  const [agentDialog, setAgentDialog] = useState(false);
  const [teamDialog, setTeamDialog] = useState(false);
  const [teamName, setTeamName] = useState("");
  const [agentName, setAgentName] = useState("");
  const [agentRole, setAgentRole] = useState("");
  const [agentWorkspace, setAgentWorkspace] = useState("");
  const [agentPickerOpen, setAgentPickerOpen] = useState(false);
  const [splitAgentIds, setSplitAgentIds] = useState<string[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>(loadDrafts);
  /** Invalida conexiones antiguas al cambiar rápido de agente o equipo. */
  const connectionSeq = useRef(0);

  const setDraftFor = (key: string | undefined, text: string) => {
    if (key) setDrafts((current) => ({ ...current, [key]: text }));
  };
  useEffect(() => saveDrafts(drafts), [drafts]);

  const refreshPresence = useCallback(async () => {
    if (!activeTeam) return;
    try {
      const result = await phoson.peersList(activeTeam.name, currentWorkspace || null);
      setPresence(result.peers);
    } catch {
      // La metadata local sigue disponible aunque falle el directorio de peers.
    }
  }, [activeTeam, currentWorkspace]);

  useEffect(() => {
    setPresence([]);
    void refreshPresence();
    const timer = setInterval(() => void refreshPresence(), 5000);
    return () => clearInterval(timer);
  }, [refreshPresence]);

  // Los ids del engine aparecen al construir el primer turno. Guardarlos permite
  // reabrir la conversación del agente tras reiniciar la app.
  useEffect(() => {
    for (const agent of agents) {
      const key = agent.sessionKey;
      const engineId = key ? sessions[key]?.engineId : undefined;
      if (engineId && engineId !== agent.engineId) updateAgent(agent.id, { engineId });
    }
  }, [agents, sessions, updateAgent]);

  const ensureAgent = useCallback(
    async (agent: TeamAgent, sequence: number) => {
      if (!activeTeam) return null;
      const isCurrent = () =>
        connectionSeq.current === sequence && useTeams.getState().activeAgentId === agent.id;
      const restoreCurrentSelection = () => {
        const teams = useTeams.getState();
        const selected = teams.agents.find((item) => item.id === teams.activeAgentId);
        if (selected?.sessionKey && useSession.getState().sessions[selected.sessionKey]) {
          useSession.getState().setActive(selected.sessionKey);
        }
      };
      setConnectingId(agent.id);
      try {
        const state = useSession.getState();
        const peer = { name: agent.name, team: activeTeam.name };
        let key = agent.sessionKey;
        let existing = key ? state.sessions[key] : undefined;
        if (!existing && agent.engineId) {
          // La recuperación del sidecar pudo cambiar la clave efímera.
          const found = Object.entries(state.sessions).find(
            ([, candidate]) => candidate.engineId === agent.engineId && candidate.peer?.name === agent.name,
          );
          if (found) {
            key = found[0];
            existing = found[1];
          }
        }
        if (!existing) {
          key = agent.engineId
            ? await state.openSession(agent.engineId, agent.workspace, peer)
            : await state.newSession(agent.workspace || currentWorkspace, peer);
          updateAgent(agent.id, { sessionKey: key, workspace: agent.workspace || currentWorkspace });
        }
        if (!key) return null;
        // new/openSession activa su resultado dentro del store. Si ya no es la
        // selección vigente, deshacemos ese efecto antes de seguir.
        if (!isCurrent()) {
          restoreCurrentSelection();
          return null;
        }
        if (agent.sessionKey !== key) updateAgent(agent.id, { sessionKey: key });
        useSession.getState().setActive(key);
        await phoson.peersStart(key);
        if (!isCurrent()) {
          restoreCurrentSelection();
          return null;
        }
        await refreshPresence();
        return key;
      } catch (error) {
        if (isCurrent()) {
          toast.error(t("agent.connectFailed", { name: agent.name }), { description: String(error) });
        }
        return null;
      } finally {
        if (connectionSeq.current === sequence) setConnectingId(null);
      }
    },
    [activeTeam, currentWorkspace, refreshPresence, t, updateAgent],
  );

  const selectAgent = (agent: TeamAgent) => {
    const sequence = ++connectionSeq.current;
    setSplitAgentIds([]);
    setAgentPickerOpen(false);
    setActiveAgent(agent.id);
    void ensureAgent(agent, sequence);
  };

  const openAgentDialog = () => {
    setAgentWorkspace(currentWorkspace);
    setAgentName("");
    setAgentRole("");
    setAgentDialog(true);
  };

  const submitTeam = () => {
    const name = normalizePeerName(teamName);
    if (!PEER_NAME_PATTERN.test(name)) {
      toast.error(t("team.invalidName"));
      return;
    }
    if (teams.some((team) => team.name === name)) {
      toast.error(t("team.duplicate"));
      return;
    }
    createTeam(name);
    setTeamDialog(false);
    setTeamName("");
  };

  const submitAgent = async () => {
    if (!activeTeam) return;
    const name = normalizePeerName(agentName);
    const workspace = agentWorkspace.trim() || currentWorkspace;
    if (!PEER_NAME_PATTERN.test(name)) {
      toast.error(t("agent.invalidName"));
      return;
    }
    if (agents.some((agent) => agent.teamId === activeTeam.id && agent.name === name)) {
      toast.error(t("agent.duplicate"));
      return;
    }
    if (!workspace) {
      toast.error(t("agent.workspaceRequired"));
      return;
    }
    setCreatingAgent(true);
    let key: string | null = null;
    try {
      key = await useSession.getState().newSession(workspace, { name, team: activeTeam.name });
      // Construir ahora valida que el nombre no esté reclamado por otro proceso.
      await phoson.peersStart(key);
      const id = addAgent({
        teamId: activeTeam.id,
        name,
        role: agentRole.trim(),
        workspace,
        sessionKey: key,
      });
      setSplitAgentIds([]);
      setActiveAgent(id);
      setAgentDialog(false);
      await refreshPresence();
      toast.success(t("agent.created", { name }));
    } catch (error) {
      if (key) await useSession.getState().closeSession(key).catch(() => {});
      toast.error(t("agent.createFailed"), { description: String(error) });
    } finally {
      setCreatingAgent(false);
    }
  };

  const removeTeamAgent = async (agent: TeamAgent) => {
    const key = agent.sessionKey;
    if (key && sessions[key]) await closeSession(key).catch(() => {});
    setSplitAgentIds((current) => current.filter((id) => id !== agent.id));
    removeAgent(agent.id);
    await refreshPresence();
  };

  const openInSplit = (agent: TeamAgent) => {
    const next = addAgentToSplit(splitAgentIds, activeAgent?.id ?? null, agent.id);
    if (!next) {
      toast.warning(t("split.limit"));
      return;
    }
    setSplitAgentIds(next);
    setAgentPickerOpen(false);
    const sequence = ++connectionSeq.current;
    setActiveAgent(agent.id);
    void ensureAgent(agent, sequence);
  };

  const closeSplit = (agentId: string) => {
    const remaining = splitAgentIds.filter((id) => id !== agentId);
    setSplitAgentIds(remaining);
    if (activeAgentId === agentId && remaining.length > 0) {
      setActiveAgent(remaining[remaining.length - 1]);
    }
  };

  if (!activeTeam) return null;
  const onlineAgents = teamAgents.filter(
    (agent) => agent.id === activeAgent?.id || presence.some((peer) => peer.name === agent.name && peer.live),
  );
  const bubbleSource = onlineAgents.length > 0 ? onlineAgents : teamAgents;
  const bubbleAgents = bubbleSource.slice(0, 4);
  const hiddenAgents = Math.max(0, bubbleSource.length - bubbleAgents.length);
  const splitAgents = splitAgentIds
    .map((id) => teamAgents.find((agent) => agent.id === id))
    .filter((agent): agent is TeamAgent => Boolean(agent));
  const visibleAgents = splitAgents.length > 0 ? splitAgents : activeAgent ? [activeAgent] : [];
  const splitMode = splitAgents.length > 0;

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col">
      {/* Header nativo de Equipos: contexto, selector y acciones principales. */}
      <header data-window-drag className="app-window-header flex shrink-0 items-center gap-3 border-b border-dashboard-border-soft px-4 py-2.5">
        <div className="grid size-8 shrink-0 place-items-center rounded-lg bg-violet/10 text-violet">
          <Users className="size-4" />
        </div>
        <div className="hidden shrink-0 xl:block">
          <div className="text-sm font-medium">{t("teams")}</div>
          <div className="text-[0.65rem] text-muted-foreground">{t("memberCount", { count: teamAgents.length })}</div>
        </div>
        <select
          aria-label={t("teams")}
          value={activeTeam.id}
          onChange={(event) => {
            setSplitAgentIds([]);
            setActiveTeam(event.target.value);
          }}
          className="border-input bg-background h-8 min-w-0 max-w-48 flex-1 rounded-lg border px-2.5 text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-violet/40 sm:ml-2 sm:flex-none"
        >
          {teams.map((team) => (
            <option key={team.id} value={team.id}>{team.name}</option>
          ))}
        </select>
        <Button variant="ghost" size="icon" className="size-8 shrink-0" title={t("team.new")} onClick={() => setTeamDialog(true)}>
          <Plus className="size-4" />
        </Button>

        {teamAgents.length > 0 && (
          <Popover open={agentPickerOpen} onOpenChange={setAgentPickerOpen}>
            <PopoverTrigger asChild>
              <button
                title={t("agent.switch")}
                aria-label={t("agent.switch")}
                className="flex shrink-0 items-center gap-1.5 rounded-full px-1.5 py-1 transition-colors dashboard-hover"
              >
                <span className="flex -space-x-2">
                  {bubbleAgents.map((agent) => {
                    const peer = presence.find((item) => item.name === agent.name);
                    const running = agent.sessionKey ? sessions[agent.sessionKey]?.sending : false;
                    return (
                      <span
                        key={agent.id}
                        className={cn(
                          "relative grid size-8 place-items-center rounded-full border-2 border-[var(--background)] bg-[var(--phoson-surface-2)] text-[0.65rem] font-semibold uppercase text-muted-foreground",
                          agent.id === activeAgent?.id && "bg-violet/15 text-violet ring-1 ring-violet/50",
                        )}
                      >
                        {agent.name.slice(0, 2)}
                        <span
                          className={cn(
                            "absolute bottom-0 right-0 size-2 rounded-full border border-[var(--background)]",
                            peer?.live ? "bg-emerald-500" : "bg-muted-foreground/50",
                          )}
                        />
                        {(running || connectingId === agent.id) && (
                          <Loader2 className="absolute -left-1 -top-1 size-3 animate-spin rounded-full bg-[var(--background)] text-violet" />
                        )}
                      </span>
                    );
                  })}
                </span>
                {hiddenAgents > 0 && <span className="text-[0.65rem] text-muted-foreground">+{hiddenAgents}</span>}
                <ChevronDown className="size-3 text-muted-foreground" />
              </button>
            </PopoverTrigger>
            <PopoverContent align="end" className="dashboard-panel-strong w-80 rounded-xl p-2">
              <div className="flex items-center justify-between px-2 pb-2 pt-1">
                <span className="text-xs font-medium">{t("agents")}</span>
                <span className="text-[0.65rem] text-muted-foreground">{activeTeam.name}</span>
              </div>
              <div className="max-h-80 space-y-1 overflow-y-auto">
                {teamAgents.map((agent) => {
                  const peer = presence.find((item) => item.name === agent.name);
                  const running = agent.sessionKey ? sessions[agent.sessionKey]?.sending : false;
                  return (
                    <div
                      key={agent.id}
                      className={cn(
                        "group flex items-center rounded-lg transition-colors",
                        agent.id === activeAgent?.id ? "bg-violet/10" : "dashboard-hover",
                      )}
                    >
                      <button
                        onClick={() => selectAgent(agent)}
                        className="flex min-w-0 flex-1 items-center gap-3 px-2.5 py-2 text-left"
                      >
                        <span className="relative grid size-9 shrink-0 place-items-center rounded-full bg-violet/10 text-[0.68rem] font-semibold uppercase text-violet">
                          {agent.name.slice(0, 2)}
                          <span
                            className={cn(
                              "absolute bottom-0 right-0 size-2.5 rounded-full border-2 border-[var(--background)]",
                              peer?.live ? "bg-emerald-500" : "bg-muted-foreground/40",
                            )}
                          />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-1.5 truncate text-xs font-medium">
                            {agent.name}
                            {(running || connectingId === agent.id) && <Loader2 className="size-3 animate-spin text-violet" />}
                          </span>
                          <span className="block truncate text-[0.65rem] text-muted-foreground">
                            {agent.role || basename(agent.workspace)}
                          </span>
                        </span>
                        {agent.id === activeAgent?.id && <span className="size-1.5 rounded-full bg-violet" />}
                      </button>
                      <button
                        title={t("split.open", { name: agent.name })}
                        aria-label={t("split.open", { name: agent.name })}
                        onClick={() => openInSplit(agent)}
                        className="grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground opacity-0 transition-opacity hover:text-violet focus-visible:opacity-100 group-hover:opacity-70"
                      >
                        <Columns2 className="size-3.5" />
                      </button>
                      <button
                        title={t("agent.remove")}
                        aria-label={t("agent.remove")}
                        onClick={() => void removeTeamAgent(agent)}
                        className="mr-1.5 grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground opacity-0 transition-opacity hover:text-destructive focus-visible:opacity-100 group-hover:opacity-70"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </div>
                  );
                })}
              </div>
            </PopoverContent>
          </Popover>
        )}
        <div className="flex-1" />
        <Button variant="outline" size="sm" onClick={openAgentDialog}>
          <Plus className="size-3.5" /> {t("agent.new")}
        </Button>
      </header>

      {/* Una conversación o una cuadrícula de hasta cuatro panes independientes. */}
      {visibleAgents.length > 0 ? (
        <main
          className={cn(
            "grid min-h-0 min-w-0 flex-1",
            visibleAgents.length > 1 && "grid-cols-2",
            visibleAgents.length === 2 && "grid-rows-1",
            visibleAgents.length > 2 && "grid-rows-2",
          )}
        >
          {visibleAgents.map((agent) => (
            <div
              key={agent.id}
              className={cn(
                "h-full min-h-0 min-w-0",
                splitMode && "border-[0.5px] border-dashboard-border-soft",
              )}
            >
              <TeamChatPane
                agent={agent}
                teamName={activeTeam.name}
                teamAgents={teamAgents}
                draft={agent.sessionKey ? (drafts[agent.sessionKey] ?? "") : ""}
                onDraftChange={(text) => setDraftFor(agent.sessionKey, text)}
                connecting={connectingId === agent.id}
                split={splitMode}
                onClose={() => closeSplit(agent.id)}
              />
            </div>
          ))}
        </main>
      ) : (
        <main className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
            <div className="mb-4 grid size-12 place-items-center rounded-2xl bg-violet/10 text-violet">
              <Users className="size-6" />
            </div>
            <h1 className="text-lg font-semibold">{t("welcome.title", { team: activeTeam.name })}</h1>
            <p className="mt-2 max-w-md text-sm text-muted-foreground">{t("welcome.hint")}</p>
            <Button className="mt-5" onClick={openAgentDialog}>
              <Plus className="size-4" /> {t("agent.new")}
            </Button>
          </div>
        </main>
      )}

      {/* Nuevo equipo */}
      <Dialog open={teamDialog} onOpenChange={setTeamDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("team.new")}</DialogTitle>
            <DialogDescription>{t("team.hint")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="team-name">{t("team.name")}</Label>
            <Input id="team-name" value={teamName} onChange={(event) => setTeamName(event.target.value)} placeholder={t("team.placeholder")} onKeyDown={(event) => { if (event.key === "Enter") submitTeam(); }} />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setTeamDialog(false)}>{t("common:actions.cancel")}</Button>
            <Button onClick={submitTeam}>{t("team.create")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Nuevo agente */}
      <Dialog open={agentDialog} onOpenChange={(open) => !creatingAgent && setAgentDialog(open)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("agent.new")}</DialogTitle>
            <DialogDescription>{t("agent.hint", { team: activeTeam.name })}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="space-y-2">
              <Label htmlFor="agent-name">{t("agent.name")}</Label>
              <Input id="agent-name" value={agentName} onChange={(event) => setAgentName(event.target.value)} placeholder={t("agent.namePlaceholder")} />
              <p className="text-[0.68rem] text-muted-foreground">{t("agent.nameRule")}</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="agent-role">{t("agent.role")}</Label>
              <Textarea id="agent-role" value={agentRole} onChange={(event) => setAgentRole(event.target.value)} placeholder={t("agent.rolePlaceholder")} className="min-h-20" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="agent-workspace">{t("agent.workspace")}</Label>
              <div className="flex gap-2">
                <Input id="agent-workspace" value={agentWorkspace} onChange={(event) => setAgentWorkspace(event.target.value)} placeholder={currentWorkspace} />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  disabled={!isTauri()}
                  title={t("agent.chooseWorkspace")}
                  onClick={() => {
                    void openDialog({ directory: true, multiple: false, defaultPath: agentWorkspace || currentWorkspace }).then((path) => {
                      if (typeof path === "string") setAgentWorkspace(path);
                    });
                  }}
                >
                  <FolderOpen className="size-4" />
                </Button>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" disabled={creatingAgent} onClick={() => setAgentDialog(false)}>{t("common:actions.cancel")}</Button>
            <Button disabled={creatingAgent} onClick={() => void submitAgent()}>
              {creatingAgent ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
              {creatingAgent ? t("agent.creating") : t("agent.create")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  );
}
