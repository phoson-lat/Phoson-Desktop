import { Check, FileText, Loader2, Pencil, Save, X } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { phoson } from "@/bridge/client";
import type { FsReadResult } from "@/bridge/protocol";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

/** Extensión → lenguaje de shiki (subconjunto común). */
const LANGS: Record<string, string> = {
  ts: "typescript",
  tsx: "tsx",
  js: "javascript",
  jsx: "jsx",
  mjs: "javascript",
  cjs: "javascript",
  py: "python",
  json: "json",
  md: "markdown",
  mdx: "mdx",
  css: "css",
  scss: "scss",
  html: "html",
  htm: "html",
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  yml: "yaml",
  yaml: "yaml",
  toml: "toml",
  rs: "rust",
  go: "go",
  java: "java",
  rb: "ruby",
  php: "php",
  sql: "sql",
  c: "c",
  h: "c",
  cpp: "cpp",
  hpp: "cpp",
  dockerfile: "dockerfile",
  svg: "xml",
  xml: "xml",
};

const langFor = (path: string): string => {
  const base = path.split("/").pop() ?? "";
  if (base.toLowerCase() === "dockerfile") return "dockerfile";
  const ext = base.includes(".") ? base.split(".").pop()!.toLowerCase() : "";
  return LANGS[ext] ?? "text";
};

const basename = (p: string) => p.split("/").filter(Boolean).pop() ?? p;

interface CodeViewerProps {
  /** Ruta del archivo a mostrar; null cierra el diálogo. */
  path: string | null;
  onClose: () => void;
  /** Permite editar y guardar (por defecto sí). */
  editable?: boolean;
}

/**
 * Visor/editor de código ligero: resaltado con shiki (temas claro/oscuro) y
 * modo edición con guardado vía `fs.write`.
 */
export function CodeViewer({ path, onClose, editable = true }: CodeViewerProps) {
  const { resolvedTheme } = useTheme();
  const [data, setData] = useState<FsReadResult | null>(null);
  const [html, setHtml] = useState("");
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!path) return;
    setData(null);
    setHtml("");
    setEditing(false);
    setError(null);
    phoson
      .fsRead(path)
      .then((d) => {
        setData(d);
        setDraft(d.text);
      })
      .catch((e) => setError(String(e)));
  }, [path]);

  // Resaltado (se salta en modo edición y con binarios).
  useEffect(() => {
    if (!data || data.binary || editing) return;
    let cancelled = false;
    import("shiki")
      .then(({ codeToHtml }) =>
        codeToHtml(data.text, {
          lang: langFor(data.path),
          themes: { dark: "github-dark", light: "github-light" },
          defaultColor: resolvedTheme === "dark" ? "dark" : "light",
        }),
      )
      .then((h) => {
        if (!cancelled) setHtml(h);
      })
      .catch(() => {
        if (!cancelled) setHtml("");
      });
    return () => {
      cancelled = true;
    };
  }, [data, editing, resolvedTheme]);

  const save = async () => {
    if (!data) return;
    setSaving(true);
    try {
      await phoson.fsWrite(data.path, draft);
      setData({ ...data, text: draft, size: draft.length });
      setEditing(false);
      toast.success("Archivo guardado", { description: basename(data.path) });
    } catch (e) {
      toast.error("No se pudo guardar", { description: String(e) });
    } finally {
      setSaving(false);
    }
  };

  const dirty = !!data && draft !== data.text;

  return (
    <Dialog open={path !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-4xl gap-0 p-0 sm:max-w-4xl">
        <div className="flex items-center gap-2 px-4 py-3">
          <FileText className="size-4 shrink-0 text-violet" />
          <DialogTitle className="truncate text-sm font-medium">
            {path ? basename(path) : ""}
          </DialogTitle>
          <span className="min-w-0 flex-1 truncate text-[0.68rem] text-muted-foreground">
            {path}
            {data?.truncated && " · truncado"}
          </span>

          {editable && data && !data.binary && (
            editing ? (
              <>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 text-xs"
                  onClick={() => {
                    setDraft(data.text);
                    setEditing(false);
                  }}
                >
                  Cancelar
                </Button>
                <Button
                  size="sm"
                  className="h-7 gap-1.5 bg-violet text-xs text-white hover:bg-violet/90"
                  disabled={saving || !dirty}
                  onClick={() => void save()}
                >
                  {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
                  Guardar
                </Button>
              </>
            ) : (
              <Button
                size="sm"
                variant="ghost"
                className="h-7 gap-1.5 text-xs"
                onClick={() => setEditing(true)}
              >
                <Pencil className="size-3.5" /> Editar
              </Button>
            )
          )}
          <button
            onClick={onClose}
            title="Cerrar"
            className="grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors dashboard-hover hover:text-foreground"
          >
            <X className="size-3.5" />
          </button>
        </div>

        <div className="max-h-[min(70vh,560px)] min-h-[200px] overflow-auto border-t border-[var(--dashboard-border)] bg-[var(--phoson-surface-2)]">
          {error ? (
            <p className="p-4 text-xs text-destructive">{error}</p>
          ) : !data ? (
            <div className="flex items-center gap-2 p-4 text-xs text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" /> Abriendo…
            </div>
          ) : data.binary ? (
            <p className="p-4 text-xs text-muted-foreground">
              Archivo binario — no se puede mostrar como texto.
            </p>
          ) : editing ? (
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              spellCheck={false}
              className="h-full min-h-[320px] w-full resize-none bg-transparent p-4 font-mono text-[0.78rem] leading-relaxed outline-none"
            />
          ) : html ? (
            <div
              className={cn(
                "p-4 text-[0.78rem] leading-relaxed",
                "[&_pre]:!bg-transparent [&_code]:!bg-transparent",
              )}
              dangerouslySetInnerHTML={{ __html: html }}
            />
          ) : (
            <pre className="p-4 font-mono text-[0.78rem] leading-relaxed">
              <code>{data.text}</code>
            </pre>
          )}
        </div>

        {editing && dirty && (
          <div className="flex items-center gap-1.5 border-t border-[var(--dashboard-border)] px-4 py-2 text-[0.68rem] text-muted-foreground">
            <Check className="size-3 text-amber-500" /> Cambios sin guardar
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
