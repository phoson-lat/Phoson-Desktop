import { ArrowDown, Folder, Menu, Sparkles } from "lucide-react";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { getCurrentWindow } from "@tauri-apps/api/window";

import { isTauri, onTerminated, openExternal } from "@/bridge/client";
import { Button } from "@/components/ui/button";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Composer } from "@/features/composer";
import { ContextMeter } from "@/features/context-meter";
import { GitStatus } from "@/features/git-status";
import { WorkspaceActions } from "@/features/workspace-actions";
import { InteractionCard } from "@/features/questions-card";
import { PluginBlocks } from "@/features/plugin-blocks";
import { MessageRow } from "@/features/message";
import { CommandPalette } from "@/features/command-palette";
import { SubagentPanel } from "@/features/subagent-panel";
import { Sidebar } from "@/features/sidebar";
import { Welcome } from "@/features/welcome";
import { useIsMobile } from "@/hooks/use-mobile";
import { useMediaQuery } from "@/hooks/use-media-query";
import { useTurnNotifications } from "@/hooks/use-notifications";
import { syncCloseToTray } from "@/lib/desktop";
import { logAction, logError, setLogContext } from "@/lib/log";
import { isModalOpen } from "@/lib/platform";
import { checkForUpdates } from "@/lib/updater";
import { demoUser } from "@/lib/demo-content";
import { mark, record, uptime } from "@/lib/perf";
import { cleanSessionTitle } from "@/lib/session-title";
import { useSession } from "@/stores/session";

const basename = (p: string) => p.split("/").filter(Boolean).pop() ?? p;

/* Ventanas/dialogos que no se ven al arrancar: se cargan (chunk aparte) en su
   primera apertura. `CommandPalette` queda eager porque registra el atajo
   Ctrl+K aunque esté cerrado, y el resto del chat es la ruta crítica. */
const SettingsDialog = lazy(() =>
  import("@/features/settings-dialog").then((m) => ({ default: m.SettingsDialog })),
);
const CodeViewer = lazy(() =>
  import("@/features/code-viewer").then((m) => ({ default: m.CodeViewer })),
);
const FileExplorer = lazy(() =>
  import("@/features/file-explorer").then((m) => ({ default: m.FileExplorer })),
);
const Onboarding = lazy(() =>
  import("@/features/onboarding").then((m) => ({ default: m.Onboarding })),
);

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
    respondInteraction,
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
  // `common` entra en el array para poder reutilizar sus claves (`common:…`).
  const { t } = useTranslation(["chrome", "common"]);
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
  /** El dialog de ajustes se monta en su primera apertura (chunk perezoso) y a
   * partir de ahí se queda montado: su estado interno (sección, borradores de
   * claves) sobrevive a cerrarlo y volver a abrirlo. */
  const [settingsMounted, setSettingsMounted] = useState(false);
  useEffect(() => {
    if (settingsOpen) setSettingsMounted(true);
  }, [settingsOpen]);
  const [explorerOpen, setExplorerOpen] = useState(false);
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
      logAction("app.ready", { ms: Math.round(uptime()) });
    }
  }, [ready]);
  /**
   * Contenedor de la conversación por *callback ref*: mientras se ve el estado
   * vacío (Welcome) no existe, así que con un `useRef` el listener de scroll solo
   * se enganchaba si la sesión ya tenía mensajes al montar (y el «pegado al
   * fondo» nunca se desactivaba en la primera sesión).
   */
  const [scrollEl, setScrollEl] = useState<HTMLDivElement | null>(null);
  const scrollRef = useCallback((node: HTMLDivElement | null) => setScrollEl(node), []);
  const isMobile = useIsMobile();
  /** El explorador pasa a panel superpuesto en ventanas estrechas. */
  const narrow = useMediaQuery("(max-width: 1279px)");

  const view = activeKey ? sessions[activeKey] : undefined;
  const messages = view?.messages ?? [];
  const metrics = view?.metrics;
  // El workspace mostrado en la cabecera es el de la **sesión activa**, no un
  // `cwd` global que puede quedar desfasado al cambiar de sesión/proyecto.
  const workspacePath = view?.workspace || cwd;

  // Mantiene el contexto de logging (sesión/workspace activos) al día.
  useEffect(() => {
    setLogContext({ session: activeKey ?? null, workspace: view?.workspace ?? cwd ?? null });
  }, [activeKey, view?.workspace, cwd]);

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
      toast.success(t("workspace.updated"), { description: next });
    } catch (e) {
      toast.error(t("workspace.updateError"), { description: String(e) });
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
      void send(demoUser());
    }
  }, [demoParam, ready, activeKey, send]);

  useEffect(() => {
    try {
      localStorage.setItem("phoson.nav", collapsed ? "collapsed" : "open");
    } catch {
      /* almacenamiento no disponible */
    }
  }, [collapsed]);

  // Si el motor de un workspace se cae, avisamos: sus sesiones en memoria se
  // pierden y el sidecar se respawnea al volver a usarlo. Las expulsiones por
  // inactividad (`idle: true`, el recolector de Rust) son silenciosas: son
  // mantenimiento, no un fallo.
  useEffect(() => {
    let dispose: (() => void) | undefined;
    void onTerminated(({ workspace, idle }) => {
      if (idle) {
        logAction("engine.idle-evicted", { workspace });
        return;
      }
      toast.error(t("engine.stopped"), {
        description: workspace
          ? t("engine.restartWithPath", { path: basename(workspace) })
          : t("engine.restart"),
      });
      logError("engine.terminated", "sidecar detenido", { workspace });
    }).then((fn) => {
      dispose = fn;
    });
    return () => dispose?.();
  }, []);

  // Pegado al fondo: solo auto-scroll si el usuario ya está abajo. Si sube a
  // leer un mensaje anterior, no le arrastramos la vista en cada token.
  const stickToBottom = useRef(true);
  /** Espejo en estado de `stickToBottom` (la UI necesita el botón «Ir al final»). */
  const [atBottom, setAtBottom] = useState(true);
  /** Mensajes llegados mientras el usuario lee hacia arriba. */
  const [unseen, setUnseen] = useState(0);
  const messageCount = useRef(0);
  useEffect(() => {
    if (!scrollEl) return;
    const onScroll = () => {
      const bottom = scrollEl.scrollHeight - scrollEl.scrollTop - scrollEl.clientHeight < 80;
      stickToBottom.current = bottom;
      // React ignora el `set` si el valor no cambia: no hay re-render por scroll.
      setAtBottom(bottom);
      if (bottom) setUnseen(0);
    };
    // No se sincroniza al montar: el auto-scroll de abajo coloca la vista y el
    // primer evento de scroll ajusta el estado (si se marcara «arriba» antes,
    // el auto-scroll se saltaría y la sesión se abriría por el principio).
    scrollEl.addEventListener("scroll", onScroll, { passive: true });
    return () => scrollEl.removeEventListener("scroll", onScroll);
  }, [scrollEl]);

  // Al cambiar de sesión se vuelve a seguir el final (antes se heredaba el
  // «estoy leyendo arriba» de la sesión anterior y el auto-scroll no volvía).
  useEffect(() => {
    stickToBottom.current = true;
    setAtBottom(true);
    setUnseen(0);
    messageCount.current = 0;
  }, [activeKey]);

  // Cuenta lo que entra fuera de pantalla (número del botón «Ir al final»).
  useEffect(() => {
    if (messages.length > messageCount.current && !stickToBottom.current) {
      setUnseen((n) => n + (messages.length - messageCount.current));
    }
    messageCount.current = messages.length;
  }, [messages.length]);

  useEffect(() => {
    if (!scrollEl || !stickToBottom.current) return;
    // `auto` mientras el agente trabaja: `smooth` en cada token pelea con la lectura.
    scrollEl.scrollTo({ top: scrollEl.scrollHeight, behavior: view?.sending ? "auto" : "smooth" });
  }, [messages, view?.sending, scrollEl]);

  /** Vuelve al final y reactiva el seguimiento (también al enviar un turno). */
  const scrollToBottom = (behavior: ScrollBehavior = "smooth") => {
    stickToBottom.current = true;
    setAtBottom(true);
    setUnseen(0);
    scrollEl?.scrollTo({ top: scrollEl.scrollHeight, behavior });
  };

  const title = useMemo(() => {
    // Prefiere el título del engine (heurístico → del modelo) y cae al primer
    // mensaje del usuario como respaldo inmediato. Los banners internos que el
    // engine inyecta (p. ej. el resumen de compactación) no son títulos.
    const stored = cleanSessionTitle(view?.title);
    if (stored) return stored;
    const first = cleanSessionTitle(messages.find((m) => m.role === "user")?.text);
    return first ? (first.length > 60 ? first.slice(0, 60) + "…" : first) : t("sessions.untitled");
    // `t` en las deps: al cambiar de idioma el memo debe rehacer el fallback.
  }, [view?.title, messages, t]);

  // El título de la ventana sigue a la conversación (barra de tareas, alt-tab).
  /** Preferencia «cerrar a la bandeja» → shell nativa (Windows). */
  useEffect(() => {
    syncCloseToTray();
  }, []);

  // Avisos del sistema al terminar turnos (en cualquier sesión, no solo la activa).
  useTurnNotifications(sessions, activeKey);

  /**
   * Avisos que emite el sidecar/engine (`notify`). Antes se pintaban como una
   * línea bajo el composer y solo se veía el último; ahora van a toasts apilados.
   * Se deduplican por identidad del objeto: el array se recrea en cada parche,
   * los avisos ya vistos conservan su referencia.
   */
  const toastedNotices = useRef<WeakSet<object>>(new WeakSet());
  useEffect(() => {
    for (const n of view?.notifications ?? []) {
      if (toastedNotices.current.has(n)) continue;
      toastedNotices.current.add(n);
      const emit = n.kind === "error" ? toast.error : n.kind === "warn" ? toast.warning : toast.info;
      emit(n.message);
    }
  }, [view?.notifications]);

  /**
   * Escape global: detiene la generación sin tener el foco en el composer.
   * No roba el atajo si hay un diálogo abierto ni si el agente espera una
   * confirmación (ahí Escape debe cerrar el diálogo que la contiene).
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || !view?.sending) return;
      if (isModalOpen() || (view.confirmations?.length ?? 0) > 0) return;
      e.preventDefault();
      void cancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [view?.sending, view?.confirmations, cancel]);

  useEffect(() => {
    const label = `${title} · Phoson`;
    document.title = label;
    if (isTauri()) void getCurrentWindow().setTitle(label).catch(() => {});
  }, [title]);

  const submit = (text?: string) => {
    const value = (text ?? draft).trim();
    // Un adjunto pendiente (imagen) basta para enviar: el turno puede ir solo
    // con la imagen, sin texto.
    if ((!value && !(view?.attachments.length ?? 0)) || view?.sending) return;
    setDraft("");
    // Enviar implica querer ver la respuesta: se recupera el seguimiento aunque
    // estuvieras leyendo hacia arriba.
    scrollToBottom();
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
          toast.info(t("update.available", { version: u.version }), {
            description: t("update.hint"),
          });
        }
      })
      .catch(() => {
        /* sin red o feed sin configurar: silencio */
      });
  }, [ready]);

  // Drag & drop en TODA la ventana (no solo el composer).
  const [dragOver, setDragOver] = useState(false);
  /**
   * Profundidad de `dragenter`/`dragleave`: al pasar por encima de los hijos
   * llegan pares enter/leave que, contados mal, dejaban el overlay pegado. El
   * composer además frena el `drop` (él ya adjunta), así que aquí solo se baja.
   */
  const dragDepth = useRef(0);
  const hasFiles = (e: React.DragEvent) => Boolean(e.dataTransfer?.types?.includes("Files"));
  const handleDragOver = (e: React.DragEvent) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    setDragOver(true);
  };
  const handleDragEnter = (e: React.DragEvent) => {
    if (!hasFiles(e)) return;
    dragDepth.current += 1;
    setDragOver(true);
  };
  const handleDragLeave = (e: React.DragEvent) => {
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    // Saliendo de la ventana no queda ningún hijo bajo el puntero: se limpia.
    if (dragDepth.current === 0 || !e.relatedTarget) setDragOver(false);
  };
  const handleDrop = (e: React.DragEvent) => {
    // El composer ya gestionó el drop (adjunta él mismo): no duplicar. Se mira
    // ANTES del `preventDefault` propio.
    const handledByComposer = e.defaultPrevented || e.nativeEvent.defaultPrevented;
    e.preventDefault();
    dragDepth.current = 0;
    setDragOver(false);
    if (handledByComposer) return;
    const files = Array.from(e.dataTransfer.files ?? []);
    if (files.length) {
      logAction("attach.drop", { count: files.length });
      void addFiles(files);
    }
  };

  return (
    <TooltipProvider delayDuration={200}>
      <div
        className="dashboard-shell-overlay flex h-full min-h-0 w-full overflow-hidden"
        onDragOver={handleDragOver}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {dragOver && (
          <div className="pointer-events-none fixed inset-0 z-[90] grid place-items-center bg-[var(--background)]/70 text-sm text-violet">
            {t("drop.hint")}
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
            setNavOpen(false);
          }}
          onOpen={(id, ws) => {
            void openSession(id, ws);
            setNavOpen(false);
          }}
          onClose={(k) => void closeSession(k)}
          onToggleCollapse={() => setCollapsed((c) => !c)}
          onOpenSettings={() => setSettingsOpen(true)}
        />

        <div className="relative min-h-0 min-w-0 flex-1">
          <div className="absolute inset-0 flex min-h-0 min-w-0">
          <main className="flex min-h-0 min-w-0 flex-1 flex-col">
          <header className="flex items-center gap-2 border-b border-dashboard-border-soft px-3 py-2.5 sm:gap-3 sm:px-4">
            {isMobile && (
              <Button
                variant="ghost"
                size="icon"
                className="size-7 shrink-0"
                onClick={() => setNavOpen(true)}
                title={t("sessions.title")}
              >
                <Menu className="size-4" />
              </Button>
            )}

            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">{title}</div>
              <div className="flex min-w-0 items-center gap-1.5 text-[0.68rem] text-muted-foreground">
                <button
                  onClick={() => setExplorerOpen((o) => !o)}
                  title={t("workspace.viewFiles")}
                  className="flex min-w-0 items-center gap-1.5 truncate transition-colors hover:text-foreground"
                >
                  <Folder className="size-3 shrink-0" />
                  <span className="truncate">{workspacePath ? basename(workspacePath) : t("workspace.placeholder")}</span>
                  <span className="shrink-0 opacity-40">·</span>
                  <span className="shrink-0">{ready ? t("status.ready") : t("status.connecting")}</span>
                  {!isTauri() && <span className="shrink-0 opacity-60">· {t("status.demo")}</span>}
                </button>
                <GitStatus workspace={workspacePath} running={metrics?.isRunning} />
              </div>
            </div>

            <WorkspaceActions workspace={workspacePath} />

            <ContextMeter metrics={metrics ?? undefined} />
          </header>

          {!ready && bootError ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
              <p className="text-sm text-destructive">{t("engine.connectError")}</p>
              <p className="max-w-md text-xs text-muted-foreground">{bootError}</p>
              <Button size="sm" className="bg-violet text-white hover:bg-violet/90" onClick={() => void init()}>
                {t("common:actions.retry")}
              </Button>
            </div>
          ) : messages.length === 0 ? (
            <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden">
              <Welcome
                // El parámetro se llama `text` para no tapar el `t()` de traducciones.
                onPick={(text) => void send(text)}
                onOpenSession={(id, ws) => void openSession(id, ws)}
              />
            </div>
          ) : (
            <div className="relative min-h-0 flex-1">
              <div ref={scrollRef} className="h-full overflow-y-auto overscroll-contain">
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

              {/* Vuelta al final: el auto-scroll se desactiva cuando subes a leer,
                  así que hace falta una salida explícita (con lo que ha entrado). */}
              {!atBottom && (
                <button
                  onClick={() => scrollToBottom()}
                  title={
                    view?.sending ? t("scroll.agentWriting") : t("scroll.toLastMessage")
                  }
                  className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-[var(--dashboard-border)] bg-[var(--phoson-surface-2)] px-3 py-1.5 text-xs text-muted-foreground shadow-lg transition-colors hover:text-foreground"
                >
                  <ArrowDown className="size-3.5" aria-hidden />
                  {t("common:a11y.scrollToBottom")}
                  {unseen > 0 && (
                    <span className="rounded-full bg-violet px-1.5 text-[0.65rem] tabular-nums text-white">
                      {unseen}
                    </span>
                  )}
                </button>
              )}
            </div>
          )}

          <SubagentPanel tasks={view?.subagents ?? []} />

          {/* Bloques de UI vivos de plugins (todo/progress/kv/notice). */}
          <PluginBlocks blocks={Object.values(view?.pluginBlocks ?? {})} />

          {/* Interacciones de plugins (tool `questions` y su fallback select/form):
              el agente espera la respuesta para continuar el turno. */}
          {view?.confirmations
            .filter((c) => (c.kind ?? "bash") !== "bash")
            .map((c) => (
              <InteractionCard
                key={c.requestId}
                request={c}
                onAnswer={(requestId, payload) => void respondInteraction(requestId, payload)}
                onCancel={(requestId) => void respondInteraction(requestId, { cancelled: true })}
              />
            ))}

          {view?.confirmations.filter((c) => (c.kind ?? "bash") === "bash").map((c) => (
            <div
              key={c.requestId}
              role="alertdialog"
              aria-live="assertive"
              aria-label={t("command.confirmLabel")}
              className="dashboard-panel-strong mx-3 mb-2 rounded-xl border p-3 sm:mx-auto sm:w-full sm:max-w-3xl"
            >
              <div className="mb-1 flex items-center gap-2 text-xs font-medium">
                <Sparkles className="size-3.5 text-violet" /> {t("command.runQuestion")}
              </div>
              <pre className="mb-3 overflow-x-auto rounded-md border border-dashboard-border-soft bg-black/20 p-2 text-[0.75rem]">
                {c.command ?? ""}
              </pre>
              <div className="flex flex-wrap gap-2">
                <button
                  className="rounded-md bg-violet px-3 py-1 text-xs text-white"
                  onClick={() => void respondConfirm(c.requestId, "yes")}
                >
                  {t("common:words.yes")}
                </button>
                <button
                  className="rounded-md border border-dashboard-border-soft px-3 py-1 text-xs"
                  onClick={() => void respondConfirm(c.requestId, "always")}
                >
                  {t("command.always")}
                </button>
                <button
                  className="rounded-md border border-dashboard-border-soft px-3 py-1 text-xs text-muted-foreground"
                  onClick={() => void respondConfirm(c.requestId, "no")}
                >
                  {t("common:words.no")}
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
          />
        </main>

          {explorerOpen && (
            <Suspense fallback={null}>
              <FileExplorer
                cwd={cwd}
                onClose={() => setExplorerOpen(false)}
                onSetCwd={(p) => void applyWorkspace(p)}
                onOpenFile={setOpenFile}
                overlay={narrow}
              />
            </Suspense>
          )}
          </div>
        </div>
      </div>

      {settingsMounted && (
        <Suspense fallback={null}>
          <SettingsDialog
            open={settingsOpen}
            onOpenChange={setSettingsOpen}
            sessionId={activeKey}
            onRestartOnboarding={() => {
              setSettingsOpen(false);
              startOnboarding();
            }}
          />
        </Suspense>
      )}
      {openFile && (
        <Suspense fallback={null}>
          <CodeViewer path={openFile} onClose={() => setOpenFile(null)} />
        </Suspense>
      )}
      <CommandPalette
        onOpenSettings={() => setSettingsOpen(true)}
        onToggleExplorer={() => setExplorerOpen((v) => !v)}
      />
      {ready && onboardingNeeded && (
        <Suspense fallback={null}>
          <Onboarding sessionId={activeKey} onDone={finishOnboarding} />
        </Suspense>
      )}
      <Toaster position="bottom-right" />
    </TooltipProvider>
  );
}
