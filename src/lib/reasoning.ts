/**
 * Niveles de esfuerzo de razonamiento — fuente única.
 *
 * Refleja `phoson_llm.schemas.REASONING_EFFORTS` del engine (5 niveles).
 * `null` significa "auto": el engine usa el perfil del modelo.
 */
export const REASONING_EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;

export type ReasoningEffort = (typeof REASONING_EFFORTS)[number];

/** Etiquetas cortas para la UI (es). */
export const EFFORT_LABELS: Record<string, string> = {
  low: "Bajo",
  medium: "Medio",
  high: "Alto",
  xhigh: "Muy alto",
  max: "Máximo",
};

export const effortLabel = (value: string | null | undefined): string =>
  value ? (EFFORT_LABELS[value] ?? value) : "Auto";

/**
 * Color por nivel: un espectro frío → caliente que comunica intensidad
 * (el brand violeta queda en el centro).
 */
export const EFFORT_COLORS: Record<string, string> = {
  low: "#38bdf8", // cielo
  medium: "#5b2eff", // violeta (brand)
  high: "#a855f7", // púrpura
  xhigh: "#f59e0b", // ámbar
  max: "#ef4444", // rojo
};

/** Color neutro para "auto" (sin nivel explícito). */
export const EFFORT_AUTO_COLOR = "#8b8b93";

export const effortColor = (value: string | null | undefined): string =>
  value ? (EFFORT_COLORS[value] ?? EFFORT_AUTO_COLOR) : EFFORT_AUTO_COLOR;


/** Índice 0..4 del nivel, o -1 cuando es "auto". */
export const effortIndex = (value: string | null | undefined): number =>
  value ? REASONING_EFFORTS.indexOf(value as ReasoningEffort) : -1;
