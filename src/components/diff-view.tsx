import { useTranslation } from "react-i18next";

import { diffStats, type DiffRow } from "@/lib/diff";
import { cn } from "@/lib/utils";

interface DiffViewProps {
  rows: DiffRow[];
  /** Ruta del archivo (cabecera, monoespaciada). */
  path?: string;
  /** Nota corta a la derecha de la cabecera (p. ej. «archivo completo»). */
  note?: string;
  /**
   * Máximo de filas renderizadas (cabeceras `@@ … @@` incluidas); el corte cae
   * en frontera de hunk y el resto se resume en el pie, contando solo líneas de
   * contenido (ctx/add/del).
   */
  maxLines?: number;
  /** Si se pasa, las líneas con número nuevo son clicables (abrir en esa línea). */
  onOpenLine?: (line: number) => void;
  /** Etiqueta del tooltip de las líneas clicables (por defecto, abrir en el editor). */
  lineTitle?: string;
  className?: string;
}

/** Estilos por tipo de línea (el look de diff: fondo en + y −). */
const ROW_CLASS: Record<DiffRow["kind"], string> = {
  add: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  del: "bg-destructive/10 text-destructive",
  ctx: "text-muted-foreground",
  hunk: "text-violet",
};

const SIGN: Record<DiffRow["kind"], string> = { add: "+", del: "−", ctx: " ", hunk: "" };

/** Filas con contenido del diff (las cabeceras `@@ … @@` no cuentan). */
const isBodyRow = (row: DiffRow): boolean => row.kind !== "hunk";

/**
 * Índice de corte para `maxLines` respetando la frontera de hunk: si el corte
 * caería dejando la cabecera `@@ … @@` de un hunk sin cuerpo, se retrocede al
 * inicio de ese hunk (la cabecera huérfana desaparece con él).
 */
function hunkAlignedCut(rows: DiffRow[], maxLines: number): number {
  if (rows.length <= maxLines) return rows.length;
  let cut = Math.max(0, maxLines);
  while (cut > 0 && !isBodyRow(rows[cut - 1])) cut--;
  return cut;
}

/**
 * Vista de diff unificado para los tool cards de edición (`patch_file`,
 * `write_file`): numeración doble, líneas añadidas/borradas con fondo y
 * cabeceras `@@ … @@`, en vez del volcado en crudo del resultado.
 */
export function DiffView({ rows, path, note, maxLines = 300, onOpenLine, lineTitle, className }: DiffViewProps) {
  // El hook va antes del return temprano: los hooks no pueden quedar tras un `return`.
  const { t } = useTranslation("tools");
  if (rows.length === 0) return null;

  const shown = rows.slice(0, hunkAlignedCut(rows, maxLines));
  // Solo cuentan las filas ctx/add/del: las cabeceras de hunk no son «líneas».
  const hidden = rows.slice(shown.length).filter(isBodyRow).length;
  const { adds, dels } = diffStats(rows);
  // Con onOpenLine, la línea que abre un clic en una fila `del` es la del ctx/add
  // vecino más cercano (las borradas no existen en la versión nueva).
  const lineFor = (row: DiffRow): number | undefined =>
    row.newLine ?? row.oldLine;

  return (
    <div className={cn("mt-1", className)}>
      <div className="flex items-baseline gap-2 text-[0.65rem] text-muted-foreground">
        {path ? <span className="truncate font-mono">{path}</span> : null}
        <span className="ml-auto shrink-0 tabular-nums">
          <span className="text-success">+{adds}</span>
          <span className="mx-1 opacity-40">/</span>
          <span className="text-destructive">−{dels}</span>
        </span>
        {note ? <span className="shrink-0 opacity-70">{note}</span> : null}
      </div>

      <div className="mt-1 max-h-72 overflow-auto rounded-lg border border-[var(--dashboard-border)] bg-[var(--muted)] py-1 font-mono text-[0.72rem] leading-relaxed">
        {shown.map((row, index) => (
          <div
            key={index}
            className={cn(
              "flex gap-1 whitespace-pre px-2",
              ROW_CLASS[row.kind],
              row.kind === "hunk" && "mt-1 first:mt-0",
              onOpenLine && row.kind !== "hunk" && "cursor-pointer hover:bg-foreground/5",
            )}
            title={onOpenLine && row.kind !== "hunk" ? (lineTitle ?? t("diff.openLine")) : undefined}
            onClick={
              onOpenLine && row.kind !== "hunk"
                ? () => {
                    const line = lineFor(row);
                    if (line) onOpenLine(line);
                  }
                : undefined
            }
          >
            <span className="w-9 shrink-0 select-none text-right opacity-50">
              {row.kind === "hunk" ? "" : (row.oldLine ?? "")}
            </span>
            <span className="w-9 shrink-0 select-none text-right opacity-50">
              {row.kind === "hunk" ? "" : (row.newLine ?? "")}
            </span>
            <span className="w-2 shrink-0 select-none text-center opacity-70">
              {SIGN[row.kind]}
            </span>
            <span className="min-w-0 flex-1">{row.text || " "}</span>
          </div>
        ))}
        {hidden > 0 ? (
          <div className="px-2 pt-1 text-[0.65rem] text-muted-foreground">
            {t("diff.moreLines", { count: hidden })}
          </div>
        ) : null}
      </div>
    </div>
  );
}
