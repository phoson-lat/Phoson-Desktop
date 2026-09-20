/**
 * Genera `src/components/provider-logos.tsx` a partir de los SVG monocromo de
 * `@lobehub/icons-static-svg` (MIT — https://github.com/lobehub/lobe-icons).
 *
 * Los SVG usan `fill="currentColor"`, así que se inyectan inline y heredan el
 * color del texto (tema claro/oscuro y estado seleccionado sin trucos).
 *
 * Uso:  node scripts/gen-provider-icons.mjs
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const ICONS = resolve(root, "node_modules/@lobehub/icons-static-svg/icons");
const OUT = resolve(root, "src/components/provider-logos.ts");

/** provider id del engine → id de LobeHub Icons */
const MAP = {
  openrouter: "openrouter",
  openai: "openai",
  anthropic: "anthropic",
  ollama: "ollama",
  github: "github",
  nvidia: "nvidia",
  xai: "grok",
  groq: "groq",
  deepseek: "deepseek",
  together: "together",
  perplexity: "perplexity",
  lmstudio: "lmstudio",
  vllm: "vllm",
  azure: "azure",
  gemini: "gemini",
  mistral: "mistral",
  bedrock: "bedrock",
  fireworks: "fireworks",
  cohere: "cohere",
  // omniroute no está en LobeHub Icons → la UI usa un glifo de respaldo.
};

const read = (id) => {
  for (const name of [`${id}.svg`, `${id}-color.svg`]) {
    try {
      return readFileSync(resolve(ICONS, name), "utf8").trim();
    } catch {
      /* siguiente */
    }
  }
  return null;
};

const entries = [];
const missing = [];
for (const [provider, lobe] of Object.entries(MAP)) {
  const svg = read(lobe);
  if (svg) entries.push([provider, svg]);
  else missing.push(`${provider} (${lobe})`);
}

const body = entries
  .map(([provider, svg]) => `  ${provider}: ${JSON.stringify(svg)},`)
  .join("\n");

const file = `/* GENERADO por scripts/gen-provider-icons.mjs — no editar a mano.
 *
 * Logos de proveedor (monocromo, \`currentColor\`) de LobeHub Icons (MIT):
 * https://github.com/lobehub/lobe-icons
 */
export const PROVIDER_LOGO: Record<string, string> = {
${body}
};

export const HAS_PROVIDER_LOGO = (id: string): boolean => id in PROVIDER_LOGO;
`;

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, file, "utf8");
console.log(`generados ${entries.length} iconos -> ${OUT}`);
if (missing.length) console.log("sin icono:", missing.join(", "));
