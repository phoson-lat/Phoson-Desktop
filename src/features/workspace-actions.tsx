import { ChevronDown, CodeXml, SquareTerminal } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { isTauri } from "@/bridge/client";
import { BrandLogo } from "@/components/brand-logo";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  fileManager,
  installedEditors,
  openFolder,
  openInEditor,
  openTerminal,
  preferredEditorId,
  setPreferredEditorId,
  type EditorInfo,
  type FileManagerInfo,
} from "@/lib/desktop";
import { cn } from "@/lib/utils";

interface WorkspaceActionsProps {
  /** Ruta absoluta del workspace de la sesión activa. */
  workspace: string;
}

/** Botón de cabecera con el hover sutil del dashboard (como el ContextMeter).
 *  En claro sube el contraste: `muted-foreground` sobre blanco queda muy tenue. */
const headerButton =
  "flex items-center justify-center rounded-md text-foreground/70 transition-colors dashboard-hover hover:text-foreground disabled:opacity-40 disabled:pointer-events-none dark:text-muted-foreground";

/**
 * Acciones del workspace en la cabecera: abrir la carpeta en el gestor de
 * archivos del sistema (Explorer, Finder, Dolphin…), abrir una terminal ahí y
 * abrirla en un editor de código instalado (VS Code, Cursor, Windsurf, Zed…),
 * con sus logos oficiales.
 *
 * El botón de editor es un split-button: el logo abre en el editor preferido
 * (último elegido en el menú; si no, el primero detectado) y el chevón
 * despliega la lista completa. Solo en la app de escritorio (la demo web no
 * tiene FS).
 */
export function WorkspaceActions({ workspace }: WorkspaceActionsProps) {
  /** Editores detectados al montar. */
  const [editors, setEditors] = useState<EditorInfo[] | null>(null);
  /** Gestor de archivos del SO (icono + nombre del botón de carpeta). */
  const [fm, setFm] = useState<FileManagerInfo | null>(null);
  /** id del editor preferido (persistido). */
  const [preferred, setPreferred] = useState<string | null>(preferredEditorId);

  useEffect(() => {
    if (!isTauri()) return;
    let cancelled = false;
    void fileManager().then((info) => {
      if (!cancelled) setFm(info);
    });
    installedEditors().then((list) => {
      if (!cancelled) setEditors(list);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!isTauri() || !workspace) return null;

  const reveal = () =>
    openFolder(workspace).catch((e) =>
      toast.error("No se pudo abrir la carpeta", { description: String(e) }),
    );

  const terminal = () =>
    openTerminal(workspace).catch((e) =>
      toast.error("No se pudo abrir la terminal", { description: String(e) }),
    );

  const openEditor = (editor: EditorInfo, remember = false) => {
    if (remember) {
      setPreferred(editor.id);
      setPreferredEditorId(editor.id);
    }
    openInEditor(editor.id, workspace).catch((e) =>
      toast.error(`No se pudo abrir ${editor.name}`, { description: String(e) }),
    );
  };

  // El preferido manda; si ya no está instalado, cae al primero de la lista.
  const primary = editors?.find((e) => e.id === preferred) ?? editors?.[0];
  // Nombre corto para la cabecera: "Explorador de archivos" no cabe; el
  // tooltip conserva el nombre completo.
  const fmShort = fm?.id === "windows" ? "Explorer" : (fm?.name ?? null);

  return (
    <div className="flex shrink-0 items-center gap-1">
      <span className="hidden text-[0.68rem] text-foreground/60 xl:inline dark:text-muted-foreground">
        Abrir en
      </span>

      <button
        className={cn(headerButton, "h-7 gap-1.5 px-1.5")}
        onClick={reveal}
        title={`Abrir en ${fm?.name ?? "el gestor de archivos"}`}
        aria-label={`Abrir en ${fm?.name ?? "el gestor de archivos"}`}
      >
        <BrandLogo id={fm?.id ?? ""} size={15} />
        {fmShort && <span className="hidden text-[0.68rem] xl:inline">{fmShort}</span>}
      </button>

      <button
        className={cn(headerButton, "h-7 gap-1.5 px-1.5")}
        onClick={terminal}
        title="Abrir una terminal aquí"
        aria-label="Abrir una terminal aquí"
      >
        <SquareTerminal className="size-[0.95rem]" />
        <span className="hidden text-[0.68rem] xl:inline">Terminal</span>
      </button>

      <div className="flex items-center">
        <button
          className={cn(headerButton, "h-7 gap-1.5 rounded-r-none pl-1.5 pr-1")}
          onClick={primary ? () => openEditor(primary) : undefined}
          disabled={!primary}
          title={primary ? `Abrir en ${primary.name}` : "No se encontraron editores"}
          aria-label={primary ? `Abrir en ${primary.name}` : "No se encontraron editores"}
        >
          {primary ? <BrandLogo id={primary.id} size={15} /> : <CodeXml className="size-4" />}
          {primary && <span className="hidden text-[0.68rem] xl:inline">{primary.name}</span>}
        </button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className={cn(headerButton, "h-7 rounded-l-none px-1")}
              title="Elegir editor…"
              aria-label="Elegir editor"
            >
              <ChevronDown className="size-3" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuLabel>Abrir en…</DropdownMenuLabel>
            {editors === null ? (
              <DropdownMenuItem disabled className="text-muted-foreground">
                Detectando editores…
              </DropdownMenuItem>
            ) : editors.length === 0 ? (
              <DropdownMenuItem disabled className="text-muted-foreground">
                No se encontraron editores
              </DropdownMenuItem>
            ) : (
              editors.map((editor) => (
                <DropdownMenuItem
                  key={editor.id}
                  onClick={() => openEditor(editor, true)}
                  className="gap-2"
                >
                  <BrandLogo id={editor.id} size={15} />
                  <span className="min-w-0 flex-1 truncate">{editor.name}</span>
                  {editor.id === primary?.id && (
                    <span className="text-[0.62rem] text-muted-foreground">predeterminado</span>
                  )}
                </DropdownMenuItem>
              ))
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
