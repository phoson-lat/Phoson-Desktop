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
