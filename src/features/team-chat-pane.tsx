import { Loader2, MessageSquare, X } from "lucide-react";
import { useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";

import { Composer } from "@/features/composer";
import { MessageRow } from "@/features/message";
import { PluginBlocks } from "@/features/plugin-blocks";
import { InteractionCard } from "@/features/questions-card";
import { SubagentPanel } from "@/features/subagent-panel";
import { Button } from "@/components/ui/button";
import { agentRolePrompt, mentionsAgent, peerMessagePrompt } from "@/lib/teams";
import { cn } from "@/lib/utils";
import { useSession } from "@/stores/session";
import type { TeamAgent } from "@/stores/teams";

interface TeamChatPaneProps {
  agent: TeamAgent;
  teamName: string;
  teamAgents: TeamAgent[];
  draft: string;
  onDraftChange: (text: string) => void;
  connecting?: boolean;
  split?: boolean;
  onClose?: () => void;
}

/** Chat completo de un agente; cada instancia opera sobre su propia sessionKey. */
export function TeamChatPane({
  agent,
  teamName,
  teamAgents,
  draft,
  onDraftChange,
  connecting = false,
  split = false,
  onClose,
}: TeamChatPaneProps) {
  const { t } = useTranslation(["teams", "common", "chrome"]);
  const key = agent.sessionKey;
  const ready = useSession((state) => state.ready);
  const view = useSession((state) => (key ? state.sessions[key] : undefined));
  const send = useSession((state) => state.send);
  const cancel = useSession((state) => state.cancel);
  const regenerate = useSession((state) => state.regenerate);
  const respondConfirm = useSession((state) => state.respondConfirm);
  const respondInteraction = useSession((state) => state.respondInteraction);
  const addFiles = useSession((state) => state.addFiles);
  const removeAttachment = useSession((state) => state.removeAttachment);
  const removeUpload = useSession((state) => state.removeUpload);
  const messages = useMemo(() => view?.messages ?? [], [view?.messages]);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (messages.length) scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages.length, key]);

  const activate = () => {
    if (key) useSession.getState().setActive(key);
  };

  const submit = (domText?: string) => {
    if (!view || view.sending) return;
    const text = (domText ?? draft).trim();
    if (!text) return;
    const mentioned = teamAgents.find(
      (candidate) => candidate.id !== agent.id && mentionsAgent(text, candidate.name),
    );
    const firstPrompt = view.messages.length === 0 ? agentRolePrompt(agent, teamName, text) : text;
    onDraftChange("");
    activate();
    void send(text, undefined, {
      prompt: mentioned ? peerMessagePrompt(mentioned.name, firstPrompt) : firstPrompt,
    });
  };

  return (
    <section
      aria-label={agent.name}
      className="relative flex h-full min-h-0 min-w-0 flex-col overflow-hidden"
      onPointerDown={activate}
    >
      {split && (
        <>
          <div className="pointer-events-none absolute left-3 top-2 z-10 flex items-center gap-1.5 rounded-full bg-[var(--background)]/85 px-2 py-1 text-[0.65rem] font-medium backdrop-blur-sm">
            <span className="grid size-4 place-items-center rounded-full bg-violet/15 text-[0.5rem] uppercase text-violet">
              {agent.name.slice(0, 2)}
            </span>
            <span className="max-w-32 truncate">{agent.name}</span>
            {view?.sending && <Loader2 className="size-3 animate-spin text-violet" />}
          </div>
          {onClose && (
            <Button
              variant="ghost"
              size="icon"
              className="absolute right-2 top-1.5 z-10 size-7 bg-[var(--background)]/85 backdrop-blur-sm"
              title={t("split.close", { name: agent.name })}
              aria-label={t("split.close", { name: agent.name })}
              onClick={onClose}
            >
              <X className="size-3.5" />
            </Button>
          )}
        </>
      )}

      <div
        ref={scrollRef}
        className={cn("min-h-0 flex-1 overflow-y-auto overscroll-contain", split && "pt-8")}
      >
        {messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center px-6 text-center">
            <MessageSquare className="mb-3 size-7 text-violet" />
            <h2 className="text-sm font-medium">{t("emptyChat.title", { name: agent.name })}</h2>
            <p className="mt-1 max-w-md text-xs text-muted-foreground">{t("emptyChat.hint")}</p>
          </div>
        ) : (
          <div
            className={cn(
              "mx-auto flex flex-col px-4 py-6",
              split ? "max-w-none gap-4 px-3 py-4" : "max-w-3xl gap-6",
            )}
          >
            {messages.map((message, index) => (
              <MessageRow
                key={message.id}
                message={message}
                isLast={index === messages.length - 1}
                onRegenerate={() => {
                  activate();
                  void regenerate();
                }}
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
            onAnswer={(requestId, payload) => {
              activate();
              void respondInteraction(requestId, payload);
            }}
            onCancel={(requestId) => {
              activate();
              void respondInteraction(requestId, { cancelled: true });
            }}
          />
        ))}
      {view?.confirmations.filter((confirmation) => (confirmation.kind ?? "bash") === "bash").map((confirmation) => (
        <div key={confirmation.requestId} role="alertdialog" className="dashboard-panel-strong mx-auto mb-2 w-full max-w-3xl rounded-xl border p-3">
          <div className="mb-2 text-xs font-medium">{t("chrome:command.runQuestion")}</div>
          <pre className="mb-3 overflow-x-auto rounded-md bg-black/20 p-2 text-xs">{confirmation.command ?? ""}</pre>
          <div className="flex gap-2">
            <Button size="sm" onClick={() => { activate(); void respondConfirm(confirmation.requestId, "yes"); }}>{t("common:words.yes")}</Button>
            <Button size="sm" variant="outline" onClick={() => { activate(); void respondConfirm(confirmation.requestId, "always"); }}>{t("chrome:command.always")}</Button>
            <Button size="sm" variant="ghost" onClick={() => { activate(); void respondConfirm(confirmation.requestId, "no"); }}>{t("common:words.no")}</Button>
          </div>
        </div>
      ))}
      <Composer
        value={draft}
        onChange={onDraftChange}
        onSend={submit}
        onStop={() => {
          activate();
          void cancel();
        }}
        sending={Boolean(view?.sending)}
        disabled={!ready || connecting || !key}
        sessionId={key ?? null}
        model={view?.metrics?.model}
        provider={view?.metrics?.provider}
        attachments={view?.attachments ?? []}
        uploads={view?.uploads ?? []}
        onAddFiles={(files) => {
          activate();
          void addFiles(files);
        }}
        onRemoveAttachment={(path) => {
          activate();
          void removeAttachment(path);
        }}
        onRemoveUpload={(path) => {
          activate();
          removeUpload(path);
        }}
        dense={split}
      />
      {!split && (
        <div className="-mt-2 px-5 pb-2 text-center text-[0.65rem] text-muted-foreground">
          {t("mentionHint")}
        </div>
      )}
    </section>
  );
}
