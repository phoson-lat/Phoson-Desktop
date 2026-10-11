/**
 * Marcadores que el engine inyecta como mensajes `user` — compactación,
 * wake autónomo ([MONITOR EVENTS]…) y mensajes entre agentes. Nunca son
 * títulos legibles: si una sesión guardada quedó titulada con uno (versiones
 * anteriores titulaban con el banner de resumen), la UI debe preferir su
 * propio fallback antes que mostrarlo.
 */
const INJECTED_TITLE_PREFIXES = [
  "[Conversation summary",
  "[MONITOR EVENTS]",
  "[BACKGROUND JOB EVENTS]",
  "[PEER MESSAGES]",
];

/** Título real de una sesión, o `""` cuando el guardado es un banner interno. */
export const cleanSessionTitle = (title?: string | null): string => {
  const value = title?.trim() ?? "";
  if (!value) return "";
  return INJECTED_TITLE_PREFIXES.some((prefix) => value.startsWith(prefix)) ? "" : value;
};

/** Recorta un título a `max` caracteres añadiendo elipsis (para listas). */
export const truncateTitle = (title: string, max = 34): string =>
  title.length > max ? `${title.slice(0, max)}…` : title;
