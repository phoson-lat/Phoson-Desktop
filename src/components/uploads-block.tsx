import {
  ExternalLink,
  File as FileIcon,
  FileArchive,
  FileAudio,
  FileCode,
  FileText,
  FileVideo,
  Image as ImageIcon,
  X,
} from "lucide-react";

import { isTauri, openPath } from "@/bridge/client";
import type { UploadedFile } from "@/bridge/protocol";
import { kindOf, type FileKind } from "@/lib/files";
import { cn } from "@/lib/utils";

const ICONS: Record<FileKind, typeof FileIcon> = {
  image: ImageIcon,
  pdf: FileText,
  audio: FileAudio,
  video: FileVideo,
  archive: FileArchive,
  code: FileCode,
  doc: FileText,
  file: FileIcon,
};

/**
 * Archivos no nativos subidos al workspace (PDF, vídeo, audio, código…).
 *
 * Se usa en el composer (con botón de quitar) y en los mensajes del usuario
 * (con botón para abrirlos en el visor del sistema). El agente los recibe
 * referenciados en el prompt, no como adjuntos.
 */
export function UploadedFiles({
  files,
  onRemove,
  className,
}: {
  files: UploadedFile[];
  /** Si se pasa, cada chip muestra "quitar" en vez de "abrir". */
  onRemove?: (path: string) => void;
  className?: string;
}) {
  if (files.length === 0) return null;

  return (
    <div className={cn("flex flex-wrap gap-1.5", className)}>
      {files.map((u) => {
        const Icon = ICONS[kindOf(u.name)];
        return (
          <span
            key={u.path}
            title={`uploads: ${u.relative}`}
            className="flex max-w-[16rem] items-center gap-1.5 rounded-lg border border-amber-500/25 bg-amber-500/10 px-2 py-1 text-[0.68rem] text-amber-700 dark:text-amber-300"
          >
            <Icon className="size-3 shrink-0" />
            <span className="truncate">{u.name}</span>
            {onRemove ? (
              <button
                onClick={() => onRemove(u.path)}
                title="Quitar referencia"
                aria-label={`Quitar ${u.name}`}
                className="shrink-0 transition-colors hover:text-destructive"
              >
                <X className="size-3" />
              </button>
            ) : (
              isTauri() && (
                <button
                  onClick={() => void openPath(u.path).catch(() => {})}
                  title="Abrir en el visor del sistema"
                  aria-label={`Abrir ${u.name}`}
                  className="shrink-0 transition-colors hover:text-foreground"
                >
                  <ExternalLink className="size-3" />
                </button>
              )
            )}
          </span>
        );
      })}
    </div>
  );
}
