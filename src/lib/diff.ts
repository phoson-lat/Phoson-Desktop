/**
 * Diff unificado de líneas, sin dependencias externas.
 *
 * El CLI ya renderiza un diff para `patch_file` (phoson_cli/formatting.py,
 * `unified_diff`); aquí se replica en TS para el tool card del escritorio, con
 * la misma semántica (`@@ -a,b +c,d @@`, contexto de 3 líneas) y un guardia de
 * tamaño: un LCS O(n·m) sobre archivos enormes congelaría la UI, así que por
 * encima del tope se cae a "bloque completo" (borradas + añadidas), que sigue
 * siendo correcto aunque menos fino.
 */

export type DiffRowKind = "ctx" | "add" | "del" | "hunk";

export interface DiffRow {
  kind: DiffRowKind;
  text: string;
  /** Línea en la versión original (solo `ctx` y `del`). */
  oldLine?: number;
  /** Línea en la versión nueva (solo `ctx` y `add`). */
  newLine?: number;
}

type Op = { kind: "ctx" | "add" | "del"; text: string };

/** Tope de celdas del LCS (n·m) antes de degradar a bloque completo. */
const MAX_CELLS = 4_000_000;

/** Líneas de un texto, normalizando CRLF/CR y sin la vacía final. */
export const splitLines = (text: string): string[] => {
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = normalized.split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines;
};

/** LCS clásico (tabla plana) → secuencia de operaciones en orden de lectura. */
function lcsOps(a: string[], b: string[]): Op[] {
  const n = a.length;
  const m = b.length;
  const width = m + 1;
  const table = new Uint32Array((n + 1) * width);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      table[i * width + j] =
        a[i] === b[j]
          ? table[(i + 1) * width + (j + 1)] + 1
          : Math.max(table[(i + 1) * width + j], table[i * width + (j + 1)]);
    }
  }
  const ops: Op[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ kind: "ctx", text: a[i] });
      i++;
      j++;
    } else if (table[(i + 1) * width + j] >= table[i * width + (j + 1)]) {
      ops.push({ kind: "del", text: a[i] });
      i++;
    } else {
      ops.push({ kind: "add", text: b[j] });
      j++;
    }
  }
  while (i < n) ops.push({ kind: "del", text: a[i++] });
  while (j < m) ops.push({ kind: "add", text: b[j++] });
  return ops;
}

function diffOps(oldLines: string[], newLines: string[]): Op[] {
  const n = oldLines.length;
  const m = newLines.length;

  // Prefijo y sufijo idénticos no necesitan LCS (y suelen ser la mayoría).
  let start = 0;
  while (start < n && start < m && oldLines[start] === newLines[start]) start++;
  let endOld = n;
  let endNew = m;
  while (endOld > start && endNew > start && oldLines[endOld - 1] === newLines[endNew - 1]) {
    endOld--;
    endNew--;
  }

  const ops: Op[] = [];
  for (let i = 0; i < start; i++) ops.push({ kind: "ctx", text: oldLines[i] });

  const a = oldLines.slice(start, endOld);
  const b = newLines.slice(start, endNew);
  if (a.length * b.length > MAX_CELLS) {
    for (const line of a) ops.push({ kind: "del", text: line });
    for (const line of b) ops.push({ kind: "add", text: line });
  } else {
    ops.push(...lcsOps(a, b));
  }

  for (let i = endOld; i < n; i++) ops.push({ kind: "ctx", text: oldLines[i] });
  return ops;
}

/** Filas de un diff unificado; `[]` cuando no hay cambios. */
export function unifiedDiffRows(
  oldText: string,
  newText: string,
  contextLines = 3,
): DiffRow[] {
  if (oldText === newText) return [];

  const raw: DiffRow[] = [];
  let oldNo = 1;
  let newNo = 1;
  for (const op of diffOps(splitLines(oldText), splitLines(newText))) {
    if (op.kind === "del") raw.push({ kind: "del", text: op.text, oldLine: oldNo++ });
    else if (op.kind === "add") raw.push({ kind: "add", text: op.text, newLine: newNo++ });
    else raw.push({ kind: "ctx", text: op.text, oldLine: oldNo++, newLine: newNo++ });
  }
  if (raw.length === 0) return [];

  // Solo se muestran las líneas cercanas a un cambio (± contexto), como en un
  // diff unificado: el resto se resume en la cabecera de cada hunk.
  const keep = new Array<boolean>(raw.length).fill(false);
  raw.forEach((row, index) => {
    if (row.kind === "ctx") return;
    const from = Math.max(0, index - contextLines);
    const to = Math.min(raw.length - 1, index + contextLines);
    for (let k = from; k <= to; k++) keep[k] = true;
  });

  const rows: DiffRow[] = [];
  let i = 0;
  while (i < raw.length) {
    if (!keep[i]) {
      i++;
      continue;
    }
    let end = i;
    while (end + 1 < raw.length && keep[end + 1]) end++;

    let oldStart = 0;
    let newStart = 0;
    let oldCount = 0;
    let newCount = 0;
    for (let k = i; k <= end; k++) {
      const row = raw[k];
      if (row.kind !== "add") {
        oldCount++;
        if (!oldStart) oldStart = row.oldLine ?? 0;
      }
      if (row.kind !== "del") {
        newCount++;
        if (!newStart) newStart = row.newLine ?? 0;
      }
    }
    // Un hunk que abre con una adición/borrado no tiene ese número: se deriva
    // de la línea anterior del archivo.
    if (!oldStart) oldStart = (raw[i - 1]?.oldLine ?? 0) + 1;
    if (!newStart) newStart = (raw[i - 1]?.newLine ?? 0) + 1;

    rows.push({ kind: "hunk", text: `@@ -${oldStart},${oldCount} +${newStart},${newCount} @@` });
    for (let k = i; k <= end; k++) rows.push(raw[k]);
    i = end + 1;
  }
  return rows;
}

/** Todas las líneas de un texto como adiciones (`write_file` de un archivo). */
export function additionsRows(text: string): DiffRow[] {
  return splitLines(text).map((line, index) => ({
    kind: "add" as const,
    text: line,
    newLine: index + 1,
  }));
}

/** Conteo de añadidas/borradas de un diff. */
export const diffStats = (rows: DiffRow[]): { adds: number; dels: number } => {
  let adds = 0;
  let dels = 0;
  for (const row of rows) {
    if (row.kind === "add") adds++;
    else if (row.kind === "del") dels++;
  }
  return { adds, dels };
};
