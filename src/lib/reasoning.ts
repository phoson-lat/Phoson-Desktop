/**
 * Niveles de esfuerzo de razonamiento — fuente única.
 *
 * Refleja `phoson_llm.schemas.REASONING_EFFORTS` del engine (5 niveles).
 * `null` significa "auto": el engine usa el perfil del modelo.
 *
 * Las etiquetas ya no viven aquí: son UI y van al catálogo
 * (`system:effort.<nivel>`). La unión de niveles con etiqueta se deriva del
 * propio JSON `es`, así que una clave que falte rompe `tsc`.
 */

import i18n from "@/lib/i18n";
import system from "@/locales/es/system.json";

export const REASONING_EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;

export type ReasoningEffort = (typeof REASONING_EFFORTS)[number];

/**
 * Niveles con etiqueta en el catálogo (`effort.low`, `effort.high`…): la
 * intersección entre los ids del engine y las claves del JSON.
 */
type EffortLabelKey = Extract<keyof typeof system.effort, ReasoningEffort>;

/**
 * `true` si el nivel tiene etiqueta en el catálogo; si no, se pinta el id.
 */
const isEffortLabelKey = (value: string): value is EffortLabelKey =>
  (REASONING_EFFORTS as readonly string[]).includes(value);

/**
 * Etiqueta corta del nivel, en el idioma activo **en el momento de la llamada**
 * (no se fija al importar el módulo): quien la pinte solo tiene que volver a
 * renderizar al cambiar de idioma — lo que ya hace `useTranslation` en los
 * componentes que la consumen.
 *
 * Un valor desconocido (engine más nuevo que la UI) se pinta tal cual: es el id,
 * lo único que hay que enseñar.
 */
export const effortLabel = (value: string | null | undefined): string => {
  if (!value) return i18n.t("system:effort.auto");
  return isEffortLabelKey(value) ? i18n.t(`system:effort.${value}`) : value;
};

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
