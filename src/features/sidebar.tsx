import { Plus, MessageSquare, History, X, Circle } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
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
  onSelect: (key: string) => void;
  onNew: () => void;
  onOpen: (engineId: string) => void;
  onClose: (key: string) => void;
  /** Responsive: en móvil se muestra como cajón superpuesto. */
  mobile?: boolean;
  open?: boolean;
  onDismiss?: () => void;
  /** Escritorio: barra colapsada (ancho 0, animado). */
  collapsed?: boolean;
}

function titleOf(view: SessionView | undefined): string {
  const first = view?.messages.find((m) => m.role === "user")?.text;
  if (first) return first.length > 34 ? first.slice(0, 34) + "…" : first;
  return view?.engineId ? `Sesión ${view.engineId.slice(0, 6)}` : "Nueva sesión";
}

export function Sidebar({
  activeKey,
  order,
  sessions,
  model,
  provider,
  onSelect,
  onNew,
  onOpen,
  onClose,
  mobile = false,
  open = false,
  onDismiss,
  collapsed = false,
}: SidebarProps) {
  const [saved, setSaved] = useState<SessionMeta[]>([]);

  useEffect(() => {
    phoson
      .listSessions()
      .then((r) => setSaved(r.sessions ?? []))
      .catch(() => setSaved([]));
  }, []);

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
        className={cn(
          "app-sidebar dashboard-panel shrink-0 overflow-hidden",
          mobile
            ? "fixed inset-y-0 left-0 z-50 w-64 transition-transform duration-200 ease-out"
            : "transition-[width] duration-200 ease-out",
          mobile ? (open ? "translate-x-0" : "-translate-x-full") : collapsed ? "w-0" : "w-64",
        )}
      >
        <div className="flex h-full w-64 flex-col border-r border-[var(--dashboard-border)]">
      <div className="px-3 pt-3">
        <Button
          onClick={onNew}
          className="w-full justify-start gap-2 bg-violet text-white hover:bg-violet/90"
          size="sm"
        >
          <Plus className="size-4" /> Nueva sesión
        </Button>
      </div>

      <ScrollArea className="mt-3 flex-1">
        <div className="px-3 pb-4">
          <div className="px-1 pb-1 text-[0.68rem] font-medium uppercase tracking-wide text-muted-foreground">
            Abiertas
          </div>
          <div className="space-y-0.5">
            {order.map((key) => (
              <button
                key={key}
                onClick={() => onSelect(key)}
                className={cn(
                  "group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors",
                  key === activeKey ? "dashboard-active text-foreground" : "text-muted-foreground dashboard-hover",
                )}
              >
                <MessageSquare className="size-3.5 shrink-0 text-violet" />
                <span className="flex-1 truncate">{titleOf(sessions[key])}</span>
                <X
                  className="size-3 shrink-0 opacity-0 transition-opacity group-hover:opacity-70"
                  onClick={(e) => {
                    e.stopPropagation();
                    onClose(key);
                  }}
                />
              </button>
            ))}
          </div>

          {saved.length > 0 && (
            <>
              <div className="mt-4 px-1 pb-1 text-[0.68rem] font-medium uppercase tracking-wide text-muted-foreground">
                Guardadas
              </div>
              <div className="space-y-0.5">
                {saved.slice(0, 12).map((s) => (
                  <button
                    key={s.id}
                    onClick={() => onOpen(s.id)}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-muted-foreground dashboard-hover"
                    title={s.title || s.id}
                  >
                    <History className="size-3.5 shrink-0" />
                    <span className="flex-1 truncate">{s.title || s.id.slice(0, 8)}</span>
                    <span className="shrink-0 text-[0.62rem] opacity-50">
                      {s.message_count}
                    </span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </ScrollArea>

      <div className="flex items-center gap-2 border-t border-dashboard-border-soft px-3 py-2 text-[0.68rem] text-muted-foreground">
        <Circle className="size-2 fill-emerald-400 text-emerald-400" />
        <span className="flex-1 truncate">{model ?? "—"}</span>
        <span className="truncate opacity-70">{provider ?? ""}</span>
      </div>
        </div>
    </aside>
    </>
  );
}
