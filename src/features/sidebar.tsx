import { AlertTriangle, Bot, Search, PanelLeft, MessageSquare, Settings, Trash2, Users, X, SquarePen } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ComponentType } from "react";
import { toast } from "sonner";

import { PhosonLogo } from "@/components/phoson-logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { Input } from "@/components/ui/input";
import { phoson } from "@/bridge/client";
import type { SessionMeta } from "@/bridge/protocol";
import { cn } from "@/lib/utils";
import type { SessionView } from "@/stores/session";

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
  /** Abre la sección de swarms de agentes. */
  onOpenSwarm?: () => void;
  /** Sección visible en el área de contenido, para marcar el ítem activo. */
  section?: "chat" | "swarm";
}

function titleOf(view: SessionView | undefined): string {
  const stored = view?.title?.trim();
  if (stored) return stored.length > 34 ? stored.slice(0, 34) + "…" : stored;
  const first = view?.messages.find((m) => m.role === "user")?.text;
  if (first) return first.length > 34 ? first.slice(0, 34) + "…" : first;
  return view?.engineId ? `Sesión ${view.engineId.slice(0, 6)}` : "Nueva sesión";
}

/* ── Piezas reutilizables ──────────────────────────────────────────────── */

function IconButton({
  icon: Icon,
  label,
  onClick,
  className,
}: {
  icon: ComponentType<{ className?: string }>;
  label: string;
  onClick?: () => void;
  className?: string;
}) {
  return (
    <button
      onClick={onClick}
      title={label}
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
  onOpenSwarm,
  section = "chat",
}: SidebarProps) {
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
      toast.success("Sesión eliminada");
    } catch (e) {
      toast.error("No se pudo eliminar la sesión", { description: String(e) });
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
      if (view?.engineId && view.title?.trim()) map.set(view.engineId, view.title.trim());
    }
    return map;
  }, [order, sessions]);

  const rail = collapsed && !mobile;

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
                title="Mostrar barra lateral"
                aria-label="Mostrar barra lateral"
                className="mb-1 grid size-8 place-items-center rounded-lg dashboard-hover"
              >
                <PhosonLogo size={22} showText={false} />
              </button>
              <IconButton icon={SquarePen} label="Nueva sesión" onClick={onNew} />
              <IconButton
                icon={Search}
                label="Buscar sesiones"
                onClick={() => {
                  onToggleCollapse?.();
                  setSearching(true);
                }}
              />
              <IconButton icon={MessageSquare} label="Sesiones" onClick={onToggleCollapse} />
              <IconButton
                icon={Users}
                label="Swarms de agentes"
                onClick={onOpenSwarm}
                className={section === "swarm" ? "bg-[var(--phoson-surface-2)] text-foreground" : undefined}
              />

              <div className="flex-1" />

              <ThemeToggle />
              <IconButton icon={Settings} label="Ajustes" onClick={onOpenSettings} />

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
                  label="Buscar sesiones"
                  onClick={() => {
                    // Al cerrar, limpia el filtro: si no, la lista quedaría
                    // filtrada sin caja visible y sin forma evidente de limpiarla.
                    setQuery("");
                    setSearching((s) => !s);
                  }}
                />
                {onToggleCollapse && (
                  <IconButton icon={PanelLeft} label="Ocultar barra lateral" onClick={onToggleCollapse} />
                )}
                {mobile && (
                  <IconButton icon={X} label="Cerrar" onClick={onDismiss} />
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
                      placeholder="Buscar sesiones…"
                      className="h-8 text-xs"
                    />
                  </div>
                </div>
              )}

              <div className="px-2 pb-1 pt-1">
                <Row icon={SquarePen} label="Nueva sesión" primary onClick={onNew} />
                <Row
                  icon={Users}
                  label="Swarms de agentes"
                  active={section === "swarm"}
                  onClick={onOpenSwarm}
                  trailing={
                    <span className="shrink-0 rounded-full border border-violet/40 bg-violet/10 px-1.5 py-0.5 text-[0.58rem] font-medium text-violet-soft">
                      Pronto
                    </span>
                  }
                />
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto pb-3">
                {openRows.length > 0 && (
                  <>
                    <SectionLabel>Abiertas</SectionLabel>
                    <div className="space-y-0.5 px-2">
                      {openRows.map((key) => (
                        <Row
                          key={key}
                          icon={MessageSquare}
                          label={titleOf(sessions[key])}
                          active={key === activeKey && section === "chat"}
                          onClick={() => onSelect(key)}
                          trailing={
                            <span className="flex shrink-0 items-center gap-1.5">
                              {(sessions[key]?.subagents.length ?? 0) > 0 && (
                                <span
                                  title={`Subagentes en curso (${sessions[key]?.subagents.length})`}
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
                                  title="Esta sesión espera una confirmación"
                                  className="text-amber-500"
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
                    <SectionLabel>Guardadas</SectionLabel>
                    <div className="space-y-0.5 px-2">
                      {savedRows.map((s) => (
                        <Row
                          key={s.id}
                          icon={MessageSquare}
                          label={liveTitles.get(s.id) || s.title || s.id.slice(0, 8)}
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
                                  aria-label="Confirmar eliminar sesión"
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
                                  {deletingId === s.id ? "…" : "Eliminar"}
                                </span>
                                <span
                                  role="button"
                                  tabIndex={0}
                                  aria-label="Cancelar borrado"
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
                                  No
                                </span>
                              </span>
                            ) : (
                              <span className="flex shrink-0 items-center gap-1.5">
                                <span className="text-[0.65rem] text-muted-foreground">
                                  {s.message_count}
                                </span>
                                <span
                                  role="button"
                                  tabIndex={0}
                                  title="Eliminar sesión"
                                  aria-label="Eliminar sesión"
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
                  <p className="px-3 py-4 text-xs text-muted-foreground">Sin resultados.</p>
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
                <IconButton icon={Settings} label="Ajustes" onClick={onOpenSettings} />
              </div>
            </>
          )}
        </div>
      </aside>
    </>
  );
}
