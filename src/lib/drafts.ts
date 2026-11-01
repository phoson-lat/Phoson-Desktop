const STORAGE_KEY = "phoson.drafts";

/** Borradores por sesión: un cierre de la app o del sidecar no debe borrarlos. */
export function loadDrafts(): Record<string, string> {
  if (typeof localStorage === "undefined") return {};
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
    return Object.fromEntries(
      Object.entries(raw).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
    );
  } catch {
    return {};
  }
}

export function saveDrafts(drafts: Record<string, string>): void {
  if (typeof localStorage === "undefined") return;
  try {
    // No acumular entradas vacías de sesiones que ya se enviaron.
    const nonEmpty = Object.fromEntries(Object.entries(drafts).filter(([, text]) => text.length > 0));
    localStorage.setItem(STORAGE_KEY, JSON.stringify(nonEmpty));
  } catch {
    // Modo privado/cuota: el borrador sigue vivo en memoria aunque no persista.
  }
}
