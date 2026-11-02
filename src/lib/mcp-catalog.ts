import type { McpCatalogEntry, McpServer } from "@/bridge/protocol";

/**
 * Catálogo de MCP: lo que se enseña sin escribir en el buscador.
 *
 * La lista curada funciona **sin red** (y por eso está aquí, no en el registro):
 * los servidores de referencia del proyecto MCP y unos cuantos remotos con
 * token. El resto de los ~55.000 del *Official MCP Registry* se buscan en vivo
 * con `mcp.catalog` — la misma fuente que agrega allmcpservers.com.
 *
 * Solo se guardan datos técnicos: ni descripciones ni nombres traducibles (van
 * a `settings.json`, en `mcp.catalog.cards`, y se resuelven en la UI).
 */

/** Valores del formulario de servidor (los textareas, en crudo). */
export interface McpFormValues {
  name: string;
  transport: string;
  command: string;
  args: string;
  url: string;
  /** `CLAVE=valor` por línea. */
  env: string;
  /** `Cabecera: valor` por línea (solo sse/http). */
  headers: string;
}

/** Entrada curada: como la del registro, pero sin descripción traducible. */
export interface CuratedMcpEntry extends Omit<McpCatalogEntry, "description"> {
  /** Clave de `settings.mcp.catalog.cards` con la descripción. */
  descriptionKey: string;
}

export const emptyMcpForm = (): McpFormValues => ({
  name: "",
  transport: "stdio",
  command: "",
  args: "",
  url: "",
  env: "",
  headers: "",
});

/** Servidores de referencia del proyecto MCP + remotos con token. */
export const MCP_CURATED: CuratedMcpEntry[] = [
  {
    id: "filesystem",
    name: "filesystem",
    title: "Filesystem",
    descriptionKey: "filesystem",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-filesystem", "."],
    url: "",
    envKeys: [],
    headerKeys: [],
    required: [],
    source: "npm",
    repository: "https://github.com/modelcontextprotocol/servers",
    version: "",
  },
  {
    id: "github",
    name: "github",
    title: "GitHub",
    descriptionKey: "github",
    transport: "http",
    command: "",
    args: [],
    url: "https://api.githubcopilot.com/mcp/",
    envKeys: [],
    headerKeys: ["Authorization"],
    required: ["Authorization"],
    source: "remote",
    repository: "https://github.com/github/github-mcp-server",
    version: "",
  },
  {
    id: "git",
    name: "git",
    title: "Git",
    descriptionKey: "git",
    transport: "stdio",
    command: "uvx",
    args: ["mcp-server-git", "--repository", "."],
    url: "",
    envKeys: [],
    headerKeys: [],
    required: [],
    source: "pypi",
    repository: "https://github.com/modelcontextprotocol/servers",
    version: "",
  },
  {
    id: "fetch",
    name: "fetch",
    title: "Fetch",
    descriptionKey: "fetch",
    transport: "stdio",
    command: "uvx",
    args: ["mcp-server-fetch"],
    url: "",
    envKeys: [],
    headerKeys: [],
    required: [],
    source: "pypi",
    repository: "https://github.com/modelcontextprotocol/servers",
    version: "",
  },
  {
    id: "time",
    name: "time",
    title: "Time",
    descriptionKey: "time",
    transport: "stdio",
    command: "uvx",
    args: ["mcp-server-time"],
    url: "",
    envKeys: [],
    headerKeys: [],
    required: [],
    source: "pypi",
    repository: "https://github.com/modelcontextprotocol/servers",
    version: "",
  },
  {
    id: "memory",
    name: "memory",
    title: "Memory",
    descriptionKey: "memory",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-memory"],
    url: "",
    envKeys: [],
    headerKeys: [],
    required: [],
    source: "npm",
    repository: "https://github.com/modelcontextprotocol/servers",
    version: "",
  },
  {
    id: "sequential-thinking",
    name: "sequential-thinking",
    title: "Sequential Thinking",
    descriptionKey: "sequentialThinking",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-sequential-thinking"],
    url: "",
    envKeys: [],
    headerKeys: [],
    required: [],
    source: "npm",
    repository: "https://github.com/modelcontextprotocol/servers",
    version: "",
  },
  {
    id: "brave-search",
    name: "brave-search",
    title: "Brave Search",
    descriptionKey: "braveSearch",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-brave-search"],
    url: "",
    envKeys: ["BRAVE_API_KEY"],
    headerKeys: [],
    required: ["BRAVE_API_KEY"],
    source: "npm",
    repository: "https://github.com/modelcontextprotocol/servers",
    version: "",
  },
  {
    id: "postgres",
    name: "postgres",
    title: "PostgreSQL",
    descriptionKey: "postgres",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-postgres", "postgresql://user:pass@localhost/db"],
    url: "",
    envKeys: [],
    headerKeys: [],
    required: [],
    source: "npm",
    repository: "https://github.com/modelcontextprotocol/servers",
    version: "",
  },
  {
    id: "sqlite",
    name: "sqlite",
    title: "SQLite",
    descriptionKey: "sqlite",
    transport: "stdio",
    command: "uvx",
    args: ["mcp-server-sqlite", "--db-path", "./datos.db"],
    url: "",
    envKeys: [],
    headerKeys: [],
    required: [],
    source: "pypi",
    repository: "https://github.com/modelcontextprotocol/servers",
    version: "",
  },
  {
    id: "playwright",
    name: "playwright",
    title: "Playwright",
    descriptionKey: "playwright",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@playwright/mcp@latest"],
    url: "",
    envKeys: [],
    headerKeys: [],
    required: [],
    source: "npm",
    repository: "https://github.com/microsoft/playwright-mcp",
    version: "",
  },
  {
    id: "context7",
    name: "context7",
    title: "Context7",
    descriptionKey: "context7",
    transport: "http",
    command: "",
    args: [],
    url: "https://mcp.context7.com/mcp",
    envKeys: [],
    headerKeys: ["CONTEXT7_API_KEY"],
    required: ["CONTEXT7_API_KEY"],
    source: "remote",
    repository: "https://github.com/upstash/context7",
    version: "",
  },
  {
    id: "deepwiki",
    name: "deepwiki",
    title: "DeepWiki",
    descriptionKey: "deepwiki",
    transport: "http",
    command: "",
    args: [],
    url: "https://mcp.deepwiki.com/mcp",
    envKeys: [],
    headerKeys: [],
    required: [],
    source: "remote",
    repository: "",
    version: "",
  },
  {
    id: "everything",
    name: "everything",
    title: "Everything",
    descriptionKey: "everything",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-everything"],
    url: "",
    envKeys: [],
    headerKeys: [],
    required: [],
    source: "npm",
    repository: "https://github.com/modelcontextprotocol/servers",
    version: "",
  },
];

/** Curada → entrada de catálogo, con la descripción ya traducida. */
export function curatedEntry(entry: CuratedMcpEntry, description: string): McpCatalogEntry {
  const { descriptionKey: _descriptionKey, ...rest } = entry;
  return { ...rest, description };
}

/** Entrada del catálogo → formulario relleno (claves sin valores). */
export function formFromEntry(entry: McpCatalogEntry): McpFormValues {
  return {
    name: entry.name,
    transport: entry.transport,
    command: entry.command,
    args: entry.args.join(" "),
    url: entry.url,
    env: entry.envKeys.map((key) => `${key}=`).join("\n"),
    headers: entry.headerKeys.map((key) => `${key}: `).join("\n"),
  };
}

/** Servidor guardado → formulario de edición (los valores no salen del sidecar). */
export function formFromServer(server: McpServer): McpFormValues {
  return {
    name: server.name,
    transport: server.transport,
    command: server.command ?? "",
    args: (server.args ?? []).join(" "),
    url: server.url ?? "",
    env: [...(server.envKeys ?? [])].map((key) => `${key}=`).join("\n"),
    headers: [...(server.headerKeys ?? [])].map((key) => `${key}: `).join("\n"),
  };
}

/**
 * Textarea → pares clave/valor. Una línea por par, `#` comenta y las líneas sin
 * separador se ignoran. El separador es el **primero** (`=`, `:`), así que un
 * valor puede llevar más (`Authorization: Bearer a:b`).
 */
export function parsePairs(text: string, separator: "=" | ":"): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const cut = trimmed.indexOf(separator);
    if (cut <= 0) continue;
    const key = trimmed.slice(0, cut).trim();
    if (!key) continue;
    out[key] = trimmed.slice(cut + 1).trim();
  }
  return out;
}

/** Claves presentes en el textarea, tengan valor o no. */
export function pairKeys(text: string, separator: "=" | ":"): string[] {
  return Object.keys(parsePairs(text, separator));
}

/**
 * Cabeceras HTTP: `Clave: valor`, con `Clave=valor` aceptado por comodidad (el
 * `=` no aparece nunca en el nombre de una cabecera, así que no hay ambigüedad).
 */
export function parseHeaders(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const colon = trimmed.indexOf(":");
    const equals = trimmed.indexOf("=");
    const cut = colon >= 0 && (equals < 0 || colon < equals) ? colon : equals;
    if (cut <= 0) continue;
    const key = trimmed.slice(0, cut).trim();
    if (key) out[key] = trimmed.slice(cut + 1).trim();
  }
  return out;
}

/** Claves de cabecera presentes en el textarea (con o sin valor). */
export function headerKeys(text: string): string[] {
  return Object.keys(parseHeaders(text));
}

/** Claves guardadas que ya no están en el formulario (hay que eliminarlas). */
export function missingKeys(saved: string[], present: string[]): string[] {
  const set = new Set(present);
  return saved.filter((key) => !set.has(key));
}

/** `missingKeys` a partir del textarea de env. */
export function removedKeys(
  saved: string[],
  text: string,
  separator: "=" | ":" = "=",
): string[] {
  return missingKeys(saved, pairKeys(text, separator));
}

/** Argumentos separados por espacios, respetando comillas. */
export function splitArgs(text: string): string[] {
  const out: string[] = [];
  for (const match of text.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)) {
    out.push(match[1] ?? match[2] ?? match[3] ?? "");
  }
  return out;
}
