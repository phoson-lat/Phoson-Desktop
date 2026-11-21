import { useState, type FormEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Monitor, Server, ShieldAlert } from "lucide-react";

import { getRemoteProfile, connectRemote, useLocalMode } from "@/bridge/connection";
import { isTauri } from "@/bridge/client";

const CHOOSE_KEY = "phoson.chooseConnection";

function errorKey(error: unknown): "remote.errors.pairing" | "remote.errors.origin" | "remote.errors.security" | "remote.errors.workspace" | "remote.errors.url" | "remote.errors.generic" {
  const code = error instanceof Error ? `${error.message} ${"code" in error ? error.code : ""}`.toLowerCase() : "";
  if (/-32003/.test(code)) return "remote.errors.workspace";
  if (/-32001|-32002|credential/.test(code)) return "remote.errors.pairing";
  if (/code|pair|unauthor|token/.test(code)) return "remote.errors.pairing";
  if (/origin|cors/.test(code)) return "remote.errors.origin";
  if (/tls|ssl|secure|wss/.test(code)) return "remote.errors.security";
  if (/workspace/.test(code)) return "remote.errors.workspace";
  if (/url|address/.test(code)) return "remote.errors.url";
  return "remote.errors.generic";
}

export function ConnectionGate({ children }: { children: ReactNode }) {
  const { t } = useTranslation("chrome");
  const profile = getRemoteProfile();
  const [choice, setChoice] = useState<"local" | "remote" | "connected" | null>(() => {
    if (profile) return "remote";
    if (typeof sessionStorage !== "undefined" && sessionStorage.getItem(CHOOSE_KEY) === "1") return null;
    return "local";
  });
  const [url, setUrl] = useState(profile?.url ?? "");
  const [workspace, setWorkspace] = useState(profile?.workspace ?? "");
  const [deviceName, setDeviceName] = useState(profile?.deviceName ?? "Phoson Desktop");
  const [code, setCode] = useState("");
  const [remember, setRemember] = useState(isTauri);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  if (choice === "local" || choice === "connected") return <>{children}</>;

  const submit = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError("");
    try {
      await connectRemote({ url, workspace, deviceName, ...(code ? { code } : {}), remember });
      sessionStorage.removeItem(CHOOSE_KEY);
      setCode("");
      setChoice("connected");
    } catch (cause) { setError(t(errorKey(cause))); }
    finally { setBusy(false); }
  };

  return <main className="flex h-dvh items-start justify-center overflow-y-auto bg-background p-6">
    <section className="my-auto w-full max-w-lg shrink-0 space-y-6 rounded-xl border bg-card p-7 shadow-lg">
      <header><h1 className="text-2xl font-semibold">{t("remote.title")}</h1><p className="mt-2 text-sm text-muted-foreground">{t("remote.subtitle")}</p></header>
      <div className="grid grid-cols-2 gap-3">
        <button type="button" className="rounded-lg border p-4 text-left hover:bg-muted" onClick={() => { useLocalMode(); window.location.reload(); }}><Monitor className="mb-2 size-5"/><strong>{t("remote.local")}</strong><p className="mt-1 text-xs text-muted-foreground">{t("remote.localHint")}</p></button>
        <button type="button" className="rounded-lg border p-4 text-left hover:bg-muted" onClick={() => setChoice("remote")}><Server className="mb-2 size-5"/><strong>{t("remote.remote")}</strong><p className="mt-1 text-xs text-muted-foreground">{t("remote.remoteHint")}</p></button>
      </div>
      {choice === "remote" && <form className="space-y-4" onSubmit={submit}>
        <label className="block text-sm">{t("remote.url")}<input required type="url" autoComplete="url" className="mt-1 w-full rounded-md border bg-background px-3 py-2" value={url} onChange={e => setUrl(e.target.value)} placeholder="wss://host:port" /></label>
        <label className="block text-sm">{t("remote.code")}<input type="password" autoComplete="one-time-code" className="mt-1 w-full rounded-md border bg-background px-3 py-2" value={code} onChange={e => setCode(e.target.value)} /></label>
        <p className="text-xs text-muted-foreground">{t("remote.rememberedHint")}</p>
        <label className="block text-sm">{t("remote.workspace")}<input className="mt-1 w-full rounded-md border bg-background px-3 py-2" value={workspace} onChange={e => setWorkspace(e.target.value)} /></label>
        <label className="block text-sm">{t("remote.deviceName")}<input required className="mt-1 w-full rounded-md border bg-background px-3 py-2" value={deviceName} onChange={e => setDeviceName(e.target.value)} /></label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={remember} onChange={e => setRemember(e.target.checked)} />{t("remote.remember")}</label>
        <div className="space-y-2 rounded-md bg-muted p-3 text-xs"><p className="flex gap-2"><ShieldAlert className="size-4 shrink-0"/>{t("remote.security")}</p><p>{t("remote.startup")}</p><p>{t("remote.origin")}</p><code className="block select-all break-all">--allow-origin {window.location.origin}</code><p className="font-medium">{t("remote.warning")}</p><p>{t("remote.reconnect")}</p></div>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <button disabled={busy} className="w-full rounded-md bg-primary px-4 py-2 text-primary-foreground disabled:opacity-50">{busy ? t("remote.connecting") : t("remote.connect")}</button>
      </form>}
    </section>
  </main>;
}
