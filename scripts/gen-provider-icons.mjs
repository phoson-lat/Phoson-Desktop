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
const MCP_OUT = resolve(root, "src/components/mcp-logos.ts");

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

/* ── Logos de proveedor ─────────────────────────────────────────────────── */

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

/* ── Logos de servidores MCP ────────────────────────────────────────────── */

/** nombre de servidor MCP → id de LobeHub Icons */
const MCP_MAP = {
  github: "github",
  "brave-search": "brave",
  brave: "brave",
};

/** nombre → SVG local ya normalizado a `currentColor`. */
const MCP_LOCAL = ["postgres"];

const mcpEntries = [];
for (const [name, lobe] of Object.entries(MCP_MAP)) {
  const svg = read(lobe);
  if (svg) mcpEntries.push([name, svg]);
}
for (const name of MCP_LOCAL) {
  try {
    const svg = readFileSync(resolve(root, `scripts/assets/mcp/${name}.svg`), "utf8").trim();
    mcpEntries.push([name, svg]);
  } catch {
    console.warn(`falta scripts/assets/mcp/${name}.svg`);
  }
}

const mcpBody = mcpEntries.map(([name, svg]) => `  ${JSON.stringify(name)}: ${JSON.stringify(svg)},`).join("\n");

const mcpFile = `/* GENERADO por scripts/gen-provider-icons.mjs — no editar a mano.
 *
 * Logos de servidores MCP (monocromo, \`currentColor\`).
 * LobeHub Icons (MIT) + SVG normalizados en scripts/assets/mcp/.
 */
export const MCP_LOGO: Record<string, string> = {
${mcpBody}
};

export const mcpLogoFor = (name: string): string | undefined => {
  const key = name.toLowerCase();
  for (const id of Object.keys(MCP_LOGO)) {
    if (key === id || key.includes(id)) return MCP_LOGO[id];
  }
  // Heurística por familia de servidor.
  if (key.includes("postgres") || key.includes("sql") || key.includes("database")) return MCP_LOGO.postgres;
  return undefined;
};
`;

writeFileSync(MCP_OUT, mcpFile, "utf8");
console.log(`generados ${mcpEntries.length} logos MCP -> ${MCP_OUT}`);

