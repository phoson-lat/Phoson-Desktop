/**
 * Idioma de la interfaz: detección, normalización y persistencia.
 *
 * Módulo **puro** (sin i18next) para que `i18n.ts` pueda importarlo sin ciclos:
 * aquí solo vive "qué idioma toca" y "cómo se guarda la elección del usuario".
 *
 * Orden de resolución en el arranque:
 *
 *  1. la elección explícita del usuario (`localStorage`), que manda siempre;
 *  2. el idioma del sistema operativo (`system_locale` en Rust);
 *  3. `navigator.language` de la webview;
 *  4. `en`.
 *
 * El paso 2 no es redundante: en macOS la webview de una app sin localizar
 * devuelve `en` aunque el Mac esté en español, así que `navigator.language` por
 * sí solo dejaría a media España en inglés.
 */

import { invoke } from "@tauri-apps/api/core";

import { isTauri } from "@/bridge/client";

/** Idiomas soportados. Añadir uno toca también `locales/`, `i18n.ts` y este tipo. */
export const SUPPORTED_LOCALES = ["en", "es"] as const;

export type Locale = (typeof SUPPORTED_LOCALES)[number];

/** Último recurso cuando ni el sistema ni la webview dicen algo útil. */
export const DEFAULT_LOCALE: Locale = "en";

/** Clave de la elección del usuario (las demás preferencias usan `phoson.*`). */
const LOCALE_KEY = "phoson.locale";

const isSupported = (value: string): value is Locale =>
  (SUPPORTED_LOCALES as readonly string[]).includes(value);

/**
 * `es-MX` → `es`, `EN_us` → `en`. Devuelve `null` si el idioma no está
 * soportado (así el llamador puede seguir bajando en la cadena de preferencias
 * en vez de quedarse con un idioma que no existe).
 */
export function normalizeLocale(raw?: string | null): Locale | null {
  if (!raw) return null;
  const base = raw.trim().toLowerCase().split(/[-_]/)[0];
  return isSupported(base) ? base : null;
}

/** Elección explícita del usuario, si la hay. */
export function storedLocale(): Locale | null {
  if (typeof localStorage === "undefined") return null;
  return normalizeLocale(localStorage.getItem(LOCALE_KEY));
}

/** Guarda la elección del usuario (`null` = volver a seguir al sistema). */
export function persistLocale(locale: Locale | null): void {
  if (typeof localStorage === "undefined") return;
  if (locale) localStorage.setItem(LOCALE_KEY, locale);
  else localStorage.removeItem(LOCALE_KEY);
}

/** Idioma del sistema operativo según Rust; `null` fuera de Tauri o si falla. */
export async function systemLocale(): Promise<Locale | null> {
  if (!isTauri()) return null;
  try {
    return normalizeLocale(await invoke<string | null>("system_locale"));
  } catch {
    return null;
  }
}

/** Idioma de la webview (`navigator.languages` primero: el orden importa). */
function webviewLocale(): Locale | null {
  if (typeof navigator === "undefined") return null;
  for (const tag of navigator.languages ?? []) {
    const hit = normalizeLocale(tag);
    if (hit) return hit;
  }
  return normalizeLocale(navigator.language);
}

/**
 * Resuelve el idioma del arranque. Solo consulta Rust si el usuario no ha
 * elegido idioma: una elección explícita nunca se pisa.
 */
export async function detectLocale(): Promise<Locale> {
  const stored = storedLocale();
  if (stored) return stored;
  return (await systemLocale()) ?? webviewLocale() ?? DEFAULT_LOCALE;
}

/** Código del `<html lang="…">` (accesibilidad, guiones y corrector). */
export function htmlLang(locale: Locale): string {
  return locale === "es" ? "es" : "en";
}

/** Etiqueta BCP-47 por defecto de cada idioma, para APIs que la exigen. */
const SPEECH_TAGS: Record<Locale, string> = { es: "es-ES", en: "en-US" };

/**
 * Etiqueta para las APIs de voz (`SpeechRecognition.lang`, `stt.start`).
 *
 * Si la webview ya trae una variante del idioma de la interfaz se respeta
 * (`es-MX` es más preciso que `es-ES` para acentos); si no, se usa la de
 * defecto. Nunca cae a un idioma distinto al de la interfaz: dictar en el
 * idioma equivocado transcribe basura.
 */
export function speechLocale(locale: Locale): string {
  const nav = typeof navigator === "undefined" ? "" : navigator.language || "";
  return normalizeLocale(nav) === locale ? nav : SPEECH_TAGS[locale];
}