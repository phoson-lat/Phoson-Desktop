/**
 * Placeholder de sección «próximamente». Se usa mientras una feature no está
 * lista para la alpha (hoy: swarms). Mantiene la navegación visible para que se
 * vea que llega, sin mostrar una UI que promete más de lo que hace.
 */

import { ArrowLeft, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";

interface ComingSoonProps {
  title: string;
  note?: string;
  /** Vuelve a la conversación. */
  onExit?: () => void;
}

export function ComingSoon({ title, note, onExit }: ComingSoonProps) {
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <header className="flex items-center gap-2 border-b border-dashboard-border-soft px-3 py-2 sm:px-4">
        {onExit && (
          <Button
            variant="ghost"
            size="sm"
            className="h-8 shrink-0 px-2 text-muted-foreground"
            onClick={onExit}
            title="Volver a la conversación"
          >
            <ArrowLeft className="size-4" />
            <span className="hidden sm:inline">Volver</span>
          </Button>
        )}
        <span className="text-sm font-medium">{title}</span>
        <span className="ml-1 rounded-full border border-violet/40 bg-violet/10 px-2 py-0.5 text-[0.62rem] font-medium text-violet-soft">
          Próximamente
        </span>
      </header>

      <div className="grid min-h-0 flex-1 place-items-center p-6">
        <div className="max-w-md text-center">
          <span className="mx-auto grid size-12 place-items-center rounded-2xl bg-violet/10 text-violet">
            <Sparkles className="size-6" />
          </span>
          <h2 className="mt-4 text-base font-semibold">Aún no está listo</h2>
          <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
            {note ??
              "Esta sección llegará en una próxima versión. Estamos afinando la base antes de abrirla."}
          </p>
        </div>
      </div>
    </div>
  );
}
