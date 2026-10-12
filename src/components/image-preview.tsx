import { ExternalLink, ImageOff, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { isTauri, openPath } from "@/bridge/client";
import { useImageUrl } from "@/hooks/use-image-url";
import { basenameOf } from "@/lib/files";
import { cn } from "@/lib/utils";

/** El visor del sistema solo entiende rutas locales absolutas (ver `native.rs`). */
const isSystemPath = (p: string): boolean => /^(?:[A-Za-z]:[\\/]|[\\/])/.test(p);

/**
 * Previsualiza una imagen local mostrada por el agente (`view_image`).
 *
 * La webview no puede abrir rutas del sistema, así que el sidecar devuelve el
 * contenido en base64 (`fs.readImage`) y aquí se pinta como data URL.
 */
export function ImagePreview({ path, className }: { path: string; className?: string }) {
  const { url, error, loading, deferred } = useImageUrl(path);

  // Lectura pospuesta (aún fuera de pantalla): ni spinner ni error.
  if (deferred) return null;

  if (loading) {
    return (
      <div className={cn("flex items-center gap-2 py-2 text-xs text-muted-foreground", className)}>
        <Loader2 className="size-3.5 animate-spin" /> Cargando imagen…
      </div>
    );
  }

  if (error || !url) {
    return (
      <div className={cn("flex items-center gap-2 py-2 text-xs text-muted-foreground", className)}>
        <ImageOff className="size-3.5" /> {error ?? "No se pudo cargar la imagen"}
      </div>
    );
  }

  return (
    <figure className={cn("my-1 flex flex-col items-start gap-1", className)}>
      <img
        src={url}
        alt={basenameOf(path)}
        className="max-h-80 w-auto max-w-full rounded-lg border border-[var(--dashboard-border)]"
      />
      <figcaption className="flex max-w-full items-center gap-1.5 text-[0.65rem] text-muted-foreground">
        <span className="truncate" title={path}>
          {basenameOf(path)}
        </span>
        {isTauri() && isSystemPath(path) && (
          <button
            onClick={() =>
              void openPath(path).catch((e) =>
                toast.error("No se pudo abrir la imagen", {
                  description: String(e).replace(/^Error:\s*/, ""),
                }),
              )
            }
            title="Abrir en el visor del sistema"
            aria-label="Abrir en el visor del sistema"
            className="grid size-5 shrink-0 place-items-center rounded-md transition-colors dashboard-hover hover:text-foreground"
          >
            <ExternalLink className="size-3" />
          </button>
        )}
      </figcaption>
    </figure>
  );
}
