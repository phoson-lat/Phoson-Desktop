/**
 * Resaltador de shiki **de grano fino** (fine-grained bundle).
 *
 * Antes se importaba `codeToHtml` desde `"shiki"`, lo que arrastraba el bundle
 * completo (todos los lenguajes y temas, ~1.2 MB) al chunk principal. Aquí se
 * usa `createHighlighterCore` con el motor de regex en JavaScript y **lenguajes
 * cargados bajo demanda** (cada uno es su propio chunk de Vite). Solo se cargan
 * los dos temas (claro/oscuro) desde el arranque.
 *
 * El motor JS evita además el binario WASM de Oniguruma (~600 KB): `forgiving`
 * salta las gramáticas que el motor JS no soporta en vez de lanzar.
 */

import { createHighlighterCore, type HighlighterCore, type LanguageInput } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";

type Loader = () => Promise<{ default: unknown }>;

/** Lenguajes soportados (cada uno se carga bajo demanda). */
const LANG_LOADERS: Record<string, Loader> = {
  typescript: () => import("shiki/langs/typescript.mjs"),
  tsx: () => import("shiki/langs/tsx.mjs"),
  javascript: () => import("shiki/langs/javascript.mjs"),
  jsx: () => import("shiki/langs/jsx.mjs"),
  python: () => import("shiki/langs/python.mjs"),
  json: () => import("shiki/langs/json.mjs"),
  jsonc: () => import("shiki/langs/jsonc.mjs"),
  json5: () => import("shiki/langs/json5.mjs"),
  markdown: () => import("shiki/langs/markdown.mjs"),
  mdx: () => import("shiki/langs/mdx.mjs"),
  css: () => import("shiki/langs/css.mjs"),
  scss: () => import("shiki/langs/scss.mjs"),
  less: () => import("shiki/langs/less.mjs"),
  sass: () => import("shiki/langs/sass.mjs"),
  stylus: () => import("shiki/langs/stylus.mjs"),
  html: () => import("shiki/langs/html.mjs"),
  vue: () => import("shiki/langs/vue.mjs"),
  svelte: () => import("shiki/langs/svelte.mjs"),
  "angular-html": () => import("shiki/langs/angular-html.mjs"),
  "angular-ts": () => import("shiki/langs/angular-ts.mjs"),
  bash: () => import("shiki/langs/bash.mjs"),
  shellscript: () => import("shiki/langs/shellscript.mjs"),
  yaml: () => import("shiki/langs/yaml.mjs"),
  toml: () => import("shiki/langs/toml.mjs"),
  ini: () => import("shiki/langs/ini.mjs"),
  diff: () => import("shiki/langs/diff.mjs"),
  dockerfile: () => import("shiki/langs/dockerfile.mjs"),
  xml: () => import("shiki/langs/xml.mjs"),
  sql: () => import("shiki/langs/sql.mjs"),
  graphql: () => import("shiki/langs/graphql.mjs"),
  rust: () => import("shiki/langs/rust.mjs"),
  go: () => import("shiki/langs/go.mjs"),
  java: () => import("shiki/langs/java.mjs"),
  kotlin: () => import("shiki/langs/kotlin.mjs"),
  scala: () => import("shiki/langs/scala.mjs"),
  groovy: () => import("shiki/langs/groovy.mjs"),
  c: () => import("shiki/langs/c.mjs"),
  cpp: () => import("shiki/langs/cpp.mjs"),
  csharp: () => import("shiki/langs/csharp.mjs"),
  "objective-c": () => import("shiki/langs/objective-c.mjs"),
  swift: () => import("shiki/langs/swift.mjs"),
  dart: () => import("shiki/langs/dart.mjs"),
  ruby: () => import("shiki/langs/ruby.mjs"),
  php: () => import("shiki/langs/php.mjs"),
  perl: () => import("shiki/langs/perl.mjs"),
  lua: () => import("shiki/langs/lua.mjs"),
  r: () => import("shiki/langs/r.mjs"),
  powershell: () => import("shiki/langs/powershell.mjs"),
  elixir: () => import("shiki/langs/elixir.mjs"),
  erlang: () => import("shiki/langs/erlang.mjs"),
  haskell: () => import("shiki/langs/haskell.mjs"),
  clojure: () => import("shiki/langs/clojure.mjs"),
  ocaml: () => import("shiki/langs/ocaml.mjs"),
  fsharp: () => import("shiki/langs/fsharp.mjs"),
  nim: () => import("shiki/langs/nim.mjs"),
  zig: () => import("shiki/langs/zig.mjs"),
  cmake: () => import("shiki/langs/cmake.mjs"),
  make: () => import("shiki/langs/make.mjs"),
  nginx: () => import("shiki/langs/nginx.mjs"),
  protobuf: () => import("shiki/langs/protobuf.mjs"),
  latex: () => import("shiki/langs/latex.mjs"),
  viml: () => import("shiki/langs/viml.mjs"),
  awk: () => import("shiki/langs/awk.mjs"),
};

/** Alias y nombres alternativos → id canónico de shiki. */
const ALIASES: Record<string, string> = {
  ts: "typescript",
  mts: "typescript",
  cts: "typescript",
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  py: "python",
  py3: "python",
  rb: "ruby",
  rs: "rust",
  sh: "bash",
  zsh: "bash",
  shell: "shellscript",
  yml: "yaml",
  md: "markdown",
  htm: "html",
  "c++": "cpp",
  cxx: "cpp",
  cc: "cpp",
  hpp: "cpp",
  h: "c",
  cs: "csharp",
  "c#": "csharp",
  docker: "dockerfile",
  golang: "go",
  kt: "kotlin",
  kts: "kotlin",
  objc: "objective-c",
  ps1: "powershell",
  svg: "xml",
  tex: "latex",
  gql: "graphql",
  postgres: "sql",
  postgresql: "sql",
};

const THEMES = {
  dark: () => import("shiki/themes/github-dark.mjs"),
  light: () => import("shiki/themes/github-light.mjs"),
};

let corePromise: Promise<HighlighterCore> | null = null;

/** Highlighter singleton (temas cargados; lenguajes, bajo demanda). */
export function getHighlighter(): Promise<HighlighterCore> {
  corePromise ??= createHighlighterCore({
    themes: [THEMES.dark(), THEMES.light()],
    langs: [],
    engine: createJavaScriptRegexEngine({ forgiving: true }),
  });
  return corePromise;
}

const normalize = (lang: string | undefined): string => {
  const id = (lang ?? "").trim().toLowerCase();
  if (!id || id === "text" || id === "txt" || id === "plain" || id === "plaintext") return "text";
  return ALIASES[id] ?? id;
};

/** ¿Hay un resaltador para este lenguaje? */
export const supportsLanguage = (lang: string | undefined): boolean => {
  const id = normalize(lang);
  return id === "text" || id in LANG_LOADERS;
};

/**
 * Devuelve el HTML resaltado, o `null` si el lenguaje no está soportado
 * (el llamante decide el fallback sin resaltado).
 *
 * `dark` selecciona el color por defecto; ambas variantes se emiten para que
 * el cambio de tema no fuerce un re-resaltado.
 */
export async function highlight(
  code: string,
  lang: string | undefined,
  dark: boolean,
): Promise<string | null> {
  const core = await getHighlighter();
  const id = normalize(lang);

  if (id !== "text" && !core.getLoadedLanguages().includes(id)) {
    const loader = LANG_LOADERS[id];
    if (!loader) return null;
    try {
      await core.loadLanguage(loader as unknown as LanguageInput);
    } catch {
      return null;
    }
  }

  return core.codeToHtml(code, {
    lang: id,
    themes: { dark: "github-dark", light: "github-light" },
    defaultColor: dark ? "dark" : "light",
  });
}
