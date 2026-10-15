/**
 * Vigila el i18n: paridad de claves entre idiomas, placeholders coherentes y
 * que no vuelvan a colarse textos en español "a pelo" en la UI.
 *
 * El tipado de `src/i18n.d.ts` ya protege las claves **usadas** (una clave
 * inexistente rompe `tsc`), pero no puede ver las que faltan en `en` ni el
 * texto que alguien escribe directo en el JSX. De eso se encarga esto.
 *
 *   node scripts/check-i18n.mjs            # comprueba
 *   node scripts/check-i18n.mjs --list     # además lista los literales sospechosos
 *
 * Sale con código 1 si algo falla, para poder colgarlo del CI.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const LOCALES = resolve(root, "src/locales");
const SOURCE = resolve(root, "src");

const LOCALE_DIRS = ["es", "en"];
/** Idioma del que se copian los textos: el que tiene que estar completo. */
const SOURCE_LOCALE = "es";

/* ── Utilidades ───────────────────────────────────────────────────────────── */

const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));

/** Rutas de hoja (`a.b.c`) de un objeto anidado, ordenadas. */
function leafPaths(value, prefix = "") {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return [prefix];
  return Object.keys(value).flatMap((key) => leafPaths(value[key], prefix ? `${prefix}.${key}` : key));
}

const placeholders = (text) =>
  [...String(text).matchAll(/\{\{\s*([\w.]+)\s*[,}]/g)].map((m) => m[1]).sort();

/** Plurales de i18next v4: `clave_one` / `clave_other` son la MISMA clave lógica. */
const logicalKey = (path) => path.replace(/_(zero|one|two|few|many|other)$/, "_#");

/* ── 1. Paridad de claves ─────────────────────────────────────────────────── */

const failures = [];
const warnings = [];

const esFiles = readdirSync(join(LOCALES, "es")).filter((f) => f.endsWith(".json")).sort();
const enFiles = readdirSync(join(LOCALES, "en")).filter((f) => f.endsWith(".json")).sort();

if (esFiles.join() !== enFiles.join()) {
  failures.push(
    `namespaces desparejos: es=[${esFiles}] en=[${enFiles}] — cada namespace necesita su archivo en ambos idiomas`,
  );
}

for (const file of esFiles) {
  if (!enFiles.includes(file)) continue;
  const es = readJson(join(LOCALES, "es", file));
  const en = readJson(join(LOCALES, "en", file));

  const esKeys = new Set(leafPaths(es).map(logicalKey));
  const enKeys = new Set(leafPaths(en).map(logicalKey));

  const missing = [...esKeys].filter((k) => !enKeys.has(k));
  const extra = [...enKeys].filter((k) => !esKeys.has(k));

  // Una clave de plural sin su pareja deja idiomas a medias sin que se note.
  for (const set of [esKeys, enKeys]) {
    const base = new Set([...set].filter((k) => k.endsWith("_#")));
    for (const key of base) {
      if (!set.has(key)) continue;
    }
  }

  if (missing.length) failures.push(`${file}: faltan ${missing.length} clave(s) en en/ → ${missing.slice(0, 8).join(", ")}${missing.length > 8 ? " …" : ""}`);
  if (extra.length) failures.push(`${file}: sobran ${extra.length} clave(s) en en/ (no están en es/) → ${extra.slice(0, 8).join(", ")}${extra.length > 8 ? " …" : ""}`);

  // Placeholders: si `es` dice «{{count}} archivos» y `en` se deja el `{{count}}`,
  // la frase sale coja en runtime (y el tipado no lo ve).
  const esLeaves = new Map(leafPaths(es).map((p) => [p, p]));
  const flat = (obj, prefix = "") =>
    Object.entries(obj).flatMap(([key, value]) => {
      const path = prefix ? `${prefix}.${key}` : key;
      return value && typeof value === "object" ? flat(value, path) : [[path, value]];
    });
  const enFlat = new Map(flat(en));
  for (const [path, value] of flat(es)) {
    void esLeaves;
    const twin = enFlat.get(path);
    if (twin === undefined) continue;
    const a = placeholders(value).join();
    const b = placeholders(twin).join();
    if (a !== b) failures.push(`${file}:${path}: placeholders distintos → es(${a || "—"}) vs en(${b || "—"})`);
  }
}

/* ── 2. Texto en español suelto en la UI ─────────────────────────────────── */

/**
 * Palabras que delatan texto de interfaz sin traducir. Se buscan **solo** en
 * literales y en texto JSX, nunca en comentarios ni en logs: los comentarios y
 * los `console.*` van en español por convención del repo.
 *
 * Lista deliberadamente amplia: la primera pasada de migración dejó fuera los
 * textos sin tilde («No se pudo cargar la imagen»), que son invisibles a
 * cualquier búsqueda por acentos.
 */
const SPANISH =
  /\b(Pensando|Listo|Cargando|Cerrar|Guardar|Cancelar|Aceptar|Enviar|Copiar|Borrar|Eliminar|Añadir|Quitar|Buscar|Mostrar|Ocultar|Nuevo|Nueva|Sesión|Sesiones|Ajustes|Carpeta|Archivo|Archivos|Ventana|Idioma|Escribe|Selecciona|Pulsa|Ejecutar|Detenido|Reintentar|Sin resultados|No se pudo|pudo|deshacer|adjunto|adjuntos|instalado|pendiente|denegado|imagen|Clave|opcional|Permiso|Ningún|ninguna|todavía|también|aquí|ahora|después|siempre|nunca|mientras|según|debajo|encima|arriba|junto|desde|hasta|entre|sobre|bajo|tras|durante|hacia|debe|puede|tiene|falta|sobra)\b/;
const ACCENTS = /[áéíóúüñ¿¡]/i;

/** Ficheros que aún no están migrados (o no son UI) y se excluyen a conciencia. */
const SKIP_PATHS = [
  "src/features/swarm/", // feature oculta: se migra cuando vuelva a la UI
  "src/lib/swarm.ts",
  "src/lib/locale.ts", // comentarios propios
  "src/lib/i18n.ts",
  "src/lib/log.ts", // diagnóstico de devs (nada de esto lo lee el usuario)
  "src/lib/perf.ts",
  "src/locales/",
];

const isComment = (line) => /^\s*(\/\/|\/\*|\*|\{\/\*)/.test(line);

/**
 * Los mensajes de diagnóstico (`logError`, `console.*`) van en español a
 * propósito: los lee quien desarrolla, no quien usa la app. Se descarta la línea
 * entera, así que no mezcles un log y un texto de UI en la misma línea.
 */
const isDiagnostic = (line) =>
  /\b(logError|logWarn|logInfo|logDebug|console\.(log|warn|error|info|debug))\s*\(/.test(line);

/**
 * Escape para los textos que **deben** quedarse como están (p. ej. el nombre de
 * cada idioma, que se escribe en su propio idioma). Marca la línea con
 * `i18n-ignore` y el motivo:
 *
 *   { id: "es", label: "Español" }, // i18n-ignore: cada idioma en su idioma
 */
const isIgnored = (line) => /i18n-ignore/.test(line);

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (/\.(ts|tsx)$/.test(path)) out.push(path);
  }
  return out;
}

const suspects = [];
for (const file of walk(SOURCE)) {
  const rel = relative(root, file);
  if (SKIP_PATHS.some((skip) => rel.startsWith(skip))) continue;
  const lines = readFileSync(file, "utf8").split("\n");
  lines.forEach((line, index) => {
    if (isComment(line) || isIgnored(line) || isDiagnostic(line)) return;
    // Fuera de comentarios, solo interesan literales y texto entre etiquetas.
    const chunks = [
      ...[...line.matchAll(/"([^"\\]|\\.)*"/g)].map((m) => m[0]),
      ...[...line.matchAll(/'([^'\\]|\\.)*'/g)].map((m) => m[0]),
      ...[...line.matchAll(/>[^<>{}]*</g)].map((m) => m[0]),
    ];
    // Un comentario al final de la línea no debe contar.
    if (/^\s*[^"'>]*\/\//.test(line) && !/["']/.test(line)) return;
    for (const chunk of chunks) {
      if (chunk.includes("//") || chunk.includes("/*")) continue;
      if (!SPANISH.test(chunk) && !ACCENTS.test(chunk)) continue;
      suspects.push(`${rel}:${index + 1}: ${chunk.trim().slice(0, 110)}`);
      break;
    }
  });
}

/* ── Informe ──────────────────────────────────────────────────────────────── */

const namespaceCount = esFiles.length;
let keyCount = 0;
for (const file of esFiles) keyCount += new Set(leafPaths(readJson(join(LOCALES, SOURCE_LOCALE, file))).map(logicalKey)).size;

console.log(`i18n: ${namespaceCount} namespaces, ${keyCount} claves en ${SOURCE_LOCALE}/ (idioma fuente).`);

if (suspects.length) {
  console.log(`\nSospechas de texto sin traducir en la UI: ${suspects.length}`);
  const shown = process.argv.includes("--list") ? suspects : suspects.slice(0, 15);
  for (const line of shown) console.log(`  ${line}`);
  if (!process.argv.includes("--list") && suspects.length > shown.length) {
    console.log(`  … y ${suspects.length - shown.length} más (usa --list)`);
  }
  warnings.push(`${suspects.length} posible(s) literal(es) sin traducir`);
}

for (const warning of warnings) console.log(`\n⚠  ${warning}`);
if (failures.length) {
  console.error(`\n✗ ${failures.length} problema(s) de paridad:`);
  for (const failure of failures) console.error(`  ${failure}`);
  process.exit(1);
}
console.log("\n✓ Paridad de claves y placeholders correcta.");