import { AlertTriangle, Bot, Loader2, Search, PanelLeft, MessageSquare, Settings, Trash2, X, SquarePen } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ComponentType } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { PhosonLogo } from "@/components/phoson-logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { Input } from "@/components/ui/input";
import { phoson } from "@/bridge/client";
import type { SessionMeta } from "@/bridge/protocol";
import i18n from "@/lib/i18n";
import { shortcutLabel } from "@/lib/platform";
import { cn } from "@/lib/utils";
import type { SessionView } from "@/stores/session";
import { cleanSessionTitle, truncateTitle } from "@/lib/session-title";

interface SidebarProps {
  activeKey: string | null;
  order: string[];
  sessions: Record<string, SessionView>;
  model?: string;
  provider?: string;
  /** Workspace activo: las sesiones guardadas se listan acotadas a él. */
  workspace?: string;
  onSelect: (key: string) => void;
  onNew: () => void;
  onOpen: (engineId: string, workspace?: string) => void;
  onClose: (key: string) => void;
  /** Responsive: en móvil se muestra como cajón superpuesto. */
  mobile?: boolean;
  open?: boolean;
  onDismiss?: () => void;
  /** Escritorio: barra en modo rail (solo iconos). */
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  /** El pie de la barra abre Ajustes (como la cuenta en ChatGPT). */
  onOpenSettings?: () => void;
}

function titleOf(view: SessionView | undefined): string {
  const stored = cleanSessionTitle(view?.title);
  if (stored) return truncateTitle(stored);
  const first = cleanSessionTitle(view?.messages.find((m) => m.role === "user")?.text);
  if (first) return truncateTitle(first);
  // Sin `useTranslation` aquí (no es un componente): se traduce con la instancia.
  return view?.engineId
    ? i18n.t("chrome:sessions.fallbackTitle", { id: view.engineId.slice(0, 6) })
    : i18n.t("chrome:sessions.untitled");
}

/* ── Piezas reutilizables ──────────────────────────────────────────────── */

function IconButton({
  icon: Icon,
  label,
  onClick,
  className,
  /** Atajo que abre la misma acción: se muestra en el tooltip. */
  shortcut,
}: {
  icon: ComponentType<{ className?: string }>;
  label: string;
  onClick?: () => void;
  className?: string;
  shortcut?: string;
}) {
  const { t } = useTranslation("chrome");
  return (
    <button
      onClick={onClick}
      title={shortcut ? t("sidebar.withShortcut", { label, shortcut }) : label}
      aria-label={label}
      className={cn(
        "grid size-8 shrink-0 place-items-center rounded-lg text-muted-foreground transition-colors dashboard-hover hover:text-foreground",
        className,
      )}
    >
      <Icon className="size-[1.05rem]" />
    </button>
  );
}

function Row({
  icon: Icon,
  label,
  active,
  onClick,
  trailing,
  primary,
}: {
  icon: ComponentType<{ className?: string }>;
  label: string;
  active?: boolean;
  onClick?: () => void;
  trailing?: React.ReactNode;
  primary?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "group flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-[0.8125rem] transition-colors",
        active
          ? "bg-[var(--phoson-surface-2)] text-foreground"
          : "text-foreground/85 dashboard-hover",
        primary && "text-foreground",
      )}
    >
      <Icon className="size-[1.05rem] shrink-0 opacity-80" />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {trailing}
    </button>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-2.5 pb-1 pt-4 text-[0.7rem] font-medium text-muted-foreground">
      {children}
    </div>
  );
}

/** Indicador de sesión «running»: el agente está generando respuesta. */
function RunningDot() {
  const { t } = useTranslation("chrome");
  return (
    <span title={t("sessions.generating")} className="shrink-0 text-violet">
      <Loader2 className="size-3 animate-spin" />
    </span>
  );
}

/* ── Barra lateral ─────────────────────────────────────────────────────── */

export function Sidebar({
  activeKey,
  order,
  sessions,
  model,
  provider,
  workspace,
  onSelect,
  onNew,
  onOpen,
  onClose,
  mobile = false,
  open = false,
  onDismiss,
  collapsed = false,
  onToggleCollapse,
  onOpenSettings,
}: SidebarProps) {
  // `common` entra en el array para poder reutilizar sus claves (`common:…`).
  const { t } = useTranslation(["chrome", "common"]);
  const [saved, setSaved] = useState<SessionMeta[]>([]);
  /** Sesión pendiente de confirmar borrado (confirmación en dos pasos). */
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  // Enfoca (y selecciona) el input cuando se abre el buscador.
  useEffect(() => {
    if (searching) searchRef.current?.focus();
  }, [searching]);

  // El cajón móvil se cierra con Escape (además del overlay).
  useEffect(() => {
    if (!mobile || !open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onDismiss?.();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [mobile, open, onDismiss]);

  useEffect(() => {
    phoson
      .listSessions()
      .then((r) => setSaved(r.sessions ?? []))
      .catch(() => setSaved([]));
    // Historial global: se refresca al cambiar de workspace para reflejar
    // sesiones recién guardadas en cualquier proyecto.
  }, [workspace]);

  const deleteSaved = async (id: string) => {
    setDeletingId(id);
    try {
      await phoson.deleteSession(id);
      setSaved((list) => list.filter((s) => s.id !== id));
      toast.success(t("sessions.deleted"));
    } catch (e) {
      toast.error(t("sessions.deleteError"), { description: String(e) });
    } finally {
      setDeletingId(null);
      setConfirmId(null);
    }
  };

  const q = query.trim().toLowerCase();

  const openRows = useMemo(
    () =>
      order.filter((k) => (q ? titleOf(sessions[k]).toLowerCase().includes(q) : true)),
    [order, sessions, q],
  );
  const savedRows = useMemo(
    () =>
      saved.filter((s) =>
        q ? `${s.title} ${s.id}`.toLowerCase().includes(q) : true,
      ),
    [saved, q],
  );

  // Título "vivo" de las sesiones abiertas (por id de engine) para que la lista
  // de guardadas muestre el título del modelo sin recargar la lista.
  const liveTitles = useMemo(() => {
    const map = new Map<string, string>();
    for (const key of order) {
      const view = sessions[key];
      if (view?.engineId && cleanSessionTitle(view.title)) {
        map.set(view.engineId, cleanSessionTitle(view.title));
      }
    }
    return map;
  }, [order, sessions]);

  // Sesiones abiertas indexadas por id de engine: de ahí sale el indicador
  // «running» de las guardadas (p. ej. un turno lanzado y luego navegado).
  const liveById = useMemo(() => {
    const map = new Map<string, SessionView>();
    for (const key of order) {
      const view = sessions[key];
      if (view?.engineId) map.set(view.engineId, view);
    }
    return map;
  }, [order, sessions]);

  const rail = collapsed && !mobile;

  // Marca de producto («Phoson Desktop»): los literales no se traducen.
  const brandBlock = (
    <div className="flex min-w-0 items-baseline gap-2">
      <span className="text-sm font-semibold tracking-tight">Phoson</span>
      <span className="truncate text-[0.7rem] text-muted-foreground">Desktop</span>
    </div>
  );

  return (
    <>
      {mobile && open && (
        <div
          className="fixed inset-0 z-40 bg-black/50 backdrop-blur-[1px]"
          onClick={onDismiss}
          aria-hidden
        />
      )}

      <aside
        aria-hidden={mobile && !open}
        // Cerrado en móvil: fuera del orden de tabulación (si no, se tabula a
        // botones "invisibles" tras el `-translate-x-full`).
        inert={mobile && !open}
        className={cn(
          "app-sidebar dashboard-panel shrink-0 overflow-hidden",
          mobile
            ? "fixed inset-y-0 left-0 z-50 w-64 transition-transform duration-200 ease-out"
            : "transition-[width] duration-200 ease-out",
          mobile
            ? open
              ? "translate-x-0"
              : "-translate-x-full"
            : rail
              ? "w-14"
              : "w-64",
        )}
      >
        <div className="flex h-full w-full flex-col border-r border-[var(--dashboard-border)]">
          {rail ? (
            /* ── Rail: solo iconos (estilo ChatGPT colapsado) ───────────── */
            <div className="flex h-full w-14 flex-col items-center gap-1 py-3">
              <button
                onClick={onToggleCollapse}
                title={t("sidebar.show")}
                aria-label={t("sidebar.show")}
                className="mb-1 grid size-8 place-items-center rounded-lg dashboard-hover"
              >
                <PhosonLogo size={22} showText={false} />
              </button>
              <IconButton icon={SquarePen} label={t("sessions.new")} onClick={onNew} />
              <IconButton
                icon={Search}
                label={t("sessions.search")}
                shortcut={shortcutLabel("K")}
                onClick={() => {
                  onToggleCollapse?.();
                  setSearching(true);
                }}
              />
              <IconButton icon={MessageSquare} label={t("sessions.title")} onClick={onToggleCollapse} />

              <div className="flex-1" />

              <ThemeToggle />
              <IconButton icon={Settings} label={t("sidebar.settings")} onClick={onOpenSettings} />

              {/* El modelo/proveedor son marcas que pone el engine: no se traducen. */}
              <div
                title={model ? `${model}${provider ? " · " + provider : ""}` : "Phoson"}
                className="mt-1 grid size-8 shrink-0 place-items-center rounded-full border border-[var(--dashboard-border)]"
              >
                <PhosonLogo size={16} showText={false} />
              </div>
            </div>
          ) : (
            /* ── Barra completa ─────────────────────────────────────────── */
            <>
              <div className="flex items-center gap-1 px-3 pb-1 pt-3">
                <div className="min-w-0 flex-1 pl-1">{brandBlock}</div>
                <IconButton
                  icon={Search}
                  label={t("sessions.search")}
                  shortcut={shortcutLabel("K")}
                  onClick={() => {
                    // Al cerrar, limpia el filtro: si no, la lista quedaría
                    // filtrada sin caja visible y sin forma evidente de limpiarla.
                    setQuery("");
                    setSearching((s) => !s);
                  }}
                />
                {onToggleCollapse && (
                  <IconButton icon={PanelLeft} label={t("sidebar.hide")} onClick={onToggleCollapse} />
                )}
                {mobile && (
                  <IconButton icon={X} label={t("common:actions.close")} onClick={onDismiss} />
                )}
              </div>

              {searching && (
                <div className="px-3 pb-1">
                  <div className="relative">
                    <Input
                      ref={searchRef}
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Escape") {
                          e.preventDefault();
                          setSearching(false);
                          setQuery("");
                        }
                      }}
                      placeholder={t("sessions.searchPlaceholder")}
                      className="h-8 text-xs"
                    />
                  </div>
                </div>
              )}

              <div className="px-2 pb-1 pt-1">
                <Row icon={SquarePen} label={t("sessions.new")} primary onClick={onNew} />
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto pb-3">
                {openRows.length > 0 && (
                  <>
                    <SectionLabel>{t("sessions.open")}</SectionLabel>
                    <div className="space-y-0.5 px-2">
                      {openRows.map((key) => (
                        <Row
                          key={key}
                          icon={MessageSquare}
                          label={titleOf(sessions[key])}
                          active={key === activeKey}
                          onClick={() => onSelect(key)}
                          trailing={
                            <span className="flex shrink-0 items-center gap-1.5">
                              {sessions[key]?.sending && <RunningDot />}
                              {(sessions[key]?.subagents.length ?? 0) > 0 && (
                                <span
                                  title={t("sessions.subagents", {
                                    count: sessions[key]?.subagents.length ?? 0,
                                  })}
                                  className="flex items-center gap-0.5 text-violet"
                                >
                                  <Bot className="size-3" />
                                  <span className="text-[0.6rem] tabular-nums">
                                    {sessions[key]?.subagents.length}
                                  </span>
                                </span>
                              )}
                              {(sessions[key]?.confirmations.length ?? 0) > 0 && (
                                <span
                                  title={t("sessions.awaitingAnswer")}
                                  className="text-warning"
                                >
                                  <AlertTriangle className="size-3" />
                                </span>
                              )}
                              <X
                                className="size-3 opacity-0 transition-opacity group-hover:opacity-60"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  void onClose(key);
                                }}
                              />
                            </span>
                          }
                        />
                      ))}
                    </div>
                  </>
                )}

                {savedRows.length > 0 && (
                  <>
                    <SectionLabel>{t("sessions.saved")}</SectionLabel>
                    <div className="space-y-0.5 px-2">
                      {savedRows.map((s) => (
                        <Row
                          key={s.id}
                          icon={MessageSquare}
                          label={liveTitles.get(s.id) || cleanSessionTitle(s.title) || s.id.slice(0, 8)}
                          onClick={() => onOpen(s.id, s.cwd || undefined)}
                          trailing={
                            confirmId === s.id ? (
                              <span
                                className="flex shrink-0 items-center gap-1"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <span
                                  role="button"
                                  tabIndex={0}
                                  aria-label={t("sessions.deleteConfirm")}
                                  onClick={() => void deleteSaved(s.id)}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter" || e.key === " ") {
                                      e.preventDefault();
                                      e.stopPropagation();
                                      void deleteSaved(s.id);
                                    }
                                  }}
                                  className="rounded px-1.5 py-0.5 text-[0.65rem] text-destructive transition-colors hover:bg-destructive/10 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                                >
                                  {deletingId === s.id ? "…" : t("common:actions.delete")}
                                </span>
                                <span
                                  role="button"
                                  tabIndex={0}
                                  aria-label={t("sessions.deleteCancel")}
                                  onClick={() => setConfirmId(null)}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter" || e.key === " ") {
                                      e.preventDefault();
                                      e.stopPropagation();
                                      setConfirmId(null);
                                    }
                                  }}
                                  className="rounded px-1.5 py-0.5 text-[0.65rem] text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                                >
                                  {t("common:words.no")}
                                </span>
                              </span>
                            ) : (
                              <span className="flex shrink-0 items-center gap-1.5">
                                {liveById.get(s.id)?.sending && <RunningDot />}
                                <span className="text-[0.65rem] text-muted-foreground">
                                  {s.message_count}
                                </span>
                                <span
                                  role="button"
                                  tabIndex={0}
                                  title={t("sessions.delete")}
                                  aria-label={t("sessions.delete")}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setConfirmId(s.id);
                                  }}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter" || e.key === " ") {
                                      e.preventDefault();
                                      e.stopPropagation();
                                      setConfirmId(s.id);
                                    }
                                  }}
                                  className="opacity-0 transition-opacity hover:text-destructive focus-visible:opacity-100 group-hover:opacity-80"
                                >
                                  <Trash2 className="size-3" />
                                </span>
                              </span>
                            )
                          }
                        />
                      ))}
                    </div>
                  </>
                )}

                {q && openRows.length === 0 && savedRows.length === 0 && (
                  <p className="px-3 py-4 text-xs text-muted-foreground">{t("sessions.empty")}</p>
                )}
              </div>

              {/* Pie: identidad (modelo/proveedor) + tema y ajustes ────── */}
              <div className="flex items-center gap-0.5 border-t border-[var(--dashboard-border)] px-2 py-2">
                <div className="grid size-7 shrink-0 place-items-center rounded-full border border-[var(--dashboard-border)]">
                  <PhosonLogo size={16} showText={false} />
                </div>
                <div className="min-w-0 flex-1 pl-2 leading-tight">
                  <div className="truncate text-[0.72rem]">{model ?? "—"}</div>
                  <div className="truncate text-[0.62rem] text-muted-foreground">
                    {provider ?? ""}
                  </div>
                </div>
                <ThemeToggle />
                <IconButton icon={Settings} label={t("sidebar.settings")} onClick={onOpenSettings} />
              </div>
            </>
          )}
        </div>
      </aside>
    </>
  );
}
