import { diffStats, type DiffRow } from "@/lib/diff";
import { cn } from "@/lib/utils";

interface DiffViewProps {
  rows: DiffRow[];
  /** Ruta del archivo (cabecera, monoespaciada). */
  path?: string;
  /** Nota corta a la derecha de la cabecera (p. ej. «archivo completo»). */
  note?: string;
  /** Máximo de líneas renderizadas; el resto se resume en el pie. */
  maxLines?: number;
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

/**
 * Vista de diff unificado para los tool cards de edición (`patch_file`,
 * `write_file`): numeración doble, líneas añadidas/borradas con fondo y
 * cabeceras `@@ … @@`, en vez del volcado en crudo del resultado.
 */
export function DiffView({ rows, path, note, maxLines = 300, className }: DiffViewProps) {
  if (rows.length === 0) return null;

  const shown = rows.slice(0, maxLines);
  const hidden = rows.length - shown.length;
  const { adds, dels } = diffStats(rows);

  return (
    <div className={cn("mt-1", className)}>
      <div className="flex items-baseline gap-2 text-[0.65rem] text-muted-foreground">
        {path ? <span className="truncate font-mono">{path}</span> : null}
        <span className="ml-auto shrink-0 tabular-nums">
          <span className="text-emerald-600 dark:text-emerald-400">+{adds}</span>
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
            )}
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
            … +{hidden} líneas más
          </div>
        ) : null}
      </div>
    </div>
  );
}
