import { Folder, Menu, Sparkles } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { getCurrentWindow } from "@tauri-apps/api/window";

import { isTauri, onTerminated, openExternal } from "@/bridge/client";
import { Button } from "@/components/ui/button";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Composer } from "@/features/composer";
import { CodeViewer } from "@/features/code-viewer";
import { ContextMeter } from "@/features/context-meter";
import { FileExplorer } from "@/features/file-explorer";
import { MessageRow } from "@/features/message";
import { Onboarding } from "@/features/onboarding";
import { SettingsDialog } from "@/features/settings-dialog";
import { CommandPalette } from "@/features/command-palette";
import { SubagentPanel } from "@/features/subagent-panel";
import { Sidebar } from "@/features/sidebar";
import { Welcome } from "@/features/welcome";
import { ComingSoon } from "@/features/coming-soon";
import { useIsMobile } from "@/hooks/use-mobile";
import { useMediaQuery } from "@/hooks/use-media-query";
import { checkForUpdates } from "@/lib/updater";
import { DEMO_USER } from "@/lib/demo-content";
import { mark, record, uptime } from "@/lib/perf";
import { cn } from "@/lib/utils";
import { useSession } from "@/stores/session";

const basename = (p: string) => p.split("/").filter(Boolean).pop() ?? p;

export default function App() {  const {
    ready,
    activeKey,
    order,
    sessions,
    init,
    send,
    cancel,
    regenerate,
    newSession,
    openSession,
    closeSession,
    setActive,
    respondConfirm,
    onboardingNeeded,
    bootError,
    startOnboarding,
    cwd,
    loadCwd,
    setWorkspace,
    finishOnboarding,
    loadAttachments,
    addFiles,
    removeAttachment,
    removeUpload,
  } = useSession();
  // Borrador POR SESIÓN: cambiar de sesión no debe arrastrar (ni enviar) el
  // texto que estabas escribiendo en otra.
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const draft = (activeKey ? drafts[activeKey] : "") ?? "";
  const setDraft = (v: string) =>
    setDrafts((d) => (activeKey ? { ...d, [activeKey]: v } : d));
  const [navOpen, setNavOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(
    () => typeof localStorage !== "undefined" && localStorage.getItem("phoson.nav") === "collapsed",
  );
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [explorerOpen, setExplorerOpen] = useState(false);
  /** Sección visible en el área de contenido: la conversación o los swarms. */
  const [section, setSection] = useState<"chat" | "swarm">("chat");
  /**
   * Secciones que ya se visitaron. Se montan en su primera visita (montar el
   * lienzo de React Flow al arrancar sería pagar por lo que aún no se usa) y a
   * partir de ahí se quedan: así el borrador y el encuadre sobreviven al cambiar
   * de sección y volver.
   */
  const [visited, setVisited] = useState<Record<string, boolean>>({ chat: true });
  const [openFile, setOpenFile] = useState<string | null>(null);

  // Rendimiento: hitos de arranque (requiere `phosonPerf` en la consola).
  useEffect(() => {
    mark("ui:app-mounted");
  }, []);
  const bootRecorded = useRef(false);
  useEffect(() => {
    if (ready && !bootRecorded.current) {
      bootRecorded.current = true;
      record("app:ready", uptime());
    }
  }, [ready]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const isMobile = useIsMobile();
  /** El explorador pasa a panel superpuesto en ventanas estrechas. */
  const narrow = useMediaQuery("(max-width: 1279px)");

  const view = activeKey ? sessions[activeKey] : undefined;
  const messages = view?.messages ?? [];
  const metrics = view?.metrics;
  // El workspace mostrado en la cabecera es el de la **sesión activa**, no un
  // `cwd` global que puede quedar desfasado al cambiar de sesión/proyecto.
  const workspacePath = view?.workspace || cwd;

  useEffect(() => {
    void init();
  }, [init]);

  // Los enlaces (markdown, settings, MCP) deben abrirse en el navegador del
  // sistema: la webview de Tauri no navega fuera de la app.
  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      const anchor = (event.target as HTMLElement | null)?.closest?.(
        "a[href]",
      ) as HTMLAnchorElement | null;
      if (!anchor) return;
      const href = anchor.getAttribute("href") ?? "";
      const external =
        href.startsWith("http://") || href.startsWith("https://") || href.startsWith("mailto:");
      if (!external) return;
      event.preventDefault();
      void openExternal(href).catch(() => window.open(href, "_blank", "noopener"));
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);

  // Workspace del agente (cwd del sidecar): el que usan los tools.
  useEffect(() => {
    if (!ready) return;
    void loadCwd();
    void loadAttachments();
  }, [ready, loadCwd, loadAttachments]);

  const applyWorkspace = async (path: string) => {
    try {
      const next = await setWorkspace(path);
      toast.success("Espacio de trabajo actualizado", { description: next });
    } catch (e) {
      toast.error("No se pudo cambiar el espacio de trabajo", { description: String(e) });
    }
  };

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

  // Deep-link: `?swarm=1` abre la sección de swarms al arrancar.
  const search = typeof location !== "undefined" ? new URLSearchParams(location.search) : null;
  const swarmParam = search?.get("swarm") ?? null;
  const linked = useRef(false);
  useEffect(() => {
    if (linked.current || swarmParam === null) return;
    linked.current = true;
    setSection("swarm");
  }, [swarmParam]);

  useEffect(() => {
    setVisited((current) => (current[section] ? current : { ...current, [section]: true }));
  }, [section]);

  useEffect(() => {
    try {
      localStorage.setItem("phoson.nav", collapsed ? "collapsed" : "open");
    } catch {
      /* almacenamiento no disponible */
    }
  }, [collapsed]);

  // Si el motor de un workspace se cae, avisamos: sus sesiones en memoria se
  // pierden y el sidecar se respawnea al volver a usarlo.
  useEffect(() => {
    let dispose: (() => void) | undefined;
    void onTerminated(({ workspace }) => {
      toast.error("El motor de un espacio de trabajo se detuvo", {
        description: workspace
          ? `Se reiniciará al volver a usarlo: ${basename(workspace)}`
          : "Se reiniciará al volver a usarlo.",
      });
    }).then((fn) => {
      dispose = fn;
    });
    return () => dispose?.();
  }, []);

  // Pegado al fondo: solo auto-scroll si el usuario ya está abajo. Si sube a
  // leer un mensaje anterior, no le arrastramos la vista en cada token.
  const stickToBottom = useRef(true);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => {
      stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !stickToBottom.current) return;
    // `auto` mientras el agente trabaja: `smooth` en cada token pelea con la lectura.
    el.scrollTo({ top: el.scrollHeight, behavior: view?.sending ? "auto" : "smooth" });
  }, [messages, view?.sending]);

  const title = useMemo(() => {
    // Prefiere el título del engine (heurístico → del modelo) y cae al primer
    // mensaje del usuario como respaldo inmediato.
    const stored = view?.title?.trim();
    if (stored) return stored;
    const first = messages.find((m) => m.role === "user")?.text;
    return first ? (first.length > 60 ? first.slice(0, 60) + "…" : first) : "Nueva sesión";
  }, [view?.title, messages]);

  // El título de la ventana sigue a la conversación (barra de tareas, alt-tab).
  useEffect(() => {
    const label = `${title} · Phoson`;
    document.title = label;
    if (isTauri()) void getCurrentWindow().setTitle(label).catch(() => {});
  }, [title]);

  const submit = (text?: string) => {
    const value = (text ?? draft).trim();
    if (!value || view?.sending) return;
    setDraft("");
    void send(value);
  };

  // Check silencioso de actualizaciones al arrancar (con cooldown de 12 h).
  useEffect(() => {
    if (!ready || !isTauri()) return;
    let last = 0;
    try {
      last = Number(localStorage.getItem("phoson.updateCheck") || 0);
    } catch {
      /* almacenamiento no disponible */
    }
    if (Date.now() - last < 12 * 3600 * 1000) return;
    try {
      localStorage.setItem("phoson.updateCheck", String(Date.now()));
    } catch {
      /* almacenamiento no disponible */
    }
    void checkForUpdates()
      .then((u) => {
        if (u) {
          toast.info(`Nueva versión v${u.version} disponible`, {
            description: "Ajustes → Acerca de para instalarla.",
          });
        }
      })
      .catch(() => {
        /* sin red o feed sin configurar: silencio */
      });
  }, [ready]);

  // Drag & drop en TODA la ventana (no solo el composer).
  const [dragOver, setDragOver] = useState(false);
  const handleDragOver = (e: React.DragEvent) => {
    if (!e.dataTransfer?.types?.includes("Files")) return;
    e.preventDefault();
    setDragOver(true);
  };
  const handleDragLeave = (e: React.DragEvent) => {
    if (e.currentTarget === e.target) setDragOver(false);
  };
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const files = Array.from(e.dataTransfer.files ?? []);
    if (files.length) void addFiles(files);
  };

  return (
    <TooltipProvider delayDuration={200}>
      <div
        className="dashboard-shell-overlay flex h-full min-h-0 w-full overflow-hidden"
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {dragOver && (
          <div className="pointer-events-none fixed inset-0 z-[90] grid place-items-center bg-[var(--background)]/70 text-sm text-violet">
            Suelta los archivos para adjuntarlos
          </div>
        )}
        <Sidebar
          activeKey={activeKey}
          order={order}
          sessions={sessions}
          model={metrics?.model}
          provider={metrics?.provider}
          workspace={cwd}
          mobile={isMobile}
          open={navOpen}
          collapsed={collapsed}
          onDismiss={() => setNavOpen(false)}
          onNew={() => {
            void newSession();
            setNavOpen(false);
          }}
          onSelect={(k) => {
            setActive(k);
            setSection("chat");
            setNavOpen(false);
          }}
          onOpen={(id, ws) => {
            void openSession(id, ws);
            setSection("chat");
            setNavOpen(false);
          }}
          onClose={(k) => void closeSession(k)}
          onToggleCollapse={() => setCollapsed((c) => !c)}
          onOpenSettings={() => setSettingsOpen(true)}
          onOpenSwarm={() => setSection("swarm")}
          section={section}
        />

        <div className="relative min-h-0 min-w-0 flex-1">
          {/* Las tres secciones conviven —para no perder borradores ni el
              encuadre del lienzo— así que las inactivas se ocultan con
              `visibility` y no con `display`: React Flow mide su contenedor al
              montar, y un contenedor con `display:none` mide 0×0. */}
          <div
            aria-hidden={section !== "chat"}
            data-section="chat"
            className={cn(
              "absolute inset-0 flex min-h-0 min-w-0",
              section !== "chat" && "pointer-events-none invisible",
            )}
          >
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
              <button
                onClick={() => setExplorerOpen((o) => !o)}
                title="Ver archivos del espacio de trabajo"
                className="flex max-w-full items-center gap-1.5 truncate text-[0.68rem] text-muted-foreground transition-colors hover:text-foreground"
              >
                <Folder className="size-3 shrink-0" />
                <span className="truncate">{workspacePath ? basename(workspacePath) : "workspace"}</span>
                <span className="shrink-0 opacity-40">·</span>
                <span className="shrink-0">{ready ? "listo" : "conectando…"}</span>
                {!isTauri() && <span className="shrink-0 opacity-60">· demo</span>}
              </button>
            </div>

            <ContextMeter metrics={metrics ?? undefined} />
          </header>

          {!ready && bootError ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
              <p className="text-sm text-destructive">No se pudo conectar con el engine</p>
              <p className="max-w-md text-xs text-muted-foreground">{bootError}</p>
              <Button size="sm" className="bg-violet text-white hover:bg-violet/90" onClick={() => void init()}>
                Reintentar
              </Button>
            </div>
          ) : messages.length === 0 ? (
            <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden">
              <Welcome
                onPick={(t) => void send(t)}
                onOpenSession={(id, ws) => void openSession(id, ws)}
              />
            </div>
          ) : (
            <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
              <div className="mx-auto flex max-w-3xl flex-col gap-6 px-3 py-5 sm:px-4 sm:py-8">
                {messages.map((m, i) => (
                  <MessageRow
                    key={m.id}
                    message={m}
                    isLast={i === messages.length - 1}
                    onRegenerate={() => void regenerate()}
                  />
                ))}
              </div>
            </div>
          )}

          <SubagentPanel tasks={view?.subagents ?? []} />

          {view?.confirmations.map((c) => (
            <div
              key={c.requestId}
              role="alertdialog"
              aria-live="assertive"
              aria-label="Confirmación de comando"
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
            onSend={(text) => submit(text)}
            onStop={() => void cancel()}
            sending={!!view?.sending}
            disabled={!ready}
            sessionId={activeKey}
            model={metrics?.model}
            provider={metrics?.provider}
            attachments={view?.attachments ?? []}
            uploads={view?.uploads ?? []}
            onAddFiles={(files) => void addFiles(files)}
            onRemoveAttachment={(path) => void removeAttachment(path)}
            onRemoveUpload={removeUpload}
            notice={
              view?.notifications?.length
                ? view.notifications[view.notifications.length - 1].message
                : null
            }
          />
        </main>

          {explorerOpen && (
            <FileExplorer
              cwd={cwd}
              onClose={() => setExplorerOpen(false)}
              onSetCwd={(p) => void applyWorkspace(p)}
              onOpenFile={setOpenFile}
              overlay={narrow}
            />
          )}
          </div>

          {/* La sección de swarms queda montada al cambiar de vista (así el
              borrador y el encuadre sobreviven a ir a una sesión y volver). */}
          <div
            aria-hidden={section !== "swarm"}
            data-section="swarm"
            className={cn(
              "absolute inset-0 flex min-h-0 min-w-0",
              section !== "swarm" && "pointer-events-none invisible",
            )}
          >
            {visited.swarm && (
              <ComingSoon
                title="Swarms de agentes"
                note="Estamos afinando la orquestación multi-agente (topologías, estado en vivo y mensajería). Volverá en una próxima versión."
                onExit={() => setSection("chat")}
              />
            )}
          </div>
        </div>
      </div>

      <SettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        sessionId={activeKey}
        onRestartOnboarding={() => {
          setSettingsOpen(false);
          startOnboarding();
        }}
      />
      <CodeViewer path={openFile} onClose={() => setOpenFile(null)} />
      <CommandPalette
        onOpenSettings={() => setSettingsOpen(true)}
        onToggleExplorer={() => setExplorerOpen((v) => !v)}
        onOpenSwarm={() => setSection("swarm")}
      />
      {ready && onboardingNeeded && (
        <Onboarding sessionId={activeKey} onDone={finishOnboarding} />
      )}
      <Toaster position="bottom-right" />
    </TooltipProvider>
  );
}
