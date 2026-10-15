/**
 * Mapa extensión → lenguaje de shiki. Compartido por el visor de código
 * (`CodeViewer`) y el panel lateral de archivos (`FilePanel`).
 */
const LANGS: Record<string, string> = {
  ts: "typescript",
  tsx: "tsx",
  js: "javascript",
  jsx: "jsx",
  mjs: "javascript",
  cjs: "javascript",
  py: "python",
  json: "json",
  md: "markdown",
  mdx: "mdx",
  css: "css",
  scss: "scss",
  html: "html",
  htm: "html",
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  yml: "yaml",
  yaml: "yaml",
  toml: "toml",
  rs: "rust",
  go: "go",
  java: "java",
  rb: "ruby",
  php: "php",
  sql: "sql",
  c: "c",
  h: "c",
  cpp: "cpp",
  hpp: "cpp",
  dockerfile: "dockerfile",
  svg: "xml",
  xml: "xml",
};

/** Lenguaje de shiki para una ruta (por extensión; `text` como fallback). */
export const langFor = (path: string): string => {
  const base = path.split("/").pop() ?? "";
  if (base.toLowerCase() === "dockerfile") return "dockerfile";
  const ext = base.includes(".") ? base.split(".").pop()!.toLowerCase() : "";
  return LANGS[ext] ?? "text";
};
