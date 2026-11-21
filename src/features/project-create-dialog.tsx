import { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { FolderOpen } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { isRemoteMode, remoteWorkspace } from "@/bridge/connection";
import { normalizeWorkspace } from "@/stores/projects";
import { toast } from "sonner";

interface ProjectCreateDialogProps {
  open: boolean;
  workspace?: string;
  busy: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (name: string, path: string) => Promise<boolean | void> | boolean | void;
}

const basename = (path: string): string => path.trim().replace(/[\\/]+$/, "").split(/[\\/]/).filter(Boolean).pop() ?? "";

export function ProjectCreateDialog({ open: dialogOpen, workspace, busy, onOpenChange, onCreate }: ProjectCreateDialogProps) {
  const { t } = useTranslation("chrome");
  const remote = isRemoteMode();
  const [path, setPath] = useState("");
  const [name, setName] = useState("");
  const [nameTouched, setNameTouched] = useState(false);
  const [choosing, setChoosing] = useState(false);

  useEffect(() => {
    if (!dialogOpen) return;
    const initial = normalizeWorkspace(workspace || (remote ? remoteWorkspace() : "") || "");
    setPath(initial);
    setName(basename(initial));
    setNameTouched(false);
    setChoosing(false);
  }, [dialogOpen, remote, workspace]);

  const chooseDirectory = async () => {
    if (remote || choosing) return;
    setChoosing(true);
    try {
      const result = await open({ directory: true, multiple: false, defaultPath: path || workspace });
      if (typeof result === "string") {
        const nextPath = normalizeWorkspace(result);
        setPath(nextPath);
        if (!nameTouched) setName(basename(nextPath));
      }
    } catch (error) {
      toast.error(t("projects.directoryError"), { description: String(error) });
    } finally {
      setChoosing(false);
    }
  };

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const cleanName = name.trim();
    const cleanPath = normalizeWorkspace(path);
    if (!cleanName || !cleanPath || busy) return;
    try {
      const created = await Promise.resolve(onCreate(cleanName, cleanPath));
      if (created !== false) onOpenChange(false);
    } catch {
      // The parent already reported the failure; keep the modal open so the user can correct it.
    }
  };

  return (
    <Dialog open={dialogOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>{t("projects.createTitle")}</DialogTitle>
            <DialogDescription>{t("projects.createDescription")}</DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="new-project-path">{t("projects.path")}</Label>
              <div className="flex gap-2">
                <Input
                  id="new-project-path"
                  value={path}
                  onChange={(event) => {
                    const nextPath = event.target.value;
                    setPath(nextPath);
                    if (!nameTouched) setName(basename(nextPath));
                  }}
                  placeholder={t("projects.pathPlaceholder")}
                  required
                  autoFocus={remote}
                />
                <Button type="button" variant="outline" autoFocus={!remote} disabled={remote || choosing || busy} onClick={() => void chooseDirectory()} aria-label={t("projects.chooseDirectory")} title={t("projects.chooseDirectory")}>
                  <FolderOpen className="size-4" aria-hidden="true" />
                  <span className="hidden sm:inline">{t("projects.chooseDirectory")}</span>
                </Button>
              </div>
              {remote && <p className="text-xs text-muted-foreground">{t("projects.remotePathHelp")}</p>}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="new-project-name">{t("projects.name")}</Label>
              <Input
                id="new-project-name"
                value={name}
                onChange={(event) => {
                  setNameTouched(true);
                  setName(event.target.value);
                }}
                placeholder={t("projects.namePlaceholder")}
                required
              />
              <p className="text-xs text-muted-foreground">{t("projects.nameHelp")}</p>
            </div>
          </div>

          <DialogFooter className="mt-6">
            <Button type="button" variant="ghost" disabled={busy} onClick={() => onOpenChange(false)}>
              {t("projects.cancel")}
            </Button>
            <Button type="submit" disabled={busy || !name.trim() || !normalizeWorkspace(path)}>
              {t("projects.create")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
