import { ExternalLink, ImageOff, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { isTauri, openPath, phoson } from "@/bridge/client";
import { cn } from "@/lib/utils";

const basename = (p: string) => p.split(/[\\/]/).filter(Boolean).pop() ?? p;

/**
 * Previsualiza una imagen local mostrada por el agente (`view_image`).
 *
 * La webview no puede abrir rutas del sistema, así que el sidecar devuelve el
 * contenido en base64 (`fs.readImage`) y aquí se pinta como data URL.
 */
export function ImagePreview({ path, className }: { path: string; className?: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setUrl(null);
    phoson
      .fsReadImage(path)
      .then((r) => {
        if (!cancelled) setUrl(`data:${r.mediaType};base64,${r.base64}`);
      })
      .catch((e) => {
        if (!cancelled) setError(String(e).replace(/^Error:\s*/, ""));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [path]);

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
        alt={basename(path)}
        className="max-h-80 w-auto max-w-full rounded-lg border border-[var(--dashboard-border)]"
      />
      <figcaption className="flex max-w-full items-center gap-1.5 text-[0.65rem] text-muted-foreground">
        <span className="truncate" title={path}>
          {basename(path)}
        </span>
        {isTauri() && (
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
