import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { FolderKanban, FolderOpen, Pencil, Plus, Archive, X, Check } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Input } from "@/components/ui/input";
import { isRemoteMode, remoteUrl, remoteWorkspace } from "@/bridge/connection";
import { useSession } from "@/stores/session";
import { normalizeEndpoint, normalizeWorkspace, useProjects } from "@/stores/projects";
import { toast } from "sonner";

export function ProjectPicker({ workspace }: { workspace?: string }) {
  const { t } = useTranslation("chrome");
  const projects = useProjects((state) => state.projects);
  const selectedProjectIds = useProjects((state) => state.selectedProjectIds);
  const addProject = useProjects((state) => state.addProject);
  const renameProject = useProjects((state) => state.renameProject);
  const archiveProject = useProjects((state) => state.archiveProject);
  const selectProject = useProjects((state) => state.selectProject);
  const setWorkspace = useSession((state) => state.setWorkspace);
  const endpoint = normalizeEndpoint(isRemoteMode() ? remoteUrl() ?? "remote" : "local");
  const activeProjects = projects.filter((project) => normalizeEndpoint(project.endpoint) === endpoint && !project.archived);
  const selectedId = selectedProjectIds[endpoint] ?? null;
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [path, setPath] = useState(workspace ?? "");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [archiveId, setArchiveId] = useState<string | null>(null);

  const mismatched = (project: (typeof projects)[number]) =>
    isRemoteMode() && normalizeWorkspace(project.workspace) !== normalizeWorkspace(remoteWorkspace() ?? "");

  const select = async (id: string) => {
    if (busy) return;
    if (!id) {
      selectProject(null, endpoint);
      return;
    }
    const project = useProjects.getState().projects.find((item) => item.id === id && !item.archived && normalizeEndpoint(item.endpoint) === endpoint);
    if (!project || mismatched(project)) return;
    setBusy(true);
    try {
      const actual = await setWorkspace(project.workspace);
      if (normalizeWorkspace(actual) !== normalizeWorkspace(project.workspace)) throw new Error(t("projects.selectError"));
      selectProject(project.id, endpoint);
    } catch (error) {
      toast.error(t("projects.selectError"), { description: String(error) });
    } finally {
      setBusy(false);
    }
  };

  const chooseDirectory = async () => {
    if (isRemoteMode() || busy) return;
    try {
      const result = await open({ directory: true, multiple: false, defaultPath: path || workspace });
      if (typeof result === "string") setPath(result);
    } catch (error) {
      toast.error(t("projects.directoryError"), { description: String(error) });
    }
  };

  const create = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy || !name.trim() || !path.trim()) return;
    try {
      const project = addProject(name, path, endpoint);
      setName("");
      setAdding(false);
      // Consulta el catálogo actual para no depender de la lista del render anterior.
      const freshProject = useProjects.getState().projects.find((item) => item.id === project.id && !item.archived);
      if (freshProject) void select(freshProject.id);
    } catch (error) {
      toast.error(t("projects.createError"), { description: String(error) });
    }
  };

  const saveRename = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!renamingId || !renameValue.trim() || busy) return;
    try {
      renameProject(renamingId, renameValue);
      setRenamingId(null);
    } catch (error) {
      toast.error(t("projects.renameError"), { description: String(error) });
    }
  };

  const rowClass = "group flex w-full min-w-0 items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[0.8125rem] transition-colors dashboard-hover hover:text-foreground";
  const activeClass = "bg-muted text-foreground";

  return (
    <section className="px-2.5 pt-3" aria-label={t("projects.title")}>
      <div className="mb-1 flex h-8 items-center justify-between px-2">
        <span className="text-[0.7rem] font-semibold uppercase tracking-wide text-muted-foreground">{t("projects.title")}</span>
        <button type="button" disabled={busy} className="grid size-7 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50" aria-label={t("projects.add")} title={t("projects.add")} onClick={() => { setPath(workspace ?? (isRemoteMode() ? remoteWorkspace() ?? "" : "")); setAdding(true); }}><Plus className="size-4" aria-hidden="true" /></button>
      </div>
      <button type="button" disabled={busy} aria-current={!selectedId ? "page" : undefined} className={`${rowClass} ${!selectedId ? activeClass : "text-muted-foreground"} disabled:opacity-50`} onClick={() => void select("")}>
        <FolderOpen className="size-4 shrink-0" aria-hidden="true" /><span className="min-w-0 flex-1 truncate">{t("projects.all")}</span>
      </button>
      <div className="mt-0.5 space-y-0.5">
        {activeProjects.map((project) => {
          const disabled = busy || mismatched(project);
          return <div key={project.id} className="group/project relative">
            {renamingId === project.id ? <form className="flex min-w-0 gap-1 py-0.5" onSubmit={saveRename}><Input autoFocus aria-label={t("projects.name")} value={renameValue} onChange={(event) => setRenameValue(event.target.value)} required /><button type="submit" disabled={busy} aria-label={t("projects.saveRename")} title={t("projects.saveRename")}><Check className="size-4" aria-hidden="true" /></button><button type="button" aria-label={t("projects.cancel")} title={t("projects.cancel")} onClick={() => setRenamingId(null)}><X className="size-4" aria-hidden="true" /></button></form> : <div className="flex min-w-0 items-center">
              <button type="button" disabled={disabled} aria-current={selectedId === project.id ? "page" : undefined} title={mismatched(project) ? `${project.name} — ${t("projects.remoteHint")}` : project.name} className={`${rowClass} ${selectedId === project.id ? activeClass : "text-muted-foreground"} ${disabled ? "cursor-not-allowed opacity-50" : ""}`} onClick={() => void select(project.id)}>
                <FolderKanban className="size-4 shrink-0" aria-hidden="true" /><span className="min-w-0 flex-1 truncate">{project.name}</span>
                {mismatched(project) && <span className="sr-only">{t("projects.remoteHint")}</span>}
              </button>
              <div className="ml-0.5 flex shrink-0 opacity-0 transition-opacity group-hover/project:opacity-100 group-focus-within/project:opacity-100">
                <button type="button" disabled={busy} className="grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40" aria-label={t("projects.rename", { name: project.name })} title={t("projects.rename", { name: project.name })} onClick={() => { setRenamingId(project.id); setRenameValue(project.name); }}><Pencil className="size-3.5" aria-hidden="true" /></button>
                <button type="button" disabled={busy} className="grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40" aria-label={t("projects.archive", { name: project.name })} title={t("projects.archive", { name: project.name })} onClick={() => setArchiveId(project.id)}><Archive className="size-3.5" aria-hidden="true" /></button>
              </div>
            </div>}
            {mismatched(project) && selectedId === project.id && <p role="status" className="px-2 text-xs text-muted-foreground">{t("projects.remoteHint")}</p>}
            {archiveId === project.id && <div className="mx-1 mt-1 rounded-md border bg-background p-2 text-xs"><p>{t("projects.archiveConfirm", { name: project.name })}</p><p className="mt-1 font-medium">{t("projects.archiveNoDelete")}</p><div className="mt-2 flex justify-end gap-2"><button type="button" onClick={() => setArchiveId(null)}>{t("projects.cancel")}</button><button type="button" className="font-medium" onClick={() => { archiveProject(project.id); setArchiveId(null); }}>{t("projects.confirmArchive")}</button></div></div>}
          </div>;
        })}
      </div>
      {adding && <form className="mt-2 grid gap-2 px-1" onSubmit={create}>
        <Input autoFocus aria-label={t("projects.name")} value={name} onChange={(event) => setName(event.target.value)} placeholder={t("projects.name")} required />
        <div className="flex gap-1"><Input aria-label={t("projects.path")} value={path} onChange={(event) => setPath(event.target.value)} placeholder={t("projects.path")} required /><button type="button" disabled={isRemoteMode() || busy} className="rounded-md p-2 hover:bg-muted disabled:opacity-40" aria-label={t("projects.chooseDirectory")} title={t("projects.chooseDirectory")} onClick={() => void chooseDirectory()}><FolderOpen className="size-4" aria-hidden="true" /></button></div>
        <div className="flex justify-end gap-2"><button type="button" onClick={() => setAdding(false)}>{t("projects.cancel")}</button><button type="submit" disabled={busy} className="font-medium disabled:opacity-50">{t("projects.add")}</button></div>
      </form>}
      {!activeProjects.length && <div className="sr-only">{t("projects.all")}</div>}
    </section>
  );
}
