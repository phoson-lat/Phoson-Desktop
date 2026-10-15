import { Brain } from "lucide-react";
import { useTranslation } from "react-i18next";

import { shimmerTextStyle } from "@/components/ui/reasoning";
import { cn } from "@/lib/utils";

/**
 * Indicador de "Pensando…" para cuando el modelo aún no ha emitido nada
 * (ni razonamiento ni texto). Barrido de brillo + puntos animados, coherente
 * con el bloque `Reasoning` y con el estado de construcción de artifacts.
 *
 * El texto por defecto sale del catálogo; quien lo use puede pasar otro
 * (`label`), ya traducido, para estados concretos (p. ej. construir artifacts).
 */
export function ThinkingIndicator({
  label,
  className,
}: {
  label?: string;
  className?: string;
}) {
  const { t } = useTranslation("chat");
  return (
    <div className={cn("flex items-center gap-2 py-1", className)} aria-live="polite" aria-busy>
      <Brain className="size-4 shrink-0 animate-pulse text-violet" />
      <span className="flex items-center text-sm font-medium">
        <span style={shimmerTextStyle}>{label ?? t("thinking")}</span>
        <span className="phoson-dots ml-0.5 flex text-violet" aria-hidden>
          <span>.</span>
          <span>.</span>
          <span>.</span>
        </span>
      </span>
    </div>
  );
}
