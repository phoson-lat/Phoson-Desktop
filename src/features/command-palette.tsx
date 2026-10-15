import {
  Copy,
  CornerUpLeft,
  FileDown,
  FolderOpen,
  History,
  Layers,
  MessageSquare,
  Minimize2,
  Monitor,
  Moon,
  Plus,
  Power,
  Settings,
  Sun,
  Undo2,
} from "lucide-react";
import { useTheme } from "next-themes";
import { save } from "@tauri-apps/plugin-dialog";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { isTauri, killSidecar, phoson } from "@/bridge/client";
import { hideToTray } from "@/lib/desktop";
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
import { cleanSessionTitle } from "@/lib/session-title";
import { useSession, messageText } from "@/stores/session";

interface CommandPaletteProps {
  onOpenSettings: () => void;
  onToggleExplorer: () => void;
}

/**
 * Command palette (Ctrl/⌘+K): acciones + búsqueda de sesiones. Sustituye al
 * atajo que antes solo enfocaba el buscador de la barra lateral, pero ahora lo
 * incluye (buscar y abrir sesiones) junto a acciones de uso frecuente.
 */
export function CommandPalette({ onOpenSettings, onToggleExplorer }: CommandPaletteProps) {
  // `common` entra en el array para reutilizar su etiqueta «Enviar a la bandeja».
  const { t } = useTranslation(["palette", "common"]);
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
          m.role === "user" ? t("conversation.userTurn", { text: m.text }) : messageText(m),
        )
        .filter(Boolean)
        .join("\n\n")
    : "";

  const copyConversation = () => {
    if (!conversation) {
      toast.warning(t("toast.nothingToCopy"));
      return;
    }
    void navigator.clipboard
      .writeText(conversation)
      .then(() => toast.success(t("toast.copied")))
      .catch((e) => toast.error(t("toast.copyError"), { description: String(e) }));
  };

  const exportConversation = async () => {
    if (!conversation) {
      toast.warning(t("toast.nothingToExport"));
      return;
    }
    // Fuera de Tauri (demo) no hay diálogo nativo: al portapapeles.
    if (!isTauri()) {
      copyConversation();
      return;
    }
    try {
      const path = await save({
        defaultPath: t("export.defaultFileName"),
        filters: [{ name: "Markdown", extensions: ["md"] }],
      });
      if (!path) return; // cancelado
      await phoson.fsWrite(path, conversation);
      toast.success(t("toast.exported"), { description: path });
    } catch (e) {
      toast.error(t("toast.exportError"), { description: String(e) });
    }
  };

  const openRows = order;
  const savedRows = saved.filter((s) => !order.includes(s.id));

  return (
    <CommandDialog
      open={open}
      onOpenChange={setOpen}
      title={t("dialog.title")}
      description={t("dialog.description")}
    >
      <CommandInput placeholder={t("input.placeholder")} />
      <CommandList>
        <CommandEmpty>{t("empty")}</CommandEmpty>

        <CommandGroup heading={t("groups.actions")}>
          <CommandItem value={t("keywords.newSession")} onSelect={() => run(() => void newSession())}>
            <Plus /> {t("commands.newSession")}
          </CommandItem>
          <CommandItem
            value={t("keywords.undoLastTurn")}
            onSelect={() =>
              run(() => {
                void undoLastTurn().then((ok) =>
                  ok
                    ? toast.success(t("toast.turnUndone"))
                    : toast.warning(t("toast.turnUndoError")),
                );
              })
            }
          >
            <Undo2 /> {t("commands.undoLastTurn")}
          </CommandItem>
          <CommandItem
            value={t("keywords.compactContext")}
            onSelect={() =>
              run(() => {
                void compactContext().then((r) =>
                  r
                    ? toast.success(
                        t("toast.contextCompacted", { before: r.before, after: r.after }),
                      )
                    : toast.warning(t("toast.contextCompactError")),
                );
              })
            }
          >
            <Layers /> {t("commands.compactContext")}
          </CommandItem>
          <CommandItem value={t("keywords.copyConversation")} onSelect={() => run(copyConversation)}>
            <Copy /> {t("commands.copyConversation")}
          </CommandItem>
          <CommandItem
            value={t("keywords.exportConversation")}
            onSelect={() => run(() => void exportConversation())}
          >
            <FileDown /> {t("commands.exportConversation")}
          </CommandItem>
          <CommandItem
            value={t("keywords.restartEngine")}
            onSelect={() =>
              run(() => {
                void killSidecar(cwd || null).then((killed) =>
                  killed
                    ? toast.warning(t("toast.engineRestarted"), {
                        description: t("toast.engineRestartedHint"),
                      })
                    : toast.info(t("toast.engineNone")),
                );
              })
            }
          >
            <Power /> {t("commands.restartEngine")}
          </CommandItem>
          <CommandItem value={t("keywords.toggleExplorer")} onSelect={() => run(onToggleExplorer)}>
            <FolderOpen /> {t("commands.toggleExplorer")}
          </CommandItem>
          {isTauri() && (
            <CommandItem
              value={t("keywords.hideToTray")}
              onSelect={() => run(() => void hideToTray())}
            >
              {/* La etiqueta es la misma acción del menú de la bandeja: viene de `common`. */}
              <Minimize2 /> {t("common:tray.hide")}
            </CommandItem>
          )}
          <CommandItem value={t("keywords.openSettings")} onSelect={() => run(onOpenSettings)}>
            <Settings /> {t("commands.openSettings")}
          </CommandItem>
        </CommandGroup>

        <CommandSeparator />
        <CommandGroup heading={t("groups.theme")}>
          <CommandItem value={t("keywords.themeLight")} onSelect={() => run(() => setTheme("light"))}>
            <Sun /> {t("commands.themeLight")}
          </CommandItem>
          <CommandItem value={t("keywords.themeDark")} onSelect={() => run(() => setTheme("dark"))}>
            <Moon /> {t("commands.themeDark")}
          </CommandItem>
          <CommandItem value={t("keywords.themeSystem")} onSelect={() => run(() => setTheme("system"))}>
            <Monitor /> {t("commands.themeSystem")}
          </CommandItem>
        </CommandGroup>

        {activeKey && candidates.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading={t("groups.jumpToTurn")}>
              {candidates.slice(-12).reverse().map((c) => (
                <CommandItem
                  key={c.userNodeId}
                  value={t("keywords.jumpToTurn", {
                    preview: c.preview,
                    userNodeId: c.userNodeId,
                  })}
                  onSelect={() =>
                    run(() => {
                      void jumpToTurn(c.userNodeId).then((ok) =>
                        ok
                          ? toast.success(t("toast.jumpedToTurn"))
                          : toast.warning(t("toast.jumpError")),
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
            <CommandGroup heading={t("groups.open")}>
              {openRows.map((key) => {
                const title = cleanSessionTitle(
                  sessions[key]?.messages.find((m) => m.role === "user")?.text,
                );
                return (
                  <CommandItem
                    key={key}
                    value={`${title ?? key} ${key}`}
                    onSelect={() => run(() => setActive(key))}
                  >
                    <MessageSquare />{" "}
                    {title?.slice(0, 60) || t("session.fallbackTitle", { id: key.slice(0, 6) })}
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </>
        )}

        {savedRows.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading={t("groups.saved")}>
              {savedRows.slice(0, 30).map((s) => (
                <CommandItem
                  key={s.id}
                  value={`${cleanSessionTitle(s.title)} ${s.id}`}
                  onSelect={() => run(() => void openSession(s.id, s.cwd || undefined))}
                >
                  <History /> {cleanSessionTitle(s.title) || s.id.slice(0, 8)}
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}
      </CommandList>
    </CommandDialog>
  );
}
