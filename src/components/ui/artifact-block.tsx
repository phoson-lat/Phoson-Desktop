
import { useEffect, useId, useRef, useState } from "react"
import * as DialogPrimitive from "@radix-ui/react-dialog"
import { Code2, GitBranch, Globe, X, Eye, Code } from "lucide-react"
import { useTheme } from "next-themes"
import { cn } from "@/lib/utils"

/** Tema con el que se inicializó mermaid (global): evita re-init en cada render. */
let mermaidInitedTheme: string | null = null

/* ── Shared card chrome ──────────────────────────────────────────── */

type ArtifactType = "html" | "mermaid"

const TYPE_CONFIG: Record<ArtifactType, {
  label: string
  Icon: React.FC<{ className?: string }>
  headerCls: string
  badgeCls: string
}> = {
  html: {
    label: "HTML",
    Icon: ({ className }) => <Globe className={className} />,
    headerCls: "from-orange-500/[0.07] to-amber-500/[0.04] dark:from-orange-500/[0.12] dark:to-amber-500/[0.06] border-orange-500/20",
    badgeCls: "bg-orange-500/10 text-orange-600 dark:text-orange-300 border-orange-500/25",
  },
  mermaid: {
    label: "Diagram",
    Icon: ({ className }) => <GitBranch className={className} />,
    headerCls: "from-blue-500/[0.07] to-cyan-500/[0.04] dark:from-blue-500/[0.12] dark:to-cyan-500/[0.06] border-blue-500/20",
    badgeCls: "bg-blue-500/10 text-blue-600 dark:text-blue-300 border-blue-500/25",
  },
}

function ArtifactCard({
  type,
  headerActions,
  children,
}: {
  type: ArtifactType
  headerActions?: React.ReactNode
  children: React.ReactNode
}) {
  const { label, Icon, headerCls, badgeCls } = TYPE_CONFIG[type]

  return (
    <div className="my-3 overflow-hidden rounded-xl border border-[var(--dashboard-border)] bg-[var(--dashboard-panel)] shadow-sm backdrop-blur-sm">
      <div className={cn(
        "flex items-center justify-between px-3.5 py-2 border-b border-[var(--dashboard-border)] bg-gradient-to-r",
        headerCls,
      )}>
        <div className="flex items-center gap-2">
          <Icon className="size-3.5 text-muted-foreground" />
          <span className={cn(
            "text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full border",
            badgeCls,
          )}>
            {label}
          </span>
        </div>
        {headerActions && (
          <div className="flex items-center gap-1">
            {headerActions}
          </div>
        )}
      </div>
      {children}
    </div>
  )
}

/* ── Side panel (used by HTML) ───────────────────────────────────── */

function SidePanel({
  open,
  onOpenChange,
  type,
  children,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  type: ArtifactType
  children: React.ReactNode
}) {
  const { label, Icon, headerCls, badgeCls } = TYPE_CONFIG[type]

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        {/* Overlay */}
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0" />

        {/* Panel sliding from the right */}
        <DialogPrimitive.Content
          className={cn(
            "fixed right-0 top-0 z-50 flex h-full w-[58vw] min-w-[380px] max-w-3xl flex-col",
            "border-l border-[var(--dashboard-border)] bg-background shadow-2xl",
            "data-[state=open]:animate-in data-[state=open]:slide-in-from-right data-[state=open]:duration-300",
            "data-[state=closed]:animate-out data-[state=closed]:slide-out-to-right data-[state=closed]:duration-200",
          )}
        >
          {/* Panel header */}
          <div className={cn(
            "flex items-center justify-between px-4 py-3 border-b border-[var(--dashboard-border)] bg-gradient-to-r shrink-0",
            headerCls,
          )}>
            <div className="flex items-center gap-2">
              <Icon className="size-4 text-muted-foreground" />
              <DialogPrimitive.Title className={cn(
                "text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full border",
                badgeCls,
              )}>
                {label} Artifact
              </DialogPrimitive.Title>
            </div>
            <DialogPrimitive.Close className="rounded-md p-1.5 text-muted-foreground hover:text-foreground hover:bg-black/[0.05] dark:hover:bg-white/[0.07] transition-colors">
              <X className="size-4" />
            </DialogPrimitive.Close>
          </div>

          {/* Panel content */}
          <div className="flex-1 overflow-hidden">
            {children}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}

/* ── HTML artifact ───────────────────────────────────────────────── */

/**
 * Base inyectada en el `srcDoc` de los artifacts HTML.
 *
 * El lienzo de un iframe usa el color por defecto del documento (`Canvas`, que
 * es blanco), NO el fondo del elemento — por eso la preview salía blanca en
 * tema oscuro. Inyectamos el fondo del tema explícitamente (dentro del iframe no
 * existen nuestras variables CSS).
 */
function htmlArtifactBase(dark: boolean): string {
  const bg = dark ? "#111112" : "#ffffff";
  const fg = dark ? "#f2f2f2" : "#0d0d0d";
  return (
    "<style>html,body{margin:0;padding:0;" +
    `background:${bg};color:${fg};` +
    "font-family:inherit;font-size:13px;line-height:1.5}</style>"
  );
}

export function HtmlArtifact({ code, streaming = false }: { code: string; streaming?: boolean }) {
  const { resolvedTheme } = useTheme()
  const [panelOpen, setPanelOpen] = useState(false)
  const doc = htmlArtifactBase(resolvedTheme === "dark") + code
  // Mientras el fence ```html aún crece, `srcDoc` cambia en cada token y
  // recargaría el iframe (re-parse + re-ejecución) en cada flush. Mostramos un
  // esqueleto hasta que el bloque termina.
  if (streaming) {
    return (
      <ArtifactCard type="html">
        <div className="relative flex items-center justify-center" style={{ height: 170 }}>
          <div className="phoson-shimmer pointer-events-none absolute inset-0 opacity-70" />
          <p className="relative text-[11px] text-muted-foreground tracking-wide">
            Building preview
            <span className="phoson-dots">
              <span>.</span>
              <span>.</span>
              <span>.</span>
            </span>
          </p>
        </div>
      </ArtifactCard>
    )
  }
  return (
    <>
      <ArtifactCard
        type="html"
        headerActions={
          <button
            onClick={() => setPanelOpen(true)}
            className="flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors rounded-md px-2 py-1 hover:bg-black/[0.05] dark:hover:bg-white/[0.07]"
          >
            <Code2 className="size-3" />
            <span>Open</span>
          </button>
        }
      >
        {/* Preview — pointer-events disabled so clicks pass through to Open */}
        <div className="relative" style={{ height: 170 }}>
          <iframe
            srcDoc={doc}
            sandbox="allow-scripts"
            className="w-full h-full border-0 bg-[var(--phoson-surface)]"
            style={{ pointerEvents: "none" }}
            title="HTML preview"
          />
          {/* Click-to-open overlay */}
          <button
            onClick={() => setPanelOpen(true)}
            className="absolute inset-0 w-full h-full bg-transparent cursor-pointer"
            aria-label="Open HTML artifact"
          />
          {/* Bottom fade */}
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-[var(--dashboard-panel)] to-transparent" />
        </div>
      </ArtifactCard>

      <SidePanel open={panelOpen} onOpenChange={setPanelOpen} type="html">
        <iframe
          srcDoc={doc}
          sandbox="allow-scripts"
          className="w-full h-full border-0 bg-[var(--phoson-surface)]"
          title="HTML artifact"
        />
      </SidePanel>
    </>
  )
}

/* ── Mermaid ─────────────────────────────────────────────────────── */

/** Shown while mermaid code is still streaming in, or while mermaid renders. */
function MermaidBuilding({ label = "Building diagram" }: { label?: string }) {
  return (
    <div className="relative flex flex-col items-center justify-center gap-5 py-10 px-6 select-none">
      {/* Barrido de brillo continuo */}
      <div className="phoson-shimmer pointer-events-none absolute inset-0 opacity-70" />

      {/* Animated graph skeleton */}
      <div className="relative flex flex-col items-center gap-2">
        {/* Row 1: single node */}
        <div
          className="h-8 w-24 rounded-lg border-2 border-blue-400/35 bg-blue-500/10 animate-pulse"
          style={{ animationDelay: "0ms" }}
        />

        {/* Connector ↓ */}
        <div className="h-5 w-px bg-gradient-to-b from-blue-400/35 to-violet-400/35 animate-pulse" style={{ animationDelay: "150ms" }} />

        {/* Row 2: two nodes */}
        <div className="flex items-center gap-3">
          <div
            className="h-8 w-20 rounded-lg border-2 border-violet-400/35 bg-violet-500/10 animate-pulse"
            style={{ animationDelay: "200ms" }}
          />
          <div className="h-px w-6 bg-violet-400/30 animate-pulse" style={{ animationDelay: "300ms" }} />
          <div
            className="h-8 w-20 rounded-lg border-2 border-violet-400/35 bg-violet-500/10 animate-pulse"
            style={{ animationDelay: "350ms" }}
          />
        </div>

        {/* Connectors ↓↓ */}
        <div className="flex gap-[72px]">
          <div className="h-5 w-px bg-gradient-to-b from-violet-400/35 to-emerald-400/35 animate-pulse" style={{ animationDelay: "400ms" }} />
          <div className="h-5 w-px bg-gradient-to-b from-violet-400/35 to-emerald-400/35 animate-pulse" style={{ animationDelay: "500ms" }} />
        </div>

        {/* Row 3: two leaf nodes */}
        <div className="flex items-center gap-3">
          <div
            className="h-8 w-20 rounded-lg border-2 border-emerald-400/35 bg-emerald-500/10 animate-pulse"
            style={{ animationDelay: "550ms" }}
          />
          <div className="w-6" />
          <div
            className="h-8 w-20 rounded-lg border-2 border-emerald-400/35 bg-emerald-500/10 animate-pulse"
            style={{ animationDelay: "650ms" }}
          />
        </div>
      </div>

      <p className="text-[11px] text-muted-foreground tracking-wide">
        {label}
        <span className="phoson-dots">
          <span>.</span>
          <span>.</span>
          <span>.</span>
        </span>
      </p>
    </div>
  )
}

function MermaidRenderer({ code }: { code: string }) {
  const { resolvedTheme } = useTheme()
  const uid = useId().replace(/:/g, "")
  const idRef = useRef(`mermaid-${uid}`)
  const [svg, setSvg] = useState<string>("")
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let mounted = true
    setSvg("")
    setError(null)

    import("mermaid")
      .then(({ default: mermaid }) => {
        // `initialize` configura mermaid GLOBALMENTE: hacerlo en cada render es
        // caro y reconfigura para todos los diagramas. Solo al cambiar de tema.
        const theme = resolvedTheme === "dark" ? "dark" : "default"
        if (mermaidInitedTheme !== theme) {
          mermaid.initialize({
            startOnLoad: false,
            theme,
            securityLevel: "strict",
            fontFamily: "inherit",
          })
          mermaidInitedTheme = theme
        }
        return mermaid.render(idRef.current, code)
      })
      .then(({ svg: rendered }) => {
        if (mounted) setSvg(rendered)
      })
      .catch((err: unknown) => {
        if (mounted) setError(String(err))
      })

    return () => { mounted = false }
  }, [code, resolvedTheme])

  if (error) {
    return (
      <p className="p-4 text-xs text-destructive font-mono break-all">
        {error}
      </p>
    )
  }

  if (!svg) {
    // No usar un texto muerto: mantenemos la animación de construcción mientras
    // se carga/renderiza mermaid (el chunk es grande en el primer uso).
    return <MermaidBuilding label="Rendering diagram" />
  }

  return (
    <div
      className="flex items-center justify-center p-6 overflow-auto [&_svg]:max-w-full [&_svg]:h-auto"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  )
}

export function MermaidArtifact({ code, streaming }: { code: string; streaming?: boolean }) {
  const [showCode, setShowCode] = useState(false)

  return (
    <ArtifactCard
      type="mermaid"
      headerActions={
        !streaming && (
          <button
            onClick={() => setShowCode((v) => !v)}
            className="flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors rounded-md px-2 py-1 hover:bg-black/[0.05] dark:hover:bg-white/[0.07]"
          >
            {showCode ? (
              <><Eye className="size-3" /><span>Diagram</span></>
            ) : (
              <><Code className="size-3" /><span>Code</span></>
            )}
          </button>
        )
      }
    >
      <div className="overflow-auto" style={{ maxHeight: 340 }}>
        {streaming ? (
          <MermaidBuilding />
        ) : showCode ? (
          <pre className="p-4 text-[12.5px] font-mono text-foreground/80 whitespace-pre overflow-x-auto leading-relaxed">
            {code}
          </pre>
        ) : (
          <MermaidRenderer code={code} />
        )}
      </div>
    </ArtifactCard>
  )
}
