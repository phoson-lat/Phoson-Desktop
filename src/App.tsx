import { Menu, Settings, Sparkles } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { isTauri } from "@/bridge/client";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Composer } from "@/features/composer";
import { MessageRow } from "@/features/message";
import { MetricsBar } from "@/features/metrics";
import { ModelPicker } from "@/features/model-picker";
import { SettingsDialog } from "@/features/settings-dialog";
import { Sidebar } from "@/features/sidebar";
import { Welcome } from "@/features/welcome";
import { useIsMobile } from "@/hooks/use-mobile";
import { DEMO_USER } from "@/lib/demo-content";
import { useSession } from "@/stores/session";

export default function App() {
  const {
    ready,
    activeKey,
    order,
    sessions,
    init,
    send,
    cancel,
    newSession,
    openSession,
    closeSession,
    setActive,
    respondConfirm,
  } = useSession();
  const [draft, setDraft] = useState("");
  const [navOpen, setNavOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(
    () => typeof localStorage !== "undefined" && localStorage.getItem("phoson.nav") === "collapsed",
  );
  const [settingsOpen, setSettingsOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const isMobile = useIsMobile();

  const view = activeKey ? sessions[activeKey] : undefined;
  const messages = view?.messages ?? [];
  const metrics = view?.metrics;

  useEffect(() => {
    void init();
  }, [init]);

  // Deep-link de demo: `?demo=1` envía el prompt de demo (se streamea igual que
  // un turno normal, para ejercitar el render incremental).
  const demoParam =
    typeof location !== "undefined" && new URLSearchParams(location.search).has("demo");
  const demoLoaded = useRef(false);
  useEffect(() => {
    if (demoParam && ready && activeKey && !demoLoaded.current) {
      demoLoaded.current = true;
      void send(DEMO_USER);
    }
  }, [demoParam, ready, activeKey, send]);

  useEffect(() => {
    try {
      localStorage.setItem("phoson.nav", collapsed ? "collapsed" : "open");
    } catch {
      /* almacenamiento no disponible */
    }
  }, [collapsed]);

  useEffect(() => {
    const el = scrollRef.current;
    el?.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const title = useMemo(() => {
    const first = messages.find((m) => m.role === "user")?.text;
    return first ? (first.length > 60 ? first.slice(0, 60) + "…" : first) : "Nueva sesión";
  }, [messages]);

  const submit = () => {
    const text = draft.trim();
    if (!text || view?.sending) return;
    setDraft("");
    void send(text);
  };

  return (
    <TooltipProvider delayDuration={200}>
      <div className="dashboard-shell-overlay flex h-full min-h-0 w-full overflow-hidden">
        <Sidebar
          activeKey={activeKey}
          order={order}
          sessions={sessions}
          model={metrics?.model}
          provider={metrics?.provider}
          mobile={isMobile}
          open={navOpen}
          collapsed={collapsed}
          onDismiss={() => setNavOpen(false)}
          onSelect={(k) => {
            setActive(k);
            setNavOpen(false);
          }}
          onNew={() => {
            void newSession();
            setNavOpen(false);
          }}
          onOpen={(id) => {
            void openSession(id);
            setNavOpen(false);
          }}
          onClose={(k) => void closeSession(k)}
          onToggleCollapse={() => setCollapsed((c) => !c)}
          onOpenSettings={() => setSettingsOpen(true)}
        />

        <main className="flex min-h-0 min-w-0 flex-1 flex-col">
          <header className="flex items-center gap-2 border-b border-dashboard-border-soft px-3 py-2.5 sm:gap-3 sm:px-4">
            {isMobile && (
              <Button
                variant="ghost"
                size="icon"
                className="size-7 shrink-0"
                onClick={() => setNavOpen(true)}
                title="Sesiones"
              >
                <Menu className="size-4" />
              </Button>
            )}

            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">{title}</div>
              <div className="truncate text-[0.68rem] text-muted-foreground">
                {ready ? "listo" : "conectando…"}
                {!isTauri() && " · demo"}
              </div>
            </div>

            <ModelPicker
              sessionId={activeKey}
              current={metrics?.model}
              provider={metrics?.provider}
              compact={isMobile}
            />
            {!isMobile && <MetricsBar metrics={metrics ?? undefined} />}

            <Button
              variant="ghost"
              size="icon"
              className="size-7 shrink-0 text-muted-foreground"
              onClick={() => setSettingsOpen(true)}
              title="Configuración"
            >
              <Settings className="size-3.5" />
            </Button>
            <ThemeToggle />
          </header>

          {messages.length === 0 ? (
            <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden">
              <Welcome onPick={(t) => void send(t)} />
            </div>
          ) : (
            <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
              <div className="mx-auto flex max-w-3xl flex-col gap-6 px-3 py-5 sm:px-4 sm:py-8">
                {messages.map((m) => (
                  <MessageRow key={m.id} message={m} />
                ))}
              </div>
            </div>
          )}

          {view?.confirmations.map((c) => (
            <div
              key={c.requestId}
              className="dashboard-panel-strong mx-3 mb-2 rounded-xl border p-3 sm:mx-auto sm:w-full sm:max-w-3xl"
            >
              <div className="mb-1 flex items-center gap-2 text-xs font-medium">
                <Sparkles className="size-3.5 text-violet" /> ¿Ejecutar comando?
              </div>
              <pre className="mb-3 overflow-x-auto rounded-md border border-dashboard-border-soft bg-black/20 p-2 text-[0.75rem]">
                {c.command}
              </pre>
              <div className="flex flex-wrap gap-2">
                <button
                  className="rounded-md bg-violet px-3 py-1 text-xs text-white"
                  onClick={() => void respondConfirm(c.requestId, "yes")}
                >
                  Sí
                </button>
                <button
                  className="rounded-md border border-dashboard-border-soft px-3 py-1 text-xs"
                  onClick={() => void respondConfirm(c.requestId, "always")}
                >
                  Siempre
                </button>
                <button
                  className="rounded-md border border-dashboard-border-soft px-3 py-1 text-xs text-muted-foreground"
                  onClick={() => void respondConfirm(c.requestId, "no")}
                >
                  No
                </button>
              </div>
            </div>
          ))}

          <Composer
            value={draft}
            onChange={setDraft}
            onSend={submit}
            onStop={() => void cancel()}
            sending={!!view?.sending}
            disabled={!ready}
          />
        </main>
      </div>

      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} sessionId={activeKey} />
      <Toaster position="bottom-right" />
    </TooltipProvider>
  );
}
