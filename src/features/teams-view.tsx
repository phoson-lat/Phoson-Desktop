import {
  Bot,
  FolderOpen,
  Loader2,
  MessageSquare,
  Plus,
  Send,
  Trash2,
  Users,
} from "lucide-react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { isTauri, phoson } from "@/bridge/client";
import type { PeerPresence } from "@/bridge/protocol";
import { PluginBlocks } from "@/features/plugin-blocks";
import { Composer } from "@/features/composer";
import { MessageRow } from "@/features/message";
import { InteractionCard } from "@/features/questions-card";
import { SubagentPanel } from "@/features/subagent-panel";
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
import { Textarea } from "@/components/ui/textarea";
import { loadDrafts, saveDrafts } from "@/lib/drafts";
import { agentRolePrompt, mentionsAgent, normalizePeerName, peerMessagePrompt, PEER_NAME_PATTERN } from "@/lib/teams";
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
  const ready = useSession((state) => state.ready);
  const send = useSession((state) => state.send);
  const cancel = useSession((state) => state.cancel);
  const regenerate = useSession((state) => state.regenerate);
  const closeSession = useSession((state) => state.closeSession);
  const respondConfirm = useSession((state) => state.respondConfirm);
  const respondInteraction = useSession((state) => state.respondInteraction);
  const addFiles = useSession((state) => state.addFiles);
  const removeAttachment = useSession((state) => state.removeAttachment);
  const removeUpload = useSession((state) => state.removeUpload);

  const activeTeam = teams.find((team) => team.id === activeTeamId) ?? teams[0];
  const teamAgents = useMemo(
    () => agents.filter((agent) => agent.teamId === activeTeam?.id),
    [agents, activeTeam?.id],
  );
  const activeAgent = teamAgents.find((agent) => agent.id === activeAgentId) ?? null;
  const activeKey = activeAgent?.sessionKey;
  const view = activeKey ? sessions[activeKey] : undefined;
  const messages = useMemo(() => view?.messages ?? [], [view?.messages]);
  const [presence, setPresence] = useState<PeerPresence[]>([]);
  const [connectingId, setConnectingId] = useState<string | null>(null);
  const [creatingAgent, setCreatingAgent] = useState(false);
  const [agentDialog, setAgentDialog] = useState(false);
  const [teamDialog, setTeamDialog] = useState(false);
  const [teamName, setTeamName] = useState("");
  const [agentName, setAgentName] = useState("");
  const [agentRole, setAgentRole] = useState("");
  const [agentWorkspace, setAgentWorkspace] = useState("");
  const [relayDialog, setRelayDialog] = useState(false);
  const [relayTarget, setRelayTarget] = useState("");
  const [relayText, setRelayText] = useState("");
  const [relaySending, setRelaySending] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, string>>(loadDrafts);
  const scrollRef = useRef<HTMLDivElement>(null);
  /** Invalida conexiones antiguas al cambiar rápido de agente o equipo. */
  const connectionSeq = useRef(0);

  const draft = activeKey ? (drafts[activeKey] ?? "") : "";
  const setDraft = (text: string) => {
    if (activeKey) setDrafts((current) => ({ ...current, [activeKey]: text }));
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

  useEffect(() => {
    if (messages.length) scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages.length, activeKey]);

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

  const removeCurrentAgent = async () => {
    if (!activeAgent) return;
    const key = activeAgent.sessionKey;
    if (key && sessions[key]) await closeSession(key).catch(() => {});
    removeAgent(activeAgent.id);
    await refreshPresence();
  };

  const openRelay = () => {
    const first = teamAgents.find((agent) => agent.id !== activeAgent?.id);
    if (!first) {
      toast.info(t("relay.empty"));
      return;
    }
    setRelayTarget(first.id);
    setRelayText("");
    setRelayDialog(true);
  };

  const submitRelay = async () => {
    const target = teamAgents.find((agent) => agent.id === relayTarget);
    if (!activeTeam || !activeAgent || !target || !relayText.trim()) return;
    setRelaySending(true);
    try {
      const result = await phoson.peersSend(
        activeTeam.name,
        activeAgent.name,
        target.name,
        relayText.trim(),
        activeAgent.workspace,
      );
      toast.success(t(result.delivered ? "relay.delivered" : "relay.queued", { name: target.name }));
      setRelayDialog(false);
      setRelayText("");
    } catch (error) {
      toast.error(t("relay.failed"), { description: String(error) });
    } finally {
      setRelaySending(false);
    }
  };

  const submit = () => {
    if (!activeTeam || !activeAgent || !view || !draft.trim() || view.sending) return;
    const text = draft.trim();
    const mentioned = teamAgents.find(
      (agent) => agent.id !== activeAgent.id && mentionsAgent(text, agent.name),
    );
    const firstPrompt = view.messages.length === 0 ? agentRolePrompt(activeAgent, activeTeam.name, text) : text;
    setDraft("");
    void send(text, undefined, {
      prompt: mentioned ? peerMessagePrompt(mentioned.name, firstPrompt) : firstPrompt,
    });
  };

  if (!activeTeam) return null;
  const activePresence = activeAgent
    ? presence.find((peer) => peer.name === activeAgent.name)
    : undefined;

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1">
      {/* Rail de equipos, equivalente a los workspaces de Slack. */}
      <nav aria-label={t("teams")} className="flex w-14 shrink-0 flex-col items-center gap-2 border-r border-dashboard-border-soft bg-black/5 py-3">
        {teams.map((team) => (
          <button
            key={team.id}
            title={team.name}
            aria-label={t("openTeam", { name: team.name })}
            onClick={() => setActiveTeam(team.id)}
            className={cn(
              "grid size-9 place-items-center rounded-xl text-xs font-semibold uppercase transition-colors",
              team.id === activeTeam.id
                ? "bg-violet text-white"
                : "bg-[var(--phoson-surface-2)] text-muted-foreground hover:text-foreground",
            )}
          >
            {team.name.slice(0, 2)}
          </button>
        ))}
        <button
          title={t("team.new")}
          aria-label={t("team.new")}
          onClick={() => setTeamDialog(true)}
          className="grid size-9 place-items-center rounded-xl border border-dashed border-dashboard-border-soft text-muted-foreground hover:text-foreground"
        >
          <Plus className="size-4" />
        </button>
      </nav>

      {/* Agentes del equipo: conversaciones directas con identidad peers. */}
      <aside className="flex w-60 shrink-0 flex-col border-r border-dashboard-border-soft">
        <div className="flex items-center gap-2 border-b border-dashboard-border-soft px-3 py-3">
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold"># {activeTeam.name}</div>
            <div className="text-[0.68rem] text-muted-foreground">{t("memberCount", { count: teamAgents.length })}</div>
          </div>
          <Button variant="ghost" size="icon" className="size-7" title={t("agent.new")} onClick={openAgentDialog}>
            <Plus className="size-4" />
          </Button>
        </div>
        <div className="px-3 pb-1 pt-3 text-[0.68rem] font-medium uppercase tracking-wide text-muted-foreground">
          {t("agents")}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {teamAgents.map((agent) => {
            const peer = presence.find((item) => item.name === agent.name);
            const running = agent.sessionKey ? sessions[agent.sessionKey]?.sending : false;
            return (
              <button
                key={agent.id}
                onClick={() => selectAgent(agent)}
                className={cn(
                  "mb-1 flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors",
                  agent.id === activeAgent?.id ? "bg-[var(--phoson-surface-2)]" : "dashboard-hover",
                )}
              >
                <span className="relative grid size-8 shrink-0 place-items-center rounded-lg bg-violet/10 text-violet">
                  <Bot className="size-4" />
                  <span
                    className={cn(
                      "absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full border-2 border-[var(--background)]",
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
              </button>
            );
          })}
          {teamAgents.length === 0 && (
            <div className="px-3 py-8 text-center">
              <Users className="mx-auto mb-2 size-5 text-muted-foreground" />
              <p className="text-xs text-muted-foreground">{t("noAgents")}</p>
            </div>
          )}
        </div>
        <div className="border-t border-dashboard-border-soft p-2">
          <Button variant="outline" size="sm" className="w-full" onClick={openAgentDialog}>
            <Plus className="size-3.5" /> {t("agent.new")}
          </Button>
        </div>
      </aside>

      {/* Chat del agente elegido. Reutiliza el mismo SessionManager y renderer. */}
      <main className="flex min-h-0 min-w-0 flex-1 flex-col">
        {activeAgent ? (
          <>
            <header className="flex items-center gap-3 border-b border-dashboard-border-soft px-4 py-2.5">
              <div className="grid size-8 place-items-center rounded-lg bg-violet/10 text-violet">
                <Bot className="size-4" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <span className="truncate">{activeAgent.name}</span>
                  <span className={cn("size-2 rounded-full", activePresence?.live ? "bg-emerald-500" : "bg-muted-foreground/40")} />
                </div>
                <div className="truncate text-[0.68rem] text-muted-foreground">
                  {activeAgent.role || basename(activeAgent.workspace)}
                  {" · "}
                  {activePresence?.live
                    ? activePresence.state === "busy"
                      ? t("presence.busy")
                      : activePresence.state === "waiting"
                        ? t("presence.waiting")
                        : t("presence.idle")
                    : t("presence.offline")}
                </div>
              </div>
              <Button variant="outline" size="sm" onClick={openRelay} disabled={teamAgents.length < 2}>
                <Send className="size-3.5" /> {t("relay.action")}
              </Button>
              <Button variant="ghost" size="icon" className="size-8" title={t("agent.remove")} onClick={() => void removeCurrentAgent()}>
                <Trash2 className="size-3.5" />
              </Button>
            </header>

            <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
              {messages.length === 0 ? (
                <div className="flex h-full flex-col items-center justify-center px-6 text-center">
                  <MessageSquare className="mb-3 size-7 text-violet" />
                  <h2 className="text-sm font-medium">{t("emptyChat.title", { name: activeAgent.name })}</h2>
                  <p className="mt-1 max-w-md text-xs text-muted-foreground">{t("emptyChat.hint")}</p>
                </div>
              ) : (
                <div className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-6">
                  {messages.map((message, index) => (
                    <MessageRow
                      key={message.id}
                      message={message}
                      isLast={index === messages.length - 1}
                      onRegenerate={() => void regenerate()}
                    />
                  ))}
                </div>
              )}
            </div>

            <SubagentPanel tasks={view?.subagents ?? []} />
            <PluginBlocks blocks={Object.values(view?.pluginBlocks ?? {})} />
            {view?.confirmations
              .filter((confirmation) => (confirmation.kind ?? "bash") !== "bash")
              .map((confirmation) => (
                <InteractionCard
                  key={confirmation.requestId}
                  request={confirmation}
                  onAnswer={(requestId, payload) => void respondInteraction(requestId, payload)}
                  onCancel={(requestId) => void respondInteraction(requestId, { cancelled: true })}
                />
              ))}
            {view?.confirmations.filter((confirmation) => (confirmation.kind ?? "bash") === "bash").map((confirmation) => (
              <div key={confirmation.requestId} role="alertdialog" className="dashboard-panel-strong mx-auto mb-2 w-full max-w-3xl rounded-xl border p-3">
                <div className="mb-2 text-xs font-medium">{t("chrome:command.runQuestion")}</div>
                <pre className="mb-3 overflow-x-auto rounded-md bg-black/20 p-2 text-xs">{confirmation.command ?? ""}</pre>
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => void respondConfirm(confirmation.requestId, "yes")}>{t("common:words.yes")}</Button>
                  <Button size="sm" variant="outline" onClick={() => void respondConfirm(confirmation.requestId, "always")}>{t("chrome:command.always")}</Button>
                  <Button size="sm" variant="ghost" onClick={() => void respondConfirm(confirmation.requestId, "no")}>{t("common:words.no")}</Button>
                </div>
              </div>
            ))}
            <Composer
              value={draft}
              onChange={setDraft}
              onSend={submit}
              onStop={() => void cancel()}
              sending={Boolean(view?.sending)}
              disabled={!ready || connectingId === activeAgent.id}
              sessionId={activeKey ?? null}
              model={view?.metrics?.model}
              provider={view?.metrics?.provider}
              attachments={view?.attachments ?? []}
              uploads={view?.uploads ?? []}
              onAddFiles={(files) => void addFiles(files)}
              onRemoveAttachment={(path) => void removeAttachment(path)}
              onRemoveUpload={removeUpload}
            />
            <div className="-mt-2 px-5 pb-2 text-center text-[0.65rem] text-muted-foreground">
              {t("mentionHint")}
            </div>
          </>
        ) : (
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
        )}
      </main>

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

      {/* Mensaje directo agente → agente */}
      <Dialog open={relayDialog} onOpenChange={setRelayDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("relay.title", { name: activeAgent?.name })}</DialogTitle>
            <DialogDescription>{t("relay.hint")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="relay-target">{t("relay.recipient")}</Label>
            <select id="relay-target" value={relayTarget} onChange={(event) => setRelayTarget(event.target.value)} className="border-input bg-background flex h-9 w-full rounded-md border px-3 text-sm">
              {teamAgents.filter((agent) => agent.id !== activeAgent?.id).map((agent) => (
                <option key={agent.id} value={agent.id}>{agent.name} · {basename(agent.workspace)}</option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="relay-message">{t("relay.message")}</Label>
            <Textarea id="relay-message" value={relayText} onChange={(event) => setRelayText(event.target.value)} placeholder={t("relay.placeholder")} className="min-h-28" />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRelayDialog(false)}>{t("common:actions.cancel")}</Button>
            <Button disabled={relaySending || !relayText.trim()} onClick={() => void submitRelay()}>
              {relaySending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
              {t("relay.send")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
