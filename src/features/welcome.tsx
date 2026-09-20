import { PhosonLogo } from "@/components/phoson-logo";
import { DEMO_USER } from "@/lib/demo-content";

const SUGGESTIONS = [
  DEMO_USER,
  "Resume la arquitectura de phoson-engine-minimal",
  "¿Cómo desacopla la UI el SessionController?",
  "Lista las sesiones guardadas",
];

export function Welcome({ onPick }: { onPick: (text: string) => void }) {
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
