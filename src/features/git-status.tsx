import {
  ArrowDownToLine,
  ArrowUpToLine,
  Check,
  ChevronsUpDown,
  Copy,
  ExternalLink,
  FileDiff,
  FilePlus2,
  GitBranch,
  Loader2,
  RefreshCw,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { isTauri, openExternal } from "@/bridge/client";
import { DiffView } from "@/components/diff-view";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import {
  gitAction,
  gitBranches,
  gitCheckout,
  gitDiff,
  gitStamp,
  gitStatus,
  openWithPreferredEditor,
  type GitDiffResult,
  type GitStatusInfo,
} from "@/lib/desktop";
import { parseGitDiff } from "@/lib/diff";

/** Cada cuánto se sondea el sello de git (stats de archivos, sin procesos). */
const STAMP_POLL_MS = 2_000;

interface GitStatusProps {
  /** Ruta absoluta del workspace. */
  workspace: string;
  /** Mientras el agente trabaja; al terminar un turno se refresca (suele tocar archivos). */
  running?: boolean;
}

/**
 * Estado de git del workspace, junto a la ruta en la cabecera: rama, cambios
 * sin commitear (●) y ahead/behind (↑/↓). Clic → popover con detalle (último
 * commit, desglose, upstream), acciones (fetch/pull/push, copiar rama, abrir
 * remoto), selector de ramas y un visor de diff integrado.
 *
 * El refresco es casi en tiempo real sin spawncar `git status` en cada sondeo:
 * se compara un sello (mtimes de HEAD/index/refs) cada 2 s y solo cuando
 * cambia se recarga el estado completo. Nada se muestra si no es un repo.
 */
export function GitStatus({ workspace, running }: GitStatusProps) {
  const [status, setStatus] = useState<GitStatusInfo | null>(null);
  const [open, setOpen] = useState(false);
  /** Acción git en curso ("fetch" | "pull" | "push" | "checkout"). */
  const [busy, setBusy] = useState<string | null>(null);
  /** Selector de ramas: lista (null = sin cargar) y borrador de rama nueva. */
  const [showBranches, setShowBranches] = useState(false);
  const [branches, setBranches] = useState<string[] | null>(null);
  const [newBranch, setNewBranch] = useState("");
  /** Diálogo de diff integrado. */
  const [diffOpen, setDiffOpen] = useState(false);
  const [diffData, setDiffData] = useState<GitDiffResult | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);

  const stampRef = useRef<number | null>(null);
  const wasRunning = useRef(false);

  const reload = useCallback(() => {
    if (!workspace) return;
    void gitStatus(workspace).then(setStatus);
  }, [workspace]);

  useEffect(() => {
    if (!isTauri() || !workspace) return;
    let cancelled = false;
    const probe = () =>
      void gitStamp(workspace).then((stamp) => {
        if (cancelled || stamp === stampRef.current) return;
        stampRef.current = stamp;
        reload();
      });
    probe();
    const timer = setInterval(probe, STAMP_POLL_MS);
    return () => {
      cancelled = true;
      stampRef.current = null;
      clearInterval(timer);
    };
  }, [workspace, reload]);

  // Refresca al terminar un turno: el agente suele haber tocado archivos.
  useEffect(() => {
    if (wasRunning.current && !running) reload();
    wasRunning.current = running ?? false;
  }, [running, reload]);

  if (!status) return null;

  const dirty = status.staged + status.modified + status.untracked + status.conflicted;
  const counts: Array<[string, number, string?]> = [
    ["Preparados", status.staged],
    ["Modificados", status.modified],
    ["Sin seguimiento", status.untracked],
    ["Conflictos", status.conflicted, "text-red-500"],
  ];

  const runAction = async (action: "fetch" | "pull" | "push") => {
    setBusy(action);
    try {
      const out = await gitAction(workspace, action);
      toast.success(`git ${action}`, { description: out.slice(0, 200) });
      reload();
    } catch (e) {
      toast.error(`git ${action} falló`, { description: String(e).slice(0, 300) });
    } finally {
      setBusy(null);
    }
  };

  const toggleBranches = () => {
    setShowBranches((v) => !v);
    if (branches === null) {
      gitBranches(workspace)
        .then(setBranches)
        .catch(() => setBranches([]));
    }
  };

  const switchBranch = async (branch: string, create = false) => {
    if (branch === status.branch && !create) return;
    setBusy("checkout");
    try {
      await gitCheckout(workspace, branch, create);
      toast.success(create ? `Rama ${branch} creada` : `Cambiado a ${branch}`);
      setShowBranches(false);
      setNewBranch("");
      setBranches(null);
      reload();
    } catch (e) {
      toast.error("No se pudo cambiar de rama", { description: String(e).slice(0, 300) });
    } finally {
      setBusy(null);
    }
  };

  const openDiffDialog = () => {
    setOpen(false);
    setDiffOpen(true);
    setDiffLoading(true);
    gitDiff(workspace)
      .then(setDiffData)
      .catch((e) => toast.error("No se pudo obtener el diff", { description: String(e) }))
      .finally(() => setDiffLoading(false));
  };

  const openFileAt = (file: string, line?: number) =>
    openWithPreferredEditor(`${workspace}/${file}`, line).catch((e) =>
      toast.error("No se pudo abrir en el editor", { description: String(e) }),
    );

  const diffFiles = diffData ? parseGitDiff(diffData.diff) : [];

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            className="flex min-w-0 shrink items-center gap-1.5 rounded transition-colors hover:text-foreground"
            title="Estado de git"
            aria-label="Estado de git"
          >
            <span className="shrink-0 opacity-40">·</span>
            <GitBranch className="size-3 shrink-0 opacity-70" />
            <span className="truncate">{status.branch}</span>
            {dirty > 0 && (
              <span className={status.conflicted > 0 ? "shrink-0 text-red-500" : "shrink-0 text-amber-500 dark:text-amber-400"}>
                ●{dirty}
              </span>
            )}
            {status.ahead > 0 && <span className="shrink-0 tabular-nums opacity-80">↑{status.ahead}</span>}
            {status.behind > 0 && <span className="shrink-0 tabular-nums opacity-80">↓{status.behind}</span>}
          </button>
        </PopoverTrigger>

        <PopoverContent align="start" className="w-72 p-3.5">
          <div className="space-y-2.5 text-xs">
            {/* Rama + copiar + selector */}
            <div className="flex items-center gap-1">
              <GitBranch className="size-3.5 shrink-0 text-violet" />
              <span className="min-w-0 flex-1 truncate font-medium">{status.branch}</span>
              <button
                className="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:text-foreground"
                title="Copiar nombre de rama"
                onClick={() => {
                  void navigator.clipboard
                    .writeText(status.branch)
                    .then(() => toast.success("Rama copiada"));
                }}
              >
                <Copy className="size-3.5" />
              </button>
              <button
                className="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:text-foreground"
                title="Cambiar o crear rama"
                onClick={toggleBranches}
              >
                {busy === "checkout" ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <ChevronsUpDown className="size-3.5" />
                )}
              </button>
            </div>

            {/* Selector de ramas */}
            {showBranches && (
              <div className="space-y-1 rounded-md border border-[var(--dashboard-border)] p-1.5">
                <div className="max-h-36 overflow-y-auto">
                  {branches === null ? (
                    <p className="px-1.5 py-1 text-muted-foreground">Cargando ramas…</p>
                  ) : (
                    branches.map((b) => (
                      <button
                        key={b}
                        onClick={() => void switchBranch(b)}
                        disabled={busy !== null}
                        className="flex w-full items-center gap-2 rounded px-1.5 py-1 text-left transition-colors dashboard-hover hover:text-foreground disabled:opacity-50"
                      >
                        <Check
                          className={
                            b === status.branch ? "size-3 shrink-0 text-violet" : "size-3 shrink-0 opacity-0"
                          }
                        />
                        <span className="min-w-0 flex-1 truncate">{b}</span>
                      </button>
                    ))
                  )}
                </div>
                <div className="flex items-center gap-1.5 border-t border-[var(--dashboard-border)] pt-1.5">
                  <Input
                    value={newBranch}
                    onChange={(e) => setNewBranch(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && newBranch.trim()) void switchBranch(newBranch.trim(), true);
                    }}
                    placeholder="nueva-rama"
                    className="h-6.5 flex-1 px-1.5 text-xs"
                  />
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6.5 px-2 text-xs"
                    disabled={!newBranch.trim() || busy !== null}
                    onClick={() => void switchBranch(newBranch.trim(), true)}
                  >
                    Crear
                  </Button>
                </div>
              </div>
            )}

            {status.upstream && (
              <div className="flex items-baseline justify-between gap-4">
                <span className="text-muted-foreground">Upstream</span>
                <span className="truncate font-mono text-foreground/85">
                  {status.upstream}
                  {(status.ahead > 0 || status.behind > 0) && (
                    <span className="text-muted-foreground">
                      {" "}(↑{status.ahead} ↓{status.behind})
                    </span>
                  )}
                </span>
              </div>
            )}

            {status.lastCommit && (
              <div className="flex items-baseline justify-between gap-4">
                <span className="shrink-0 text-muted-foreground">Último commit</span>
                <span className="min-w-0 text-right">
                  <span className="block truncate text-foreground/85" title={status.lastCommit}>
                    {status.lastCommit}
                  </span>
                  {status.lastCommitRel && (
                    <span className="text-muted-foreground">{status.lastCommitRel}</span>
                  )}
                </span>
              </div>
            )}

            {/* fetch / pull / push */}
            <div className="flex gap-1.5">
              {(
                [
                  ["fetch", "Fetch", RefreshCw],
                  ["pull", "Pull", ArrowDownToLine],
                  ["push", "Push", ArrowUpToLine],
                ] as const
              ).map(([action, label, Icon]) => (
                <button
                  key={action}
                  onClick={() => void runAction(action)}
                  disabled={busy !== null}
                  className="flex h-6.5 flex-1 items-center justify-center gap-1.5 rounded-md border border-[var(--dashboard-border)] text-muted-foreground transition-colors dashboard-hover hover:text-foreground disabled:opacity-50"
                >
                  {busy === action ? (
                    <Loader2 className="size-3 animate-spin" />
                  ) : (
                    <Icon className="size-3" />
                  )}
                  {label}
                </button>
              ))}
            </div>

            <Separator />

            {/* Desglose + ver diff */}
            <div className="space-y-1.5">
              {counts.map(([label, n, cls]) => (
                <div key={label} className="flex items-baseline justify-between gap-4">
                  <span className="text-muted-foreground">{label}</span>
                  <span className={`font-mono tabular-nums ${n > 0 ? (cls ?? "text-amber-500 dark:text-amber-400") : "text-foreground/50"}`}>
                    {n}
                  </span>
                </div>
              ))}
              {dirty === 0 && (
                <p className="text-muted-foreground">Árbol de trabajo limpio ✓</p>
              )}
            </div>

            {dirty > 0 && (
              <button
                onClick={openDiffDialog}
                className="flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-muted-foreground transition-colors dashboard-hover hover:text-foreground"
              >
                <FileDiff className="size-3.5" />
                Ver cambios
              </button>
            )}

            {status.remoteWeb && (
              <button
                className="flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-muted-foreground transition-colors dashboard-hover hover:text-foreground"
                onClick={() => void openExternal(status.remoteWeb!)}
              >
                <ExternalLink className="size-3.5" />
                Abrir repositorio remoto
              </button>
            )}
          </div>
        </PopoverContent>
      </Popover>

      {/* Visor de diff integrado (clic en una línea → abre el editor ahí) */}
      <Dialog open={diffOpen} onOpenChange={setDiffOpen}>
        <DialogContent className="max-w-3xl gap-0 p-0 sm:max-w-3xl">
          <div className="flex items-center gap-2 px-4 py-3">
            <FileDiff className="size-4 shrink-0 text-violet" />
            <DialogTitle className="truncate text-sm font-medium">
              Cambios en {status.branch}
            </DialogTitle>
            {diffData?.truncated && (
              <span className="shrink-0 text-[0.68rem] text-amber-500">· diff cortado por tamaño</span>
            )}
          </div>

          <div className="max-h-[min(70vh,560px)] min-h-[160px] overflow-y-auto border-t border-[var(--dashboard-border)] px-4 pb-4">
            {diffLoading && !diffData ? (
              <div className="flex items-center gap-2 py-6 text-xs text-muted-foreground">
                <Loader2 className="size-3.5 animate-spin" /> Obteniendo cambios…
              </div>
            ) : diffFiles.length === 0 && (diffData?.untracked.length ?? 0) === 0 ? (
              <p className="py-6 text-xs text-muted-foreground">No hay cambios que mostrar.</p>
            ) : (
              <>
                {diffFiles.map((f) => (
                  <DiffView
                    key={f.path}
                    rows={f.rows}
                    path={f.path}
                    maxLines={500}
                    onOpenLine={(line) => void openFileAt(f.path, line)}
                  />
                ))}
                {(diffData?.untracked.length ?? 0) > 0 && (
                  <div className="mt-3">
                    <p className="text-[0.65rem] uppercase tracking-wide text-muted-foreground">
                      Sin seguimiento
                    </p>
                    <div className="mt-1 space-y-0.5">
                      {diffData!.untracked.map((f) => (
                        <button
                          key={f}
                          onClick={() => void openFileAt(f)}
                          title="Abrir en el editor"
                          className="flex w-full items-center gap-2 rounded px-1.5 py-0.5 text-left font-mono text-[0.72rem] text-muted-foreground transition-colors dashboard-hover hover:text-foreground"
                        >
                          <FilePlus2 className="size-3 shrink-0 text-emerald-500" />
                          <span className="truncate">{f}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
