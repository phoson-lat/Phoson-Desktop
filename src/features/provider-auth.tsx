/**
 * Inicio de sesión OAuth de los proveedores de suscripción (ChatGPT y Google
 * Code Assist).
 *
 * El sidecar es quien habla con el proveedor: emite `auth.prompt` con la URL
 * (y, en el flujo de dispositivo, el código) y la promesa de `auth.login`
 * resuelve cuando el usuario termina. Aquí solo se pinta el paso y se abre la
 * página en el navegador del sistema; el token nunca pasa por el frontend.
 */

import { Check, Copy, ExternalLink, Loader2, LogIn } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { openExternal, phoson } from "@/bridge/client";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface AuthPrompt {
  provider: string;
  kind: "device" | "url";
  url?: string;
  code?: string;
}

interface ProviderSignInProps {
  provider: string;
  /** Etiqueta legible del proveedor (para los textos). */
  label: string;
  /** `device` = código de dispositivo (ChatGPT); `browser` = navegador. */
  method?: "device" | "browser";
  /** Se llama cuando el login termina bien (para recargar el estado). */
  onDone?: () => void;
  className?: string;
}

/** Botón + instrucciones del login de un proveedor de suscripción. */
export function ProviderSignIn({
  provider,
  label,
  method = "browser",
  onDone,
  className,
}: ProviderSignInProps) {
  const { t } = useTranslation("settings");
  const [running, setRunning] = useState(false);
  const [prompt, setPrompt] = useState<AuthPrompt | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const unsub = useRef<(() => void) | null>(null);

  useEffect(
    () => () => {
      unsub.current?.();
      unsub.current = null;
    },
    [],
  );

  const start = useCallback(async () => {
    if (running) return;
    setRunning(true);
    setError(null);
    setPrompt(null);
    setCopied(false);
    try {
      unsub.current = await phoson.onNotify((envelope) => {
        if (envelope.method !== "auth.prompt") return;
        const p = envelope.params as Partial<AuthPrompt>;
        if (p.provider !== provider) return;
        setPrompt({ provider, kind: p.kind ?? "url", url: p.url, code: p.code });
        // El sidecar no abre navegadores (eso es cosa de la app): se abre aquí,
        // tanto la página del código de dispositivo como el authorize OAuth.
        if (p.url) void openExternal(p.url).catch(() => {});
      });
      await phoson.authLogin(provider, method);
      setRunning(false);
      toast.success(t("providers.loginSuccess", { provider: label }));
      onDone?.();
    } catch (e) {
      setRunning(false);
      setError(String(e));
    } finally {
      unsub.current?.();
      unsub.current = null;
    }
  }, [label, method, onDone, provider, running, t]);

  const copyCode = async () => {
    if (!prompt?.code) return;
    try {
      await navigator.clipboard.writeText(prompt.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* portapapeles no disponible: el código se ve igualmente */
    }
  };

  if (!running && !error) {
    return (
      <Button
        type="button"
        size="sm"
        variant="outline"
        className={cn("h-7 shrink-0 gap-1.5 text-xs", className)}
        onClick={() => void start()}
      >
        <LogIn className="size-3" /> {t("providers.signIn")}
      </Button>
    );
  }

  return (
    <div className={cn("min-w-0 flex-1 space-y-1.5", className)}>
      {running && (
        <div className="space-y-1.5 rounded-md border border-[var(--dashboard-border)] px-2.5 py-2">
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Loader2 className="size-3 animate-spin" />
            {prompt?.kind === "device"
              ? t("providers.loginDevice", { provider: label })
              : t("providers.loginWaiting")}
          </p>
          {prompt?.url && (
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <a
                href={prompt.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-violet hover:underline"
              >
                {t("providers.openLogin")} <ExternalLink className="size-3" />
              </a>
              {prompt.code && (
                <button
                  type="button"
                  onClick={() => void copyCode()}
                  className="inline-flex items-center gap-1 rounded border border-[var(--dashboard-border)] px-1.5 py-0.5 font-mono text-xs hover:text-violet"
                  title={t("providers.copyCode")}
                >
                  {prompt.code}
                  {copied ? <Check className="size-3 text-success" /> : <Copy className="size-3" />}
                </button>
              )}
            </div>
          )}
        </div>
      )}
      {error && (
        <p className="break-words text-[0.68rem] text-destructive">
          {t("providers.loginFailed")}: {error}
        </p>
      )}
    </div>
  );
}

interface ProviderAccountProps {
  provider: string;
  label: string;
  account?: string | null;
  plan?: string | null;
  /** Recarga el estado del panel tras cerrar sesión. */
  onSignedOut?: () => void;
}

/** Fila de cuenta de un proveedor de suscripción, con su botón de salir. */
export function ProviderAccount({
  provider,
  label,
  account,
  plan,
  onSignedOut,
}: ProviderAccountProps) {
  const { t } = useTranslation("settings");
  const [busy, setBusy] = useState(false);

  const signOut = async () => {
    setBusy(true);
    try {
      await phoson.authLogout(provider);
      toast.success(t("providers.logoutSuccess"));
      onSignedOut?.();
    } catch (e) {
      toast.error(t("providers.logoutFailed"), { description: String(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-w-0 flex-1 items-center gap-2 text-xs">
      <span className="min-w-0 flex-1 truncate text-muted-foreground">
        {account ? t("providers.signedInAs", { account }) : t("providers.signedIn")}
        {plan ? ` · ${plan}` : ""}
      </span>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        disabled={busy}
        className="h-6 shrink-0 px-2 text-[0.68rem] text-muted-foreground hover:text-destructive"
        onClick={() => void signOut()}
      >
        {busy ? <Loader2 className="size-3 animate-spin" /> : t("providers.signOut")}
        <span className="sr-only">{label}</span>
      </Button>
    </div>
  );
}