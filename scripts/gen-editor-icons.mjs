/**
 * Genera `src/components/brand-logos.ts` a partir de los logos oficiales
 * descargados de svgl.app (https://svgl.app) en `scripts/assets/svgl/`.
 *
 * Marcas con variantes claro/oscuro (Cursor, Windsurf, Zed, Apple/Finder)
 * guardan las dos y el componente `BrandLogo` elige según el tema activo.
 *
 * Los SVG son marcas de sus respectivos propietarios; se usan solo como
 * referencia de marca («Abrir en VS Code», «Abrir en Finder»…).
 *
 * Uso:  node scripts/gen-editor-icons.mjs
 * (para refrescar: descargar de nuevo los SVG de https://svgl.app/library/)
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const SRC = resolve(here, "assets/svgl");
/** Assets propios (p.ej. el Explorador de Windows, que svgl no tiene). */
const LOCAL = resolve(here, "assets/local");
const OUT = resolve(root, "src/components/brand-logos.ts");

/** Busca primero en assets locales (tienen prioridad), luego en svgl. */
const read = (file) => {
  for (const dir of [LOCAL, SRC]) {
    try {
      return readFileSync(resolve(dir, file), "utf8");
    } catch {
      /* siguiente */
    }
  }
  throw new Error(`no encontrado: ${file}`);
};

/** id de marca → archivo(s) fuente. `dark` solo si hay variante para tema oscuro. */
const MAP = {
  // Editores de código
  vscode: { light: "vscode.svg" },
  cursor: { light: "cursor_light.svg", dark: "cursor_dark.svg" },
  windsurf: { light: "windsurf_light.svg", dark: "windsurf_dark.svg" },
  zed: { light: "zed_light.svg", dark: "zed_dark.svg" },
  // Gestores de archivos. svgl no tiene el Explorador de Windows ni el Finder:
  // Explorer es un asset propio (carpeta amarilla estilo Win11); Finder usa Apple.
  windows: { light: "explorer.svg" },
  finder: { light: "apple_light.svg", dark: "apple_dark.svg" },
  linux: { light: "linux.svg" },
};

/**
 * Normaliza un SVG de svgl para inyectarlo inline:
 *  - sin declaración XML ni comentarios;
 *  - tamaño `1em` (escala con `fontSize`, como los logos de proveedor);
 *  - ids prefijados por marca: varios logos inline en el mismo documento no
 *    deben colisionar (`url(#a)` del mask de VS Code, clases `.st0`…).
 */
function normalize(svg, prefix) {
  let out = svg
    .replace(/<\?xml[^?]*\?>/g, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\s+/g, " ")
    .trim();

  // ids → ids prefijados (y sus referencias url(#…)/href="#…")
  const ids = [...out.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]);
  for (const id of ids) {
    out = out
      .replaceAll(`id="${id}"`, `id="${prefix}-${id}"`)
      .replaceAll(`url(#${id})`, `url(#${prefix}-${id})`)
      .replaceAll(`href="#${id}"`, `href="#${prefix}-${id}"`);
  }
  // clases de <style> (p.ej. `.st0` de Cursor) también se prefijan
  const classes = [...out.matchAll(/\.([A-Za-z_][\w-]*)\s*[{,]/g)].map((m) => m[1]);
  for (const cls of new Set(classes)) {
    out = out
      .replaceAll(`.${cls} `, `.${prefix}-${cls} `)
      .replaceAll(`.${cls}{`, `.${prefix}-${cls}{`)
      .replaceAll(`.${cls},`, `.${prefix}-${cls},`)
      .replaceAll(`class="${cls}"`, `class="${prefix}-${cls}"`);
  }

  // Tamaño: fuera width/height fijos, dentro 1em (conserva el viewBox).
  out = out.replace(/<svg([^>]*)>/, (_, attrs) => {
    const clean = attrs
      .replace(/\s(width|height)="[^"]*"/g, "")
      .replace(/\s+/g, " ")
      .trim();
    return `<svg ${clean} width="1em" height="1em">`;
  });
  return out;
}

const entries = [];
const missing = [];
for (const [id, files] of Object.entries(MAP)) {
  const variants = {};
  for (const [kind, file] of Object.entries(files)) {
    try {
      variants[kind] = normalize(read(file), `bl-${id}`);
    } catch {
      missing.push(`${id} (${file})`);
    }
  }
  if (variants.light) entries.push([id, variants]);
}

const body = entries
  .map(([id, v]) => {
    const dark = v.dark ? `,\n    dark: ${JSON.stringify(v.dark)},` : "";
    return `  ${id}: {\n    light: ${JSON.stringify(v.light)}${dark}\n  },`;
  })
  .join("\n");

const file = `/* GENERADO por scripts/gen-editor-icons.mjs — no editar a mano.
 *
 * Logos oficiales de marca, descargados de svgl.app (https://svgl.app).
 * Marcas de sus respectivos propietarios: se usan solo como referencia
 * («Abrir en VS Code», «Abrir en el Finder»…). \`dark\` es la variante para
 * tema oscuro cuando svgl la publica; si falta, se usa \`light\` en ambos.
 */
export interface BrandLogoVariants {
  light: string;
  dark?: string;
}

export const BRAND_LOGO: Record<string, BrandLogoVariants> = {
${body}
};

export const HAS_BRAND_LOGO = (id: string): boolean => id in BRAND_LOGO;
`;

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, file, "utf8");
console.log(`generados ${entries.length} logos de marca -> ${OUT}`);
if (missing.length) console.log("sin archivo:", missing.join(", "));
