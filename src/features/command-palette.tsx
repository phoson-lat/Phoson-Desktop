import {
  Copy,
  CornerUpLeft,
  FileDown,
  FolderOpen,
  History,
  Layers,
  MessageSquare,
  Monitor,
  Moon,
  Plus,
  Power,
  Settings,
  Sun,
  Undo2,
  Users,
} from "lucide-react";
import { useTheme } from "next-themes";
import { save } from "@tauri-apps/plugin-dialog";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { isTauri, killSidecar, phoson } from "@/bridge/client";
import type { SessionMeta } from "@/bridge/protocol";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { isModalOpen } from "@/lib/platform";
import { useSession, messageText } from "@/stores/session";

interface CommandPaletteProps {
  onOpenSettings: () => void;
  onToggleExplorer: () => void;
  onOpenSwarm: () => void;
}

/**
 * Command palette (Ctrl/⌘+K): acciones + búsqueda de sesiones. Sustituye al
 * atajo que antes solo enfocaba el buscador de la barra lateral, pero ahora lo
 * incluye (buscar y abrir sesiones) junto a acciones de uso frecuente.
 */
export function CommandPalette({
  onOpenSettings,
  onToggleExplorer,
  onOpenSwarm,
}: CommandPaletteProps) {
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState<SessionMeta[]>([]);
  const [candidates, setCandidates] = useState<Array<{ userNodeId: string; preview: string }>>([]);
  const { setTheme } = useTheme();

  const activeKey = useSession((s) => s.activeKey);
  const order = useSession((s) => s.order);
  const sessions = useSession((s) => s.sessions);
  const newSession = useSession((s) => s.newSession);
  const openSession = useSession((s) => s.openSession);
  const setActive = useSession((s) => s.setActive);
  const undoLastTurn = useSession((s) => s.undoLastTurn);
  const jumpToTurn = useSession((s) => s.jumpToTurn);
  const compactContext = useSession((s) => s.compactContext);
  const cwd = useSession((s) => s.cwd);

  // Atajo global: no abrir sobre otro modal (rompería su focus-trap).
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) return;
      if (event.key.toLowerCase() !== "k" && event.code !== "KeyK") return;
      event.preventDefault();
      // Cerrar con el mismo atajo aunque el palette sea un modal; no ABRIR si ya
      // hay otro modal (rompería su focus-trap).
      if (!open && isModalOpen()) return;
      setOpen((o) => !o);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  // Recarga el historial cada vez que se abre (no durante el render en cerrado).
  useEffect(() => {
    if (!open) return;
    phoson
      .listSessions()
      .then((r) => setSaved(r.sessions ?? []))
      .catch(() => setSaved([]));
    if (activeKey) {
      phoson
        .sessionJumpCandidates(activeKey)
        .then((r) => setCandidates(r.candidates ?? []))
        .catch(() => setCandidates([]));
    } else {
      setCandidates([]);
    }
  }, [open, activeKey]);

  const run = (fn: () => void) => {
    setOpen(false);
    fn();
  };

  const view = activeKey ? sessions[activeKey] : undefined;
  const conversation = view
    ? view.messages
        .map((m) =>
          m.role === "user" ? `**Tú:** ${m.text}` : messageText(m),
        )
        .filter(Boolean)
        .join("\n\n")
    : "";

  const copyConversation = () => {
    if (!conversation) {
      toast.warning("No hay conversación que copiar");
      return;
    }
    void navigator.clipboard
      .writeText(conversation)
      .then(() => toast.success("Conversación copiada (Markdown)"))
      .catch((e) => toast.error("No se pudo copiar", { description: String(e) }));
  };

  const exportConversation = async () => {
    if (!conversation) {
      toast.warning("No hay conversación que exportar");
      return;
    }
    // Fuera de Tauri (demo) no hay diálogo nativo: al portapapeles.
    if (!isTauri()) {
      copyConversation();
      return;
    }
    try {
      const path = await save({
        defaultPath: "conversacion.md",
        filters: [{ name: "Markdown", extensions: ["md"] }],
      });
      if (!path) return; // cancelado
      await phoson.fsWrite(path, conversation);
      toast.success("Conversación exportada", { description: path });
    } catch (e) {
      toast.error("No se pudo exportar", { description: String(e) });
    }
  };

  const openRows = order;
  const savedRows = saved.filter((s) => !order.includes(s.id));

  return (
    <CommandDialog
      open={open}
      onOpenChange={setOpen}
      title="Comandos"
      description="Busca una acción o una sesión"
    >
      <CommandInput placeholder="Busca una acción o una sesión…" />
      <CommandList>
        <CommandEmpty>Sin resultados.</CommandEmpty>

        <CommandGroup heading="Acciones">
          <CommandItem value="nueva sesion new chat" onSelect={() => run(() => void newSession())}>
            <Plus /> Nueva sesión
          </CommandItem>
          <CommandItem
            value="swarm agentes multiagente equipo roles maestros arbol proximamente"
            onSelect={() => run(onOpenSwarm)}
          >
            <Users /> Swarms de agentes · próximamente
          </CommandItem>
          <CommandItem
            value="deshacer undo ultimo turno"
            onSelect={() =>
              run(() => {
                void undoLastTurn().then((ok) =>
                  ok
                    ? toast.success("Turno deshecho")
                    : toast.warning("No se pudo deshacer el turno"),
                );
              })
            }
          >
            <Undo2 /> Deshacer último turno
          </CommandItem>
          <CommandItem
            value="compactar contexto comprimir resumen"
            onSelect={() =>
              run(() => {
                void compactContext().then((r) =>
                  r
                    ? toast.success(`Contexto compactado (${r.before} → ${r.after} tokens)`)
                    : toast.warning("No se pudo compactar el contexto"),
                );
              })
            }
          >
            <Layers /> Compactar contexto
          </CommandItem>
          <CommandItem value="copiar conversacion markdown export" onSelect={() => run(copyConversation)}>
            <Copy /> Copiar conversación (Markdown)
          </CommandItem>
          <CommandItem
            value="exportar conversacion archivo file markdown guardar como"
            onSelect={() => run(() => void exportConversation())}
          >
            <FileDown /> Exportar conversación (.md)…
          </CommandItem>
          <CommandItem
            value="reiniciar motor sidecar proceso restart reload"
            onSelect={() =>
              run(() => {
                void killSidecar(cwd || null).then((killed) =>
                  killed
                    ? toast.warning("Motor reiniciado", {
                        description:
                          "Se relanzará al volver a usarlo; las sesiones en memoria de ese proyecto se pierden.",
                      })
                    : toast.info("No había un motor que cerrar"),
                );
              })
            }
          >
            <Power /> Reiniciar motor de este proyecto
          </CommandItem>
          <CommandItem value="explorador archivos files" onSelect={() => run(onToggleExplorer)}>
            <FolderOpen /> Explorador de archivos
          </CommandItem>
          <CommandItem value="ajustes settings config" onSelect={() => run(onOpenSettings)}>
            <Settings /> Abrir ajustes
          </CommandItem>
        </CommandGroup>

        <CommandSeparator />
        <CommandGroup heading="Tema">
          <CommandItem value="tema claro light" onSelect={() => run(() => setTheme("light"))}>
            <Sun /> Claro
          </CommandItem>
          <CommandItem value="tema oscuro dark" onSelect={() => run(() => setTheme("dark"))}>
            <Moon /> Oscuro
          </CommandItem>
          <CommandItem value="tema sistema system auto" onSelect={() => run(() => setTheme("system"))}>
            <Monitor /> Sistema
          </CommandItem>
        </CommandGroup>

        {activeKey && candidates.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading="Saltar a turno">
              {candidates.slice(-12).reverse().map((c) => (
                <CommandItem
                  key={c.userNodeId}
                  value={`saltar turno ${c.preview} ${c.userNodeId}`}
                  onSelect={() =>
                    run(() => {
                      void jumpToTurn(c.userNodeId).then((ok) =>
                        ok ? toast.success("Saltado al turno") : toast.warning("No se pudo saltar"),
                      );
                    })
                  }
                >
                  <CornerUpLeft /> {c.preview}
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}

        {openRows.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading="Abiertas">
              {openRows.map((key) => {
                const title = sessions[key]?.messages.find((m) => m.role === "user")?.text;
                return (
                  <CommandItem
                    key={key}
                    value={`${title ?? key} ${key}`}
                    onSelect={() => run(() => setActive(key))}
                  >
                    <MessageSquare /> {title?.slice(0, 60) || `Sesión ${key.slice(0, 6)}`}
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </>
        )}

        {savedRows.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading="Guardadas">
              {savedRows.slice(0, 30).map((s) => (
                <CommandItem
                  key={s.id}
                  value={`${s.title} ${s.id}`}
                  onSelect={() => run(() => void openSession(s.id, s.cwd || undefined))}
                >
                  <History /> {s.title || s.id.slice(0, 8)}
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}
      </CommandList>
    </CommandDialog>
  );
}
