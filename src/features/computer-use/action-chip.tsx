/**
 * Action chips de computer use en el thread y su bloque agrupado.
 *
 * A diferencia de la fila genérica de tools, cada acción `computer_*` muestra
 * un RECORTE del screenshot alrededor del punto donde actuó (el «hizo clic
 * aquí» con evidencia visual) y abre el viewport al pulsarla. Las acciones
 * consecutivas se agrupan en `ComputerSessionBlock` («Sesión de control · N
 * acciones») para no fragmentar el hilo.
 */
import { AlertTriangle, Check, ChevronRight, Loader2, Monitor } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { latestFrame, useComputerUse, type CuFrame } from "@/stores/computer-use";
import { toolDetail, toolPresentation } from "@/lib/tool-labels";
import { shimmerTextStyle } from "@/components/ui/reasoning";
import { cn } from "@/lib/utils";
import type { ToolCard } from "@/stores/session";

/** Tamaño del recorte (px) y región de imagen que abarca (px del frame). */
const THUMB_W = 64;
const THUMB_H = 40;
const CROP_W = 320;

/**
 * Recorte del frame centrado en (x, y) vía background-position. Sin punto
 * (type/key/wait) muestra el frame entero reducido; sin frame, un icono.
 */
function CropThumb({ tool, frame }: { tool: ToolCard; frame: CuFrame | null }) {
  const args = tool.args as Record<string, unknown> | undefined;
  const x = typeof args?.x === "number" ? args.x : undefined;
  const y = typeof args?.y === "number" ? args.y : undefined;

  if (!frame) {
    return (
      <span className="grid size-10 shrink-0 place-items-center rounded-md border border-violet-soft/30 bg-violet/10">
        <Monitor className="size-4 text-violet-soft/70" />
      </span>
    );
  }
  const hasPoint = x != null && y != null;
  const scale = hasPoint ? THUMB_W / CROP_W : THUMB_W / frame.width;
  const bgW = frame.width * scale;
  const bgH = frame.height * scale;
  const posX = hasPoint ? -(x * scale - THUMB_W / 2) : 0;
  const posY = hasPoint ? -(y * scale - THUMB_H / 2) : -(frame.height * scale - THUMB_H) / 2;
  return (
    <span
      className="relative shrink-0 overflow-hidden rounded-md border border-violet-soft/40"
      style={{
        width: THUMB_W,
        height: THUMB_H,
        backgroundImage: `url(${frame.dataUrl})`,
        backgroundSize: `${bgW}px ${bgH}px`,
        backgroundPosition: `${posX}px ${posY}px`,
        backgroundRepeat: "no-repeat",
      }}
    >
      {hasPoint && (
        <>
          {/* Crosshair sobre el punto exacto de la acción */}
          <span className="absolute left-1/2 top-0 h-full w-px bg-violet-soft/70" />
          <span className="absolute left-0 top-1/2 h-px w-full bg-violet-soft/70" />
          <span className="absolute left-1/2 top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-violet-soft bg-violet/40" />
        </>
      )}
    </span>
  );
}

/** Chip de una acción `computer_*` (sustituye a la fila genérica de tool). */
export function ComputerActionChip({ tool }: { tool: ToolCard }) {
  const { t } = useTranslation("chat");
  // El recorte sale del frame que el agente veía AL ACTUAR (su `frameId`), no
  // del último recibido: una acción sobre el escritorio no debe recortar la
  // captura del navegador que vino después.
  const frame = useComputerUse((s) => {
    const action = s.actions.find((a) => a.id === tool.id);
    return s.frames.find((f) => f.id === action?.frameId) ?? latestFrame(s);
  });
  const openPanel = useComputerUse((s) => s.openPanel);
  const presentation = useMemo(() => toolPresentation(tool.name, t), [tool.name, t]);
  const detail = useMemo(
    () => toolDetail(tool.name, tool.args as Record<string, unknown> | undefined),
    [tool.name, tool.args],
  );
  const Status =
    tool.status === "running" ? Loader2 : tool.status === "error" ? AlertTriangle : Check;

  return (
    <button
      onClick={openPanel}
      title={t("computerUse.panel.open")}
      className="my-1 flex w-full items-center gap-2.5 rounded-lg border border-violet-soft/25 bg-violet/[0.06] px-2 py-1.5 text-left text-xs transition-colors hover:border-violet-soft/50 hover:bg-violet/[0.12]"
    >
      <CropThumb tool={tool} frame={frame} />
      <presentation.icon className="size-3.5 shrink-0 text-violet-soft" />
      <span
        className="min-w-0 truncate"
        style={tool.status === "running" ? shimmerTextStyle : undefined}
      >
        {presentation.verb}
      </span>
      {detail ? (
        <span className="min-w-0 truncate font-mono text-[0.68rem] text-muted-foreground">
          · {detail}
        </span>
      ) : null}
      <Status
        className={cn(
          "ml-auto size-3.5 shrink-0",
          tool.status === "running" && "animate-spin text-violet",
          tool.status === "done" && "text-success",
          tool.status === "error" && "text-destructive",
        )}
      />
    </button>
  );
}

/**
 * Bloque colapsable que agrupa una ráfaga de acciones `computer_*`
 * consecutivas: «Sesión de control · N acciones». Abierto por defecto (la
 * demo y el control en vivo quieren verse); se cierra con el chevrón.
 */
export function ComputerSessionBlock({ tools }: { tools: ToolCard[] }) {
  const { t } = useTranslation("chat");
  const [open, setOpen] = useState(true);
  const running = tools.some((tool) => tool.status === "running");

  return (
    <div className="my-1.5 rounded-xl border border-violet-soft/30 bg-violet/[0.04] shadow-[0_0_24px_color-mix(in_srgb,var(--violet)_8%,transparent)]">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 rounded-t-xl px-3 py-2 text-left text-xs"
      >
        <ChevronRight
          className={cn("size-3 text-violet-soft transition-transform", open && "rotate-90")}
        />
        <Monitor className="size-3.5 text-violet-soft" />
        <span className="font-medium text-violet-soft">{t("computerUse.group.title")}</span>
        <span className="text-muted-foreground">
          · {t("computerUse.panel.actions", { count: tools.length })}
        </span>
        {running && <Loader2 className="ml-auto size-3 animate-spin text-violet" />}
      </button>
      {open && (
        <div className="border-t border-violet-soft/15 px-2 pb-1.5 pt-0.5">
          {tools.map((tool) => (
            <ComputerActionChip key={tool.id} tool={tool} />
          ))}
        </div>
      )}
    </div>
  );
}
