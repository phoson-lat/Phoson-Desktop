import { ExternalLink, ImageOff, Loader2, ZoomIn } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { isTauri, openPath } from "@/bridge/client";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { useImageUrl, useOnScreen } from "@/hooks/use-image-url";
import { basenameOf } from "@/lib/files";
import { cn } from "@/lib/utils";

/** Miniatura no interactiva (chips del composer). */
export function ImageThumb({ path, className }: { path: string; className?: string }) {
  const { url, error, loading } = useImageUrl(path);
  return (
    <span
      className={cn(
        "grid size-4 shrink-0 place-items-center overflow-hidden rounded-sm bg-black/10 dark:bg-white/10",
        className,
      )}
    >
      {url ? (
        <img src={url} alt="" className="size-full object-cover" />
      ) : loading ? (
        <Loader2 className="size-2.5 animate-spin text-muted-foreground" />
      ) : (
        <ImageOff className={cn("size-2.5", error ? "text-destructive" : "text-muted-foreground")} />
      )}
    </span>
  );
}

/** Miniatura clicable que abre la imagen a tamaño completo en un diálogo. */
function ImageTile({ path, onZoom }: { path: string; onZoom: () => void }) {
  // La lectura se pospone hasta que la miniatura entra en pantalla: al abrir una
  // sesión con muchas imágenes no se piden todas a la vez.
  const { ref, seen } = useOnScreen<HTMLButtonElement>();
  const { url, error, loading } = useImageUrl(path, seen);
  const name = basenameOf(path);
  return (
    <button
      ref={ref}
      type="button"
      onClick={onZoom}
      title={`${name} — ver en grande`}
      aria-label={`Ver ${name} en grande`}
      className="group/img relative grid size-28 shrink-0 cursor-zoom-in place-items-center overflow-hidden rounded-xl border border-[var(--dashboard-border)] bg-[var(--phoson-surface-2)]/60 transition-colors hover:border-violet/60"
    >
      {url ? (
        <img src={url} alt={name} className="size-full object-cover" />
      ) : loading ? (
        <Loader2 className="size-4 animate-spin text-muted-foreground" />
      ) : (
        <span className="flex flex-col items-center gap-1 px-2 text-center text-[0.62rem] text-muted-foreground">
          <ImageOff className="size-4" />
          <span className="line-clamp-2">{error ?? "No se pudo cargar"}</span>
        </span>
      )}
      {url && (
        <span className="pointer-events-none absolute inset-0 grid place-items-center bg-black/45 opacity-0 transition-opacity group-hover/img:opacity-100">
          <ZoomIn className="size-5 text-white" />
        </span>
      )}
    </button>
  );
}

/**
 * Imágenes que el usuario adjuntó (o mencionó) en un turno.
 *
 * Se muestran como miniaturas alineadas a su burbuja; al pulsarlas se abren a
 * tamaño completo. Las rutas vienen del historial del engine (`ImageBlock` con
 * `source: file://…`) o del turno recién enviado.
 */
export function ImageGrid({ paths, className }: { paths?: string[]; className?: string }) {
  const [zoom, setZoom] = useState<string | null>(null);
  const { url, error, loading } = useImageUrl(zoom);

  if (!paths || paths.length === 0) return null;

  return (
    <>
      <div className={cn("flex flex-wrap gap-2", className)}>
        {paths.map((p) => (
          <ImageTile key={p} path={p} onZoom={() => setZoom(p)} />
        ))}
      </div>
      <Dialog open={zoom !== null} onOpenChange={(open) => !open && setZoom(null)}>
        <DialogContent className="max-w-[min(94vw,72rem)] gap-2 border-[var(--dashboard-border)] bg-[var(--phoson-surface-2)] p-3 sm:max-w-[min(94vw,72rem)]">
          <DialogTitle className="truncate pr-8 text-sm font-medium">
            {zoom ? basenameOf(zoom) : ""}
          </DialogTitle>
          <DialogDescription className="sr-only">Vista ampliada de la imagen adjunta</DialogDescription>
          <div className="grid max-h-[76vh] place-items-center overflow-hidden rounded-lg bg-black/20">
            {url ? (
              <img src={url} alt={zoom ?? ""} className="max-h-[76vh] w-auto max-w-full object-contain" />
            ) : loading ? (
              <div className="flex items-center gap-2 p-10 text-xs text-muted-foreground">
                <Loader2 className="size-4 animate-spin" /> Cargando imagen…
              </div>
            ) : (
              <div className="flex items-center gap-2 p-10 text-xs text-muted-foreground">
                <ImageOff className="size-4" /> {error ?? "No se pudo cargar la imagen"}
              </div>
            )}
          </div>
          {zoom && isTauri() && (
            <button
              onClick={() =>
                void openPath(zoom).catch((e) =>
                  toast.error("No se pudo abrir la imagen", {
                    description: String(e).replace(/^Error:\s*/, ""),
                  }),
                )
              }
              className="flex items-center gap-1.5 self-start text-[0.7rem] text-muted-foreground transition-colors hover:text-foreground"
            >
              <ExternalLink className="size-3" /> Abrir en el visor del sistema
            </button>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
