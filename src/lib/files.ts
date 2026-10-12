/**
 * Clasificación de archivos por extensión, compartida por el composer y el
 * render de mensajes.
 *
 * Solo las **imágenes** viajan como adjunto nativo del engine (el modelo puede
 * verlas); el resto (PDF, vídeo, audio, código, comprimidos…) se sube al
 * workspace y se referencia en el prompt para que el agente lo lea con
 * `read_file`/`glob`.
 */

export type FileKind = "image" | "pdf" | "audio" | "video" | "archive" | "code" | "doc" | "file";

const KIND_BY_EXT: Record<string, FileKind> = {
  // Imágenes (adjunto nativo)
  png: "image", jpg: "image", jpeg: "image", gif: "image", webp: "image",
  bmp: "image", svg: "image", ico: "image", tif: "image", tiff: "image", avif: "image",
  // Documentos
  pdf: "pdf",
  // Audio
  mp3: "audio", wav: "audio", ogg: "audio", flac: "audio", m4a: "audio", aac: "audio", opus: "audio",
  // Vídeo
  mp4: "video", webm: "video", mov: "video", mkv: "video", avi: "video", m4v: "video",
  // Comprimidos
  zip: "archive", tar: "archive", gz: "archive", tgz: "archive", bz2: "archive",
  xz: "archive", "7z": "archive", rar: "archive",
  // Código / datos
  ts: "code", tsx: "code", js: "code", jsx: "code", py: "code", rs: "code", go: "code",
  java: "code", c: "code", cpp: "code", h: "code", hpp: "code", rb: "code", php: "code",
  sh: "code", bash: "code", sql: "code", json: "code", yaml: "code", yml: "code",
  toml: "code", ini: "code", xml: "code", html: "code", css: "code", scss: "code",
  // Documentos de texto
  txt: "doc", md: "doc", csv: "doc", tsv: "doc", log: "doc", rst: "doc",
};

export const kindOf = (name: string): FileKind => {
  const ext = name.includes(".") ? name.split(".").pop()!.toLowerCase() : "";
  return KIND_BY_EXT[ext] ?? "file";
};

export const isImageFile = (name: string): boolean => kindOf(name) === "image";

/** Último segmento de una ruta: el nombre del archivo. */
export const basenameOf = (p: string): string => p.split(/[\\/]/).filter(Boolean).pop() ?? p;

/** Esquemas que la webview pinta sola: no son rutas del sistema. */
const INLINE_SOURCE = /^(?:data|blob):|^https?:\/\//i;

/** Host de una UNC en un `file://` (`server/share/…`, sin letra de unidad). */
const UNC_HOST = /^[^\\/:]+[\\/]/;

/**
 * ¿El `source` de un `ImageBlock` se puede pintar tal cual (data URL, `blob:` o
 * URL remota)? En ese caso no hace falta `fs.readImage` ni abrirlo con el visor
 * del sistema, que solo entiende rutas locales.
 */
export const isInlineSource = (source: string): boolean => INLINE_SOURCE.test(source.trim());

/**
 * Convierte el `source` de un `ImageBlock` del engine en una ruta local.
 *
 * El engine adjunta medios como `file://<ruta absoluta>` **sin escapar**
 * (`f"file://{p}"`), así que decodificar a ciegas corrompería los nombres con
 * `%XX` literales: solo se decodifica cuando hay algo que decodificar y la
 * secuencia es válida. `fs.readImage` necesita la ruta sin esquema y —en
 * Windows— sin la barra previa a la unidad (`/C:/dir/foto.png` → `C:/dir/foto.png`).
 *
 * En una UNC (`file://server/share/a.png`) el host forma parte de la ruta: se
 * reconstruye como `//server/share/a.png`, no como una ruta relativa.
 */
export const fileUrlToPath = (source: string): string => {
  const raw = source.trim();
  if (!raw.startsWith("file://")) return raw;
  const rest = raw.slice("file://".length);
  let path = UNC_HOST.test(rest) ? `//${rest}` : rest;
  if (path.includes("%")) {
    try {
      path = decodeURIComponent(path);
    } catch {
      /* `%` literal suelto: se queda tal cual */
    }
  }
  return /^\/[A-Za-z]:[\\/]/.test(path) ? path.slice(1) : path;
};
