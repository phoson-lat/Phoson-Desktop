import {
  ArrowRight,
  Check,
  ExternalLink,
  KeyRound,
  Loader2,
  Monitor,
  Moon,
  ShieldCheck,
  Sun,
  X,
} from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useMemo, useState } from "react";
import { Trans, useTranslation } from "react-i18next";

import { phoson } from "@/bridge/client";
import type { ModelOption, ProviderStatus } from "@/bridge/protocol";
import { PhosonLogo } from "@/components/phoson-logo";
import { ProviderLogo } from "@/components/provider-logo";
import { ProviderSignIn } from "@/features/provider-auth";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { BASE_URL_DEFAULTS, PROVIDER_META as PROVIDERS, providerHint, providerNote } from "@/lib/providers";
import { cn } from "@/lib/utils";

/** Etiquetas y enlaces de claves por proveedor (los ids coinciden con el engine). */

/**
 * Pasos del asistente: `id` marca el progreso y el pie, y la etiqueta visible
 * de cada uno se resuelve en `stepNav` (dentro del componente, porque necesita `t`).
 */
const STEPS = ["welcome", "provider", "model", "prefs", "done"] as const;

/** Argumentos de la bienvenida, en orden (fija el escalonado de la animación). */
const FEATURES = ["providers", "skills", "storage"] as const;

/** Retardo de entrada escalonado (para animar los textos). */
const at = (ms: number) => ({ animationDelay: `${ms}ms` });
const ANIM = "phoson-text-in";

interface OnboardingProps {
  sessionId: string | null;
  onDone: () => void;
}

export function Onboarding({ sessionId, onDone }: OnboardingProps) {
  const { t } = useTranslation("onboarding");
  // `common` se consulta con su propio `t`: las claves tipadas no cruzan
  // namespaces con el prefijo `common:`.
  const { t: tCommon } = useTranslation("common");
  const { setTheme, theme } = useTheme();
  const [step, setStep] = useState(0);
  const [providers, setProviders] = useState<ProviderStatus[]>([]);
  const [providerId, setProviderId] = useState("openrouter");
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [models, setModels] = useState<ModelOption[]>([]);
  const [query, setQuery] = useState("");
  const [model, setModel] = useState("");
  const [subagentModel, setSubagentModel] = useState("");
  const [target, setTarget] = useState<"main" | "sub">("main");
  const [safeMode, setSafeMode] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Escape = "configurar más tarde": el overlay bloqueante no debe atrapar al usuario.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onDone();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onDone]);

  useEffect(() => {
    if (!sessionId) return;
    phoson
      .getConfig(sessionId)
      .then((c) => {
        setProviders(c.providers);
        if (c.provider) setProviderId(c.provider);
        setSafeMode(c.safeMode);
        setModel((m) => m || c.model);
        setSubagentModel((m) => m || c.subagentModel);
      })
      .catch(() => {});
  }, [sessionId]);

  // Al cambiar de proveedor, precarga su base_url guardada (o la local por defecto).
  useEffect(() => {
    const st = providers.find((p) => p.id === providerId);
    setBaseUrl(st?.baseUrl || BASE_URL_DEFAULTS[providerId] || "");
  }, [providerId, providers]);

  const status = (id: string) => providers.find((p) => p.id === id);
  const configured = providers.filter((p) => p.hasKey).length;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return models.slice(0, 80);
    return models.filter((m) => `${m.id} ${m.label} ${m.provider}`.toLowerCase().includes(q)).slice(0, 80);
  }, [models, query]);

  const loadModels = async () => {
    if (!sessionId) return;
    try {
      const r = await phoson.listModels(sessionId);
      setModels(r.models ?? []);
      if (r.error) setError(r.error);
    } catch (e) {
      setError(String(e));
    }
  };

  const saveProvider = async () => {
    if (!sessionId) return;
    if (current?.auth && !current.loggedIn) {
      setError(t("steps.provider.signInRequired"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const secrets = apiKey.trim() ? { [providerId]: apiKey.trim() } : undefined;
      const baseUrls =
        showUrl && baseUrl.trim() ? { [providerId]: baseUrl.trim() } : undefined;
      await phoson.setConfig(sessionId, { provider: providerId }, secrets, baseUrls);
      setApiKey("");
      const cfg = await phoson.getConfig(sessionId);
      setProviders(cfg.providers);
      void loadModels();
      setStep(2);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const saveModel = async () => {
    if (!sessionId) return;
    setBusy(true);
    try {
      const patch: Record<string, unknown> = {};
      if (model) patch.model = model;
      if (subagentModel) patch.subagent_model = subagentModel;
      await phoson.setConfig(sessionId, patch);
      setStep(3);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const savePrefs = async () => {
    if (!sessionId) return;
    setBusy(true);
    try {
      await phoson.setConfig(sessionId, { safe_mode: safeMode });
      setStep(4);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const current = status(providerId);
  /** Nombre comercial y URL de las claves del proveedor elegido. */
  const meta = PROVIDERS[providerId];
  /**
   * Frases del catálogo para ese proveedor. Se resuelven **en cada render** (el
   * `t` de arriba ya suscribe el componente al cambio de idioma).
   */
  const metaHint = providerHint(providerId);
  const metaNote = providerNote(providerId);
  /** El backend confirma qué admite cada proveedor (clave y/o base_url). */
  const showKey = current?.supportsKey ?? true;
  const showUrl = current?.supportsBaseUrl ?? Boolean(BASE_URL_DEFAULTS[providerId]);
  /** Valor del modelo que edita el listado ahora mismo. */
  const activeValue = target === "main" ? model : subagentModel;
  const setActiveTargetModel = (id: string) =>
    target === "main" ? setModel(id) : setSubagentModel(id);
  /** En el resumen pintamos el nombre del tema, no el id que usa next-themes. */
  const themeLabel =
    theme === "light" || theme === "dark" || theme === "system"
      ? t(`steps.prefs.theme.${theme}`)
      : t("steps.prefs.theme.system");
  /** Nombre de cada paso en la cabecera; dos son genéricos y se reutilizan de `common`. */
  const stepNav: Record<(typeof STEPS)[number], string> = {
    welcome: t("steps.welcome.nav"),
    provider: t("steps.provider.nav"),
    model: tCommon("words.model"),
    prefs: t("steps.prefs.nav"),
    done: tCommon("actions.done"),
  };

  return (
    <div className="dashboard-shell-overlay fixed inset-0 z-[100] overflow-y-auto">
      <div className="mx-auto flex min-h-full w-full max-w-7xl flex-col px-6 py-6 sm:px-10 lg:px-14">
        {/* ── Cabecera ─────────────────────────────────────────────────── */}
        <header className="phoson-text-in flex items-center gap-3">
          <PhosonLogo size={22} showText={false} />
          <div className="flex-1 text-xs text-muted-foreground">
            {t("progress", { current: step + 1, total: STEPS.length })}
            <span className="mx-2 opacity-40">/</span>
            <span className="text-foreground">{stepNav[STEPS[step]]}</span>
          </div>
          <div className="flex gap-1.5">
            {STEPS.map((s, i) => (
              <span
                key={s}
                className={cn(
                  "h-1.5 rounded-full transition-all duration-300",
                  i <= step ? "w-6 bg-violet" : "w-4 bg-[var(--dashboard-border)]",
                  i === step && "phoson-dot-fill",
                )}
              />
            ))}
          </div>
          <button
            onClick={onDone}
            title={t("close.title")}
            aria-label={t("close.ariaLabel")}
            className="ml-2 grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors dashboard-hover hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </header>

        {/* ── Contenido (key={step} re-dispara las animaciones) ────────── */}
        <main className={cn("flex flex-1 py-10", (step === 0 || step === 4) ? "items-center" : "items-start")}>
          <div key={step} className="w-full">
            {/* 1 · Bienvenida */}
            {step === 0 && (
              <div className="grid items-center gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                <div className="space-y-6">
                  <PhosonLogo size={96} animated showText={false} className="phoson-pop" />
                  <h1 className={cn(ANIM, "text-4xl font-semibold leading-tight tracking-tight sm:text-5xl")} style={at(80)}>
                    {t("steps.welcome.title")}
                    <br />
                    Phoson Desktop
                  </h1>
                  <p className={cn(ANIM, "max-w-lg text-base text-muted-foreground")} style={at(180)}>
                    <Trans
                      ns="onboarding"
                      i18nKey="steps.welcome.tagline"
                      components={{ cli: <span className="text-violet-soft" /> }}
                    />
                  </p>
                </div>

                <ul className="space-y-6 lg:pl-10">
                  {FEATURES.map((f, i) => (
                    <li key={f} className={cn(ANIM, "flex gap-4")} style={at(260 + i * 90)}>
                      <Check className="mt-1 size-4 shrink-0 text-violet" />
                      <div>
                        <div className="text-sm font-medium">
                          {t(`steps.welcome.features.${f}.title`)}
                        </div>
                        <div className="text-sm text-muted-foreground">
                          {t(`steps.welcome.features.${f}.body`)}
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* 2 · Proveedor + clave */}
            {step === 1 && (
              <div className="space-y-8">
                <div className="space-y-2">
                  <h1 className={cn(ANIM, "text-3xl font-semibold tracking-tight")} style={at(60)}>
                    {t("steps.provider.title")}
                  </h1>
                  <p className={cn(ANIM, "max-w-2xl text-sm text-muted-foreground")} style={at(140)}>
                    <Trans
                      ns="onboarding"
                      i18nKey="steps.provider.body"
                      components={{ path: <span className="font-mono" /> }}
                    />
                  </p>
                </div>

                <div className="grid gap-10 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
                  <div className="grid h-fit gap-x-8 gap-y-1 sm:grid-cols-2 xl:grid-cols-3">
                  {Object.entries(PROVIDERS).map(([id, meta], i) => {
                    const st = status(id);
                    const selected = id === providerId;
                    return (
                      <button
                        key={id}
                        onClick={() => setProviderId(id)}
                        style={at(200 + i * 25)}
                        className={cn(
                          ANIM,
                          "flex items-center gap-2 rounded-lg px-3 py-2.5 text-left text-sm transition-colors",
                          selected
                            ? "bg-[var(--phoson-surface-2)] text-foreground"
                            : "text-muted-foreground dashboard-hover hover:text-foreground",
                        )}
                      >
                        <ProviderLogo
                          id={id}
                          size={16}
                          className={selected ? "text-violet" : "opacity-80"}
                        />
                        <span className="min-w-0 flex-1 truncate">{meta.label}</span>
                        {st?.hasKey && <Check className="size-3.5 shrink-0 text-success" />}
                      </button>
                    );
                  })}
                  </div>

                  <div className="space-y-5 lg:border-l lg:border-[var(--dashboard-border)] lg:pl-10">
                    {current?.auth && (
                      <div className={cn(ANIM, "space-y-2")} style={at(540)}>
                        <p className="text-xs text-muted-foreground">{t("steps.provider.subscription")}</p>
                        {current.loggedIn ? (
                          <p className="flex items-center gap-1.5 text-xs text-success">
                            <Check className="size-3.5" />
                            {t("steps.provider.signedIn", {
                              account: current.account ? ` · ${current.account}` : "",
                            })}
                          </p>
                        ) : (
                          <ProviderSignIn
                            provider={providerId}
                            label={meta?.label ?? providerId}
                            method={providerId === "chatgpt" ? "device" : "browser"}
                            onDone={() => {
                              if (!sessionId) return;
                              void phoson.getConfig(sessionId).then((c) => setProviders(c.providers));
                            }}
                          />
                        )}
                      </div>
                    )}
                    {showKey && (
                      <div className="space-y-2">
                        <div className={cn(ANIM, "flex items-center gap-3")} style={at(560)}>
                          <label className="text-xs text-muted-foreground">
                            {t("steps.provider.keyLabel", { provider: meta?.label ?? providerId })}
                          </label>
                          {meta?.keysUrl && (
                            <a
                              href={meta.keysUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="flex items-center gap-1 text-xs text-violet hover:underline"
                            >
                              {t("steps.provider.keyLink")} <ExternalLink className="size-3" />
                            </a>
                          )}
                        </div>
                        <input
                          type="password"
                          style={at(610)}
                          className={cn(
                            ANIM,
                            "w-full border-b border-[var(--dashboard-border)] bg-transparent py-2 font-mono text-sm outline-none transition-colors placeholder:text-muted-foreground/50 focus:border-violet",
                          )}
                          placeholder={current?.hasKey ? t("steps.provider.keyPlaceholderExisting") : "sk-…"}
                          value={apiKey}
                          onChange={(e) => setApiKey(e.target.value)}
                        />
                      </div>
                    )}

                    {showUrl && (
                      <div className="space-y-2">
                        <label
                          className={cn(ANIM, "block text-xs text-muted-foreground")}
                          style={at(640)}
                        >
                          {t("steps.provider.baseUrlLabel")}
                        </label>
                        <input
                          style={at(660)}
                          className={cn(
                            ANIM,
                            "w-full border-b border-[var(--dashboard-border)] bg-transparent py-2 font-mono text-sm outline-none transition-colors placeholder:text-muted-foreground/50 focus:border-violet",
                          )}
                          placeholder={BASE_URL_DEFAULTS[providerId] ?? "http://…"}
                          value={baseUrl}
                          onChange={(e) => setBaseUrl(e.target.value)}
                        />
                      </div>
                    )}

                    {metaNote && (
                      <p className={cn(ANIM, "text-xs text-muted-foreground")} style={at(700)}>
                        {metaNote}
                      </p>
                    )}
                    {metaHint && (
                      <p className={cn(ANIM, "text-xs text-muted-foreground")} style={at(700)}>
                        {metaHint}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* 3 · Modelo */}
            {step === 2 && (
              <div className="space-y-8">
                <div className="space-y-2">
                  <h1 className={cn(ANIM, "text-3xl font-semibold tracking-tight")} style={at(60)}>
                    {t("steps.model.title")}
                  </h1>
                  <p className={cn(ANIM, "max-w-2xl text-sm text-muted-foreground")} style={at(140)}>
                    {models.length > 0
                      ? t("steps.model.available", { count: models.length, provider: providerId })
                      : error
                        ? t("steps.model.listError")
                        : t("steps.model.loading")}{" "}
                    <Trans
                      ns="onboarding"
                      i18nKey="steps.model.subagentNote"
                      components={{ sub: <span className="text-foreground/80" /> }}
                    />
                  </p>
                </div>

                {/* Objetivo del listado: modelo principal o de sub-agentes */}
                <div className="grid gap-3 sm:grid-cols-2 lg:max-w-2xl">
                  {(
                    [
                      { id: "main" as const, label: t("steps.model.target.main"), value: model },
                      { id: "sub" as const, label: t("steps.model.target.sub"), value: subagentModel },
                    ] as const
                  ).map(({ id, label, value }, i) => (
                    <button
                      key={id}
                      onClick={() => setTarget(id)}
                      style={at(180 + i * 60)}
                      className={cn(
                        ANIM,
                        "rounded-lg px-3 py-2.5 text-left transition-colors",
                        target === id ? "bg-[var(--phoson-surface-2)]" : "dashboard-hover",
                      )}
                    >
                      <div
                        className={cn(
                          "flex items-center gap-2 text-xs",
                          target === id ? "text-violet" : "text-muted-foreground",
                        )}
                      >
                        <span
                          className={cn(
                            "size-1.5 rounded-full",
                            target === id ? "bg-violet" : "bg-transparent",
                          )}
                        />
                        {label}
                      </div>
                      <div className="mt-1 truncate font-mono text-[0.7rem] text-foreground/80">
                        {value || t("unset")}
                      </div>
                    </button>
                  ))}
                </div>

                <div className="grid gap-10 lg:grid-cols-[minmax(0,2.2fr)_minmax(0,1fr)]">
                  <div className="space-y-4">
                <input
                  style={at(200)}
                  className={cn(
                    ANIM,
                    "w-full border-b border-[var(--dashboard-border)] bg-transparent py-2 text-sm outline-none transition-colors placeholder:text-muted-foreground/50 focus:border-violet",
                  )}
                  placeholder={t("steps.model.search")}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />

                {filtered.length > 0 && (
                  <div className="grid max-h-[46vh] gap-x-10 gap-y-0.5 overflow-y-auto sm:grid-cols-2">
                    {filtered.map((m, i) => (
                      <button
                        key={`${m.provider}/${m.id}`}
                        onClick={() => setActiveTargetModel(m.id)}
                        style={at(Math.min(i * 18, 500))}
                        className={cn(
                          ANIM,
                          "flex items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors",
                          m.id === activeValue
                            ? "bg-[var(--phoson-surface-2)]"
                            : "dashboard-hover",
                        )}
                      >
                        <Check
                          className={cn(
                            "size-3.5 shrink-0",
                            m.id === activeValue ? "text-violet" : "opacity-0",
                          )}
                        />
                        <span className="min-w-0 flex-1 truncate text-sm">{m.label || m.id}</span>
                        <span className="shrink-0 font-mono text-[0.68rem] text-muted-foreground">
                          {m.id}
                        </span>
                      </button>
                    ))}
                  </div>
                )}

                  </div>

                  <div className="space-y-2 lg:border-l lg:border-[var(--dashboard-border)] lg:pl-10">
                  <p className={cn(ANIM, "text-xs text-muted-foreground")} style={at(260)}>
                    {t(target === "main" ? "steps.model.typeId.main" : "steps.model.typeId.sub")}
                  </p>
                  <input
                    style={at(320)}
                    className={cn(
                      ANIM,
                      "mt-1 w-full border-b border-[var(--dashboard-border)] bg-transparent py-2 font-mono text-sm outline-none transition-colors placeholder:text-muted-foreground/50 focus:border-violet",
                    )}
                    placeholder={t("steps.model.idPlaceholder")}
                    value={activeValue}
                    onChange={(e) => setActiveTargetModel(e.target.value)}
                  />
                  <p className={cn(ANIM, "text-xs text-muted-foreground")} style={at(380)}>
                    {t(target === "main" ? "steps.model.summary.main" : "steps.model.summary.sub")}:{" "}
                    <span className="font-mono text-foreground/80">{activeValue || "—"}</span>
                  </p>
                  </div>
                </div>
              </div>
            )}

            {/* 4 · Preferencias */}
            {step === 3 && (
              <div className="space-y-10">
                <div className="space-y-2">
                  <h1 className={cn(ANIM, "text-3xl font-semibold tracking-tight")} style={at(60)}>
                    {t("steps.prefs.title")}
                  </h1>
                  <p className={cn(ANIM, "text-sm text-muted-foreground")} style={at(140)}>
                    {t("steps.prefs.body")}
                  </p>
                </div>

                <div className="grid gap-12 sm:grid-cols-2">
                  <div>
                    <div className={cn(ANIM, "text-xs text-muted-foreground")} style={at(200)}>
                      {t("steps.prefs.theme.label")}
                    </div>
                    <div className="mt-4 flex flex-wrap gap-8">
                      {[
                        { id: "light", label: t("steps.prefs.theme.light"), Icon: Sun },
                        { id: "dark", label: t("steps.prefs.theme.dark"), Icon: Moon },
                        { id: "system", label: t("steps.prefs.theme.system"), Icon: Monitor },
                      ].map(({ id, label, Icon }, i) => (
                        <button
                          key={id}
                          onClick={() => setTheme(id)}
                          style={at(260 + i * 70)}
                          className={cn(
                            ANIM,
                            "flex items-center gap-2.5 text-sm transition-colors",
                            theme === id ? "text-violet" : "text-muted-foreground hover:text-foreground",
                          )}
                        >
                          <Icon className="size-4" />
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className={cn(ANIM, "flex items-start justify-between gap-6")} style={at(320)}>
                    <div>
                      <div className="flex items-center gap-2 text-sm">
                        <ShieldCheck className="size-4 text-violet" /> {t("steps.prefs.safeMode.title")}
                      </div>
                      <p className="mt-1 max-w-sm text-xs text-muted-foreground">
                        {t("steps.prefs.safeMode.body")}
                      </p>
                    </div>
                    <Switch checked={safeMode} onCheckedChange={setSafeMode} />
                  </div>
                </div>
              </div>
            )}

            {/* 5 · Listo */}
            {step === 4 && (
              <div className="mx-auto max-w-2xl space-y-8 text-center">
                <PhosonLogo size={72} animated showText={false} className="phoson-pop mx-auto" />
                <h1 className={cn(ANIM, "text-3xl font-semibold tracking-tight")} style={at(120)}>
                  {t("steps.done.title")}
                </h1>
                <div className="phoson-stagger mx-auto max-w-md divide-y divide-[var(--dashboard-border)] text-left text-sm">
                  <Row label={t("steps.provider.nav")} value={PROVIDERS[providerId]?.label ?? providerId} />
                  <Row label={t("steps.model.target.main")} value={model || t("unset")} />
                  <Row label={t("steps.model.summary.sub")} value={subagentModel || t("unset")} />
                  <Row label={t("steps.prefs.theme.label")} value={themeLabel} />
                  <Row
                    label={t("steps.prefs.safeMode.title")}
                    value={safeMode ? t("steps.prefs.safeMode.on") : t("steps.prefs.safeMode.off")}
                  />
                </div>
                <p className={cn(ANIM, "text-xs text-muted-foreground")} style={at(220)}>
                  <Trans
                    ns="onboarding"
                    i18nKey="steps.done.tryPrompt"
                    components={{ prompt: <span className="font-mono text-foreground/80" /> }}
                  />
                </p>
              </div>
            )}

            {error && (
              <p className="mt-6 text-xs text-destructive">{error}</p>
            )}
          </div>
        </main>

        {/* ── Acciones ─────────────────────────────────────────────────── */}
        <footer className="flex items-center gap-3 border-t border-[var(--dashboard-border)] pt-5">
          {step > 0 && step < 4 ? (
            <button
              onClick={() => setStep((s) => s - 1)}
              className="text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              {tCommon("actions.back")}
            </button>
          ) : null}
          <div className="flex-1" />
          {step === 1 && configured === 0 && (
            <button
              onClick={() => setStep(3)}
              className="text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              {t("actions.skip")}
            </button>
          )}
          {step === 0 && (
            <Button className="h-10 gap-2 bg-violet px-5 text-white hover:bg-violet/90" onClick={() => setStep(1)}>
              {tCommon("actions.continue")} <ArrowRight className="size-4" />
            </Button>
          )}
          {step === 1 && (
            <Button
              className="h-10 gap-2 bg-violet px-5 text-white hover:bg-violet/90"
              disabled={busy}
              onClick={() => void saveProvider()}
            >
              {busy ? <Loader2 className="size-4 animate-spin" /> : <KeyRound className="size-4" />}
              {t("actions.saveAndContinue")}
            </Button>
          )}
          {step === 2 && (
            <Button
              className="h-10 gap-2 bg-violet px-5 text-white hover:bg-violet/90"
              disabled={busy}
              onClick={() => void saveModel()}
            >
              {tCommon("actions.continue")} <ArrowRight className="size-4" />
            </Button>
          )}
          {step === 3 && (
            <Button
              className="h-10 gap-2 bg-violet px-5 text-white hover:bg-violet/90"
              disabled={busy}
              onClick={() => void savePrefs()}
            >
              {tCommon("actions.continue")} <ArrowRight className="size-4" />
            </Button>
          )}
          {step === 4 && (
            <Button
              className="h-10 gap-2 bg-violet px-5 text-white hover:bg-violet/90"
              onClick={onDone}
            >
              {t("actions.start")} <ArrowRight className="size-4" />
            </Button>
          )}
        </footer>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-6 py-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="truncate font-mono">{value}</span>
    </div>
  );
}
