import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { phoson, type MemoryScope, type MemoryRecord } from "@/bridge/client";

/** Gestión explícita de memoria local y aprobaciones MCP. */
export function ProjectAdmin({ workspace }: { workspace: string }) {
  const { t } = useTranslation("projectAdmin");
  const [records, setRecords] = useState<MemoryRecord[]>([]);
  const [scope, setScope] = useState<MemoryScope>("project");
  const [mcps, setMcps] = useState<Array<{ name: string; hash: string; approved: boolean; transport?: string; command?: string; args?: string[]; url?: string; enabled?: boolean; envKeys?: string[]; headerKeys?: string[] }>>([]);
  const [key, setKey] = useState("");
  const [value, setValue] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const refresh = async () => {
    setBusy(true); setError("");
    try {
      const [memory, project] = await Promise.all([phoson.memoryList(workspace, scope), phoson.projectMcps(workspace)]);
      setRecords(Array.isArray(memory) ? memory : memory.items ?? memory.records ?? []);
      setMcps(Array.isArray(project?.mcps) ? project.mcps : []);
    } catch (e) { setError(String(e)); } finally { setBusy(false); }
  };
  useEffect(() => { void refresh(); }, [workspace, scope]);
  const save = async () => {
    if (!key.trim() || !value.trim()) return;
    try { await phoson.memoryWrite(workspace, key.trim(), value, scope); setKey(""); setValue(""); await refresh(); }
    catch (e) { setError(String(e)); }
  };
  const act = async (item: (typeof mcps)[number], approved: boolean) => {
    try { await (approved ? phoson.mcpApprove(workspace, item.name, item.hash) : phoson.mcpRevoke(workspace, item.name, item.hash)); await refresh(); }
    catch (e) { setError(String(e)); }
  };
  return <main className="project-admin">
    <header><h1>{t("title")}</h1><button onClick={() => void refresh()} disabled={busy}>{t("refresh")}</button></header>
    {error && <p role="alert">{error}</p>}
    <section><h2>{t("memory")}</h2>
      <label>{t("scope")} <select value={scope} onChange={e => setScope(e.target.value as "global" | "project")}><option value="project">{t("projectScope")}</option><option value="global">{t("globalScope")}</option></select></label>
      <div><input aria-label={t("key")} value={key} onChange={e => setKey(e.target.value)} placeholder={t("key")} />
      <textarea aria-label={t("content")} value={value} onChange={e => setValue(e.target.value)} placeholder={t("content")} />
      <button onClick={() => void save()}>{t("save")}</button></div>
      {records.map((item, i) => { const itemKey = item.key ?? item.id; return <article key={itemKey ?? i}><strong>{itemKey}</strong><p>{item.content ?? item.value}</p>
        <button onClick={async () => { try { const result = await phoson.memoryRead(workspace, itemKey, scope); setValue(String(result.content ?? result.value ?? "")); setKey(itemKey); } catch (e) { setError(String(e)); } }}>{t("read")}</button>
        <button onClick={async () => { if (!confirm(t("deleteConfirm"))) return; try { await phoson.memoryDelete(workspace, itemKey, scope); await refresh(); } catch (e) { setError(String(e)); } }}>{t("delete")}</button></article>; })}
    </section>
    <section><h2>{t("mcps")}</h2>{mcps.map((m, i) => <article key={m.name ?? i}><strong>{m.name}</strong><span>{m.approved ? t("approved") : t("pending")}</span>
      <dl><dt>Transport</dt><dd>{m.transport}</dd><dt>Command</dt><dd>{m.command || "—"}</dd><dt>Arguments</dt><dd>{(m.args ?? []).join(" ") || "—"}</dd><dt>URL</dt><dd>{m.url || "—"}</dd><dt>Enabled</dt><dd>{m.enabled ? "Yes" : "No"}</dd><dt>Environment keys</dt><dd>{(m.envKeys ?? []).join(", ") || "—"}</dd><dt>Header keys</dt><dd>{(m.headerKeys ?? []).join(", ") || "—"}</dd></dl>
      {!m.approved && <label><input type="checkbox" aria-label={`Confirm ${m.name} configuration`} onChange={e => { if (e.target.checked) void act(m, true); }} />I reviewed this exact configuration</label>}
      {m.approved && <button onClick={() => void act(m, false)}>{t("revoke")}</button>}</article>)}</section>
  </main>;
}
