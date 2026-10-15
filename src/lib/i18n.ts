/**
 * i18next: una sola instancia y los namespaces en el bundle.
 *
 * No hay backend de traducciones ni carga diferida a propósito: son ~8 archivos
 * pequeños que entran en el bundle que ya se lee de disco, y así `t()` es
 * **síncrono** (nada de suspender, ni de pintar la clave cruda un frame).
 *
 * El idioma se resuelve antes del primer render (ver `main.tsx`) para que nadie
 * vea la app en el idioma equivocado durante un parpadeo.
 */

import i18n from "i18next";
import { initReactI18next, useTranslation } from "react-i18next";

import {
  DEFAULT_LOCALE,
  detectLocale,
  htmlLang,
  normalizeLocale,
  persistLocale,
  SUPPORTED_LOCALES,
  type Locale,
} from "@/lib/locale";
import en from "@/locales/en";
import es from "@/locales/es";

export const NAMESPACES = [
  "common",
  "chrome",
  "chat",
  "welcome",
  "onboarding",
  "palette",
  "settings",
  "system",
  "tools",
] as const;

/** `lang` del documento: accesibilidad, guiones y corrector ortográfico. */
function applyDocumentLang(locale: Locale): void {
  if (typeof document !== "undefined") document.documentElement.lang = htmlLang(locale);
}

/**
 * Arranca i18next con el idioma resuelto (`localStorage` → SO → webview → `en`)
 * y devuelve el idioma activo. Idempotente: llamarlo dos veces solo reinicializa.
 */
export async function initI18n(): Promise<Locale> {
  const locale = await detectLocale();

  await i18n.use(initReactI18next).init({
    resources: { es, en },
    lng: locale,
    // Si a `es` le falta una clave, mejor inglés que la ruta cruda (`words.name`).
    fallbackLng: DEFAULT_LOCALE,
    supportedLngs: [...SUPPORTED_LOCALES],
    ns: NAMESPACES,
    defaultNS: "common",
    // React ya escapa el texto: escapar otra vez rompe los acentos compuestos.
    interpolation: { escapeValue: false },
    returnNull: false,
    react: { useSuspense: false },
  });

  applyDocumentLang(locale);
  // Las etiquetas nativas (bandeja) las sincroniza `lib/native-labels.ts`, que
  // depende de este módulo y no al revés: así no hay ciclo entre los dos.
  i18n.on("languageChanged", (lng) => {
    applyDocumentLang(normalizeLocale(lng) ?? DEFAULT_LOCALE);
  });

  return locale;
}

/** Cambia el idioma y recuerda la elección (el usuario manda sobre la detección). */
export async function setLocale(locale: Locale): Promise<void> {
  persistLocale(locale);
  await i18n.changeLanguage(locale);
}

/** Idioma activo y su setter, para el selector de Ajustes. */
export function useLocale(): [Locale, (next: Locale) => void] {
  const { i18n: instance } = useTranslation();
  const locale = normalizeLocale(instance.resolvedLanguage) ?? DEFAULT_LOCALE;
  return [locale, (next) => void setLocale(next)];
}

export default i18n;