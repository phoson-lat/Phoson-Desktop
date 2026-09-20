import { History, MessageSquare } from "lucide-react";
import { useEffect, useState } from "react";

import { phoson } from "@/bridge/client";
import { PhosonLogo } from "@/components/phoson-logo";
import type { SessionMeta } from "@/bridge/protocol";
import { DEMO_USER } from "@/lib/demo-content";

const SUGGESTIONS = [
  DEMO_USER,
  "Resume la arquitectura de phoson-engine-minimal",
  "¿Cómo desacopla la UI el SessionController?",
  "Lista las sesiones guardadas",
];

interface WelcomeProps {
  onPick: (text: string) => void;
  /** Reabrir una sesión guardada desde la pantalla de bienvenida. */
  onOpenSession?: (engineId: string, workspace?: string) => void;
}

export function Welcome({ onPick, onOpenSession }: WelcomeProps) {
  const [recent, setRecent] = useState<SessionMeta[]>([]);

  useEffect(() => {
    phoson
      .listSessions()
      .then((r) =>
        setRecent(
          [...(r.sessions ?? [])]
            .sort((a, b) => (b.updated_at ?? "").localeCompare(a.updated_at ?? ""))
            .slice(0, 4),
        ),
      )
      .catch(() => setRecent([]));
  }, []);

  return (
    <div className="flex h-full flex-col items-center justify-center gap-6 px-6 text-center">
      <div className="animate-welcome-icon">
        <PhosonLogo size={72} animated showText={false} />
      </div>
      <div className="space-y-2">
        <h1 className="animate-welcome-greeting text-xl font-semibold tracking-tight">
          Phoson Desktop
        </h1>
        <p className="animate-welcome-subtitle max-w-md text-sm text-muted-foreground">
          Tu agente autónomo, en el escritorio. Mismo engine y mismos plugins que el{" "}
          <span className="text-violet-soft">phoson-cli</span>.
        </p>
      </div>

      {recent.length > 0 && onOpenSession && (
        <div className="w-full max-w-lg">
          <div className="mb-1.5 flex items-center gap-1.5 px-1 text-[0.62rem] uppercase tracking-wide text-muted-foreground">
            <History className="size-3" /> Recientes
          </div>
          <div className="grid w-full grid-cols-1 gap-2 sm:grid-cols-2">
            {recent.map((s) => (
              <button
                key={s.id}
                onClick={() => onOpenSession(s.id, s.cwd || undefined)}
                title={s.title || s.id}
                className="dashboard-panel flex items-center gap-2 rounded-xl border px-3 py-2 text-left text-xs text-muted-foreground transition-colors hover:text-foreground"
              >
                <MessageSquare className="size-3.5 shrink-0 text-violet" />
                <span className="truncate">{s.title || s.id.slice(0, 8)}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="animate-welcome-recent grid w-full max-w-lg grid-cols-1 gap-2 sm:grid-cols-2">
        {SUGGESTIONS.map((s) => (
          <button
            key={s}
            onClick={() => onPick(s)}
            className="dashboard-panel rounded-xl border px-3 py-2 text-left text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}
