/**
 * Contenido de la demo de renderizado.
 *
 * El prompt detonante vive en `welcome:demo.user` y el markdown que ejercita
 * cada capacidad del `MarkdownRenderer` (GFM: tablas, listas, tachado; KaTeX
 * inline y display; shiki; mermaid; artifact HTML) en `welcome:demo.assistant`.
 *
 * Se exponen como **accesores** que consultan i18next en el momento de la
 * llamada: no todos los consumidores son componentes React (el bridge mock
 * streamea el markdown), así que `useTranslation` no sirve aquí y una constante
 * se quedaría congelada en el idioma del arranque.
 */

import i18n from "@/lib/i18n";

export const demoUser = (): string => i18n.t("welcome:demo.user");

export const demoAssistant = (): string => i18n.t("welcome:demo.assistant");
