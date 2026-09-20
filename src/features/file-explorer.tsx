import {
  ArrowUp,
  Check,
  ChevronRight,
  FileText,
  Folder,
  FolderOpen,
  Loader2,
  RefreshCw,
  X,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { phoson } from "@/bridge/client";
import type { FsListResult } from "@/bridge/protocol";
import { cn } from "@/lib/utils";

const fmtSize = (n?: number | null): string => {
  if (n === undefined || n === null) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
};

const joinPath = (base: string, name: string) =>
  base.endsWith("/") ? `${base}${name}` : `${base}/${name}`;

const basename = (path: string) => path.split("/").filter(Boolean).pop() ?? path;

/** Migas de pan clicables a partir de una ruta absoluta. */
function crumbs(path: string): { label: string; path: string }[] {
  const parts = path.split("/").filter(Boolean);
  const out = [{ label: "/", path: "/" }];
  let acc = "";
  for (const p of parts) {
    acc += `/${p}`;
    out.push({ label: p, path: acc });
  }
  return out;
}

interface FileExplorerProps {
  onClose: () => void;
  /** Workspace actual del agente (cwd del sidecar). */
  cwd: string;
  onSetCwd: (path: string) => void;
}

/**
 * Mini explorador: navega el sistema de archivos y muestra/fija el *workspace*
 * del agente (el cwd del proceso del sidecar, contra el que los tools resuelven
 * las rutas relativas).
 */
export function FileExplorer({ onClose, cwd, onSetCwd }: FileExplorerProps) {
  const [path, setPath] = useState(cwd);
  const [data, setData] = useState<FsListResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (target: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await phoson.fsList(target);
      setData(res);
      setPath(res.path);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(cwd);
  }, [cwd, load]);

  const isWorkspace = data?.path === cwd;

  return (
    <aside className="dashboard-panel flex w-72 shrink-0 flex-col border-l border-[var(--dashboard-border)]">
      {/* Cabecera */}
      <div className="flex items-center gap-2 px-3 py-2.5">
        <FolderOpen className="size-4 text-violet" />
        <span className="flex-1 text-sm font-medium">Archivos</span>
        <button
          onClick={() => void load(path)}
          title="Recargar"
          className="grid size-7 place-items-center rounded-md text-muted-foreground transition-colors dashboard-hover hover:text-foreground"
        >
          <RefreshCw className={cn("size-3.5", loading && "animate-spin")} />
        </button>
        <button
          onClick={onClose}
          title="Cerrar"
          className="grid size-7 place-items-center rounded-md text-muted-foreground transition-colors dashboard-hover hover:text-foreground"
        >
          <X className="size-3.5" />
        </button>
      </div>

      {/* Workspace del agente */}
      <div className="mx-3 mb-2 rounded-lg bg-[var(--phoson-surface-2)] px-2.5 py-2">
        <div className="flex items-center gap-1.5 text-[0.62rem] uppercase tracking-wide text-muted-foreground">
          Espacio de trabajo
        </div>
        <div className="mt-0.5 truncate text-xs text-foreground/85" title={cwd}>
          {basename(cwd)}
        </div>
        {data && !isWorkspace && (
          <button
            onClick={() => onSetCwd(data.path)}
            className="mt-1.5 flex items-center gap-1 text-[0.68rem] text-violet hover:underline"
          >
            <Check className="size-3" /> Usar esta carpeta
          </button>
        )}
      </div>

      {/* Migas de pan */}
      <div className="flex items-center gap-0.5 overflow-hidden px-3 pb-1.5 text-[0.68rem] text-muted-foreground">
        {crumbs(data?.path ?? path).map((c, i, all) => (
          <span key={c.path} className="flex min-w-0 items-center">
            <button
              onClick={() => void load(c.path)}
              className={cn(
                "truncate rounded px-1 py-0.5 transition-colors dashboard-hover hover:text-foreground",
                i === all.length - 1 && "text-foreground",
              )}
            >
              {c.label}
            </button>
            {i < all.length - 1 && <ChevronRight className="size-3 shrink-0 opacity-40" />}
          </span>
        ))}
      </div>

      {/* Entradas */}
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {data?.parent && (
          <button
            onClick={() => void load(data.parent!)}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-muted-foreground transition-colors dashboard-hover hover:text-foreground"
          >
            <ArrowUp className="size-3.5" /> ..
          </button>
        )}

        {error ? (
          <p className="px-2 py-3 text-xs text-destructive">{error}</p>
        ) : (
          (data?.entries ?? []).map((e) => {
            const Icon = e.dir ? Folder : FileText;
            return (
              <button
                key={e.name}
                onClick={() => (e.dir ? void load(joinPath(data!.path, e.name)) : undefined)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors",
                  e.dir
                    ? "text-foreground/85 dashboard-hover"
                    : "cursor-default text-muted-foreground",
                  e.hidden && "opacity-60",
                )}
                title={e.name}
              >
                <Icon
                  className={cn(
                    "size-3.5 shrink-0",
                    e.dir ? "text-violet/80" : "opacity-60",
                  )}
                />
                <span className="min-w-0 flex-1 truncate">{e.name}</span>
                {!e.dir && (
                  <span className="shrink-0 text-[0.6rem] tabular-nums opacity-60">
                    {fmtSize(e.size)}
                  </span>
                )}
              </button>
            );
          })
        )}

        {loading && !data && (
          <div className="flex items-center gap-2 px-2 py-3 text-xs text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" /> Cargando…
          </div>
        )}
        {data?.truncated && (
          <p className="px-2 py-2 text-[0.65rem] text-muted-foreground">
            Mostrando las primeras 400 entradas.
          </p>
        )}
      </div>
    </aside>
  );
}