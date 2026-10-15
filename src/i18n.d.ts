import "i18next";

import type es from "@/locales/es";

/**
 * Tipado de las claves de traducción: `es` es la fuente de verdad, así que
 * `t("chat.composer.send")` se comprueba en compilación y una clave inexistente
 * (o un namespace mal escrito) rompe `tsc` en vez de pintarse cruda en runtime.
 *
 * `en` no se tipa: su paridad con `es` la vigila `scripts/check-i18n.mjs`.
 */
declare module "i18next" {
  interface CustomTypeOptions {
    defaultNS: "common";
    resources: typeof es;
  }
}