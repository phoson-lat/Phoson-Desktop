
import { memo, useEffect, useMemo, useState } from "react"
import ReactMarkdown, { type Components, type Options as MarkdownOptions } from "react-markdown"
import remarkGfm from "remark-gfm"
import remarkMath from "remark-math"
import rehypeRaw from "rehype-raw"
import rehypeKatex from "rehype-katex"
import rehypeSanitize, { defaultSchema } from "rehype-sanitize"
import { useTheme } from "next-themes"
import { Check, Copy } from "lucide-react"
import { cn } from "@/lib/utils"
import { highlight } from "@/lib/highlighter"
import { HtmlArtifact, MermaidArtifact } from "@/components/ui/artifact-block"

// Sanitization: raw HTML from AI output is allowed through but stripped of
// everything dangerous (script, event handlers, javascript: URLs, iframes...).
// The default schema does not know KaTeX's MathML output, so we extend it
// with the MathML tags and the class/style/aria attributes KaTeX emits.
// NOTE: order matters — sanitize must run AFTER rehype-katex so it sees the
// final KaTeX markup and whitelists it.
const MATHML_TAGS = [
  "math", "semantics", "maction", "annotation", "menclose", "mfenced",
  "mfrac", "mglyph", "mi", "mmultiscripts", "mover", "mpadded", "mphantom",
  "mrow", "mroot", "ms", "mspace", "msqrt", "msub", "msubsup", "msup",
  "msupsub", "mstyle", "mtable", "mtd", "mtext", "mtr", "munder",
  "munderover", "mn", "mo",
] as const

const SANITIZE_SCHEMA = {
  ...defaultSchema,
  tagNames: [...(defaultSchema.tagNames ?? []), ...MATHML_TAGS],
  attributes: {
    ...defaultSchema.attributes,
    "*": [
      ...(defaultSchema.attributes?.["*"] ?? []),
      "class",
      "className",
      "style",
      "aria-hidden",
      "ariaHidden",
    ],
    math: ["display", "xmlns"],
    annotation: ["encoding"],
  },
}

// Static plugin arrays — defined outside so they're never recreated.
const REMARK_PLUGINS = [remarkGfm, remarkMath]
const REHYPE_PLUGINS: NonNullable<MarkdownOptions["rehypePlugins"]> = [
  rehypeRaw,
  rehypeKatex,
  [rehypeSanitize, SANITIZE_SCHEMA],
]

interface MarkdownRendererProps {
  content: string
  className?: string
  /** When true: skips Shiki, and is used during streaming. */
  streaming?: boolean
}

interface CodeBlockProps {
  code: string
  language?: string
  streaming?: boolean
}

function detectLanguage(code: string): string | undefined {
  const firstLine = code.split("\n")[0]?.trim().toLowerCase() || ""

  const patterns: [RegExp, string][] = [
    [/^(import|export|const|let|var|function|class|interface|type|async|await|=>)/, "javascript"],
    [/^(def|class|import|from|if __name__|print|self)/, "python"],
    [/^(fn|let|mut|impl|struct|enum|use|mod|pub|async|await|unsafe)/, "rust"],
    [/^(func|package|import|type|struct|interface|go|var|const)/, "go"],
    [/^(public|private|protected|class|interface|void|static|import|export)/, "java"],
    [/^(<?php|namespace|use|function|class|interface|trait)/, "php"],
    [/^(ruby|class|module|def|end|require|attr_)/, "ruby"],
    [/^(func|var|let|import|export|interface|type|enum|struct)/, "typescript"],
    [/^(#include|int|void|char|float|double|return|typedef)/, "c"],
    [/^(#include|template|class|public:|private:|protected:|namespace|std::)/, "cpp"],
    [/^(SELECT|INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|FROM|WHERE)/i, "sql"],
    [/^(dockerfile|run|copy|env|expose|cmd|from|as)/i, "dockerfile"],
    [/^(git|add|commit|push|pull|merge|branch|checkout|clone)/i, "bash"],
    [/^(\$|\?|<\?php)/, "php"],
    [/^<(!DOCTYPE|html|head|body|div|span|p|a|script|style)/i, "html"],
    [/^[.#]?[a-z-]+\s*\{/i, "css"],
    [/^\{[\s\S]*"[\w]+"\s*:/, "json"],
    [/^---\s*\n|^[\w-]+:\s*\n/m, "yaml"],
    [/^\[([\w\s-]+)\]\(http/, "markdown"],
  ]

  for (const [regex, lang] of patterns) {
    if (regex.test(firstLine)) {
      return lang
    }
  }

  return undefined
}

function CodeBlock({ code, language, streaming = false }: CodeBlockProps) {
  const { resolvedTheme } = useTheme()
  const [highlightedHtml, setHighlightedHtml] = useState<string>("")
  const [copied, setCopied] = useState(false)
  const [detectedLang, setDetectedLang] = useState<string | undefined>(language)

  useEffect(() => {
    if (!language) {
      setDetectedLang(detectLanguage(code))
    } else {
      setDetectedLang(language)
    }
  }, [code, language])

  useEffect(() => {
    if (streaming) {
      setHighlightedHtml("")
      return
    }

    // `highlight` carga el lenguaje bajo demanda (async): si el código o el tema
    // cambian mientras carga, hay que descartar el resultado obsoleto.
    let cancelled = false
    const runHighlight = async () => {
      let html: string | null = null
      try {
        html = await highlight(code, detectedLang, resolvedTheme === "dark")
      } catch {
        html = null
      }
      if (cancelled) return
      if (html) {
        setHighlightedHtml(html)
        return
      }
      const escaped = code
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
      setHighlightedHtml(`<pre class="shiki"><code>${escaped}</code></pre>`)
    }
    runHighlight()
    return () => {
      cancelled = true
    }
  }, [code, detectedLang, resolvedTheme, streaming])

  const handleCopy = async () => {
    await navigator.clipboard.writeText(code)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="my-3 overflow-hidden rounded-xl border border-border/60 bg-muted/40 dark:border-white/[0.08] dark:bg-[#0d0b14]">
      <div className="flex items-center justify-between border-b border-border/50 bg-muted/60 px-3 py-2 dark:border-white/[0.06] dark:bg-[#120e1c]">
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1">
            <div className="h-2.5 w-2.5 rounded-full bg-red-500/70" />
            <div className="h-2.5 w-2.5 rounded-full bg-yellow-500/70" />
            <div className="h-2.5 w-2.5 rounded-full bg-green-500/70" />
          </div>
          {detectedLang && (
            <span className="ml-2 text-[10px] font-medium text-muted-foreground/70">
              {detectedLang}
            </span>
          )}
        </div>
        <button
          onClick={handleCopy}
          className="rounded p-1.5 text-muted-foreground/60 transition-colors hover:bg-muted hover:text-foreground"
          title={copied ? "Copied" : "Copy code"}
          aria-label={copied ? "Copied" : "Copy code"}
        >
          {copied ? (
            <Check className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
          ) : (
            <Copy className="h-3.5 w-3.5" />
          )}
        </button>
      </div>
      <div className="overflow-x-auto p-4 text-[13px] leading-relaxed [&_pre]:!bg-transparent [&_pre]:!p-0 [&_code]:!bg-transparent">
        {streaming || !highlightedHtml ? (
          <pre className="font-mono text-foreground/80 whitespace-pre-wrap break-words">
            <code>{code}</code>
          </pre>
        ) : (
          <div dangerouslySetInnerHTML={{ __html: highlightedHtml }} />
        )}
      </div>
    </div>
  )
}

function MarkdownRendererBase({ content, className, streaming = false }: MarkdownRendererProps) {
  const components = useMemo<Components>(
    () => ({
      h1: ({ children, ...props }) => (
        <h1 className="mb-3 mt-5 text-xl font-semibold tracking-tight text-foreground" {...props}>
          {children}
        </h1>
      ),
      h2: ({ children, ...props }) => (
        <h2 className="mb-2.5 mt-4 text-lg font-semibold tracking-tight text-foreground" {...props}>
          {children}
        </h2>
      ),
      h3: ({ children, ...props }) => (
        <h3 className="mb-2 mt-3 text-base font-semibold tracking-tight text-foreground" {...props}>
          {children}
        </h3>
      ),
      p: ({ children, ...props }) => (
        <p className="mb-3 last:mb-0 leading-relaxed" {...props}>
          {children}
        </p>
      ),
      ul: ({ children, ...props }) => (
        <ul className="mb-3 list-disc space-y-1 pl-5" {...props}>
          {children}
        </ul>
      ),
      ol: ({ children, ...props }) => (
        <ol className="mb-3 list-decimal space-y-1 pl-5" {...props}>
          {children}
        </ol>
      ),
      li: ({ children, ...props }) => (
        <li className="leading-relaxed" {...props}>
          {children}
        </li>
      ),
      blockquote: ({ children, ...props }) => (
        <blockquote
          className="my-3 border-l-2 border-violet/30 bg-violet/[0.04] py-2 pl-4 pr-3 text-muted-foreground italic"
          {...props}
        >
          {children}
        </blockquote>
      ),
      code: ({ children, className: codeClassName, ...props }) => {
        const match = /language-(\w+)/.exec(codeClassName || "")
        const language = match ? match[1] : ""
        const code = String(children).replace(/\n$/, "")

        // Artifact: Mermaid diagram
        if (language === "mermaid") {
          return <MermaidArtifact code={code} streaming={streaming} />
        }

        // Artifact: raw HTML block
        if (language === "html") {
          return <HtmlArtifact code={code} streaming={streaming} />
        }

        // Fenced code block with syntax highlighting
        const isFencedBlock = codeClassName != null || code.includes("\n")
        if (isFencedBlock) {
          return <CodeBlock code={code} language={language || undefined} streaming={streaming} />
        }

        // Inline code
        return (
          <code
            className="rounded border border-border/50 bg-muted/60 px-1.5 py-0.5 font-mono text-[13px] text-foreground dark:border-white/[0.06] dark:bg-white/[0.04]"
            {...props}
          >
            {children}
          </code>
        )
      },
      pre: ({ children }) => <>{children}</>,
      table: ({ children, ...props }) => (
        <div className="my-3 overflow-x-auto rounded-xl border border-border/50 dark:border-white/[0.06]">
          <table className="w-full text-sm" {...props}>
            {children}
          </table>
        </div>
      ),
      thead: ({ children, ...props }) => (
        <thead className="bg-muted/60 dark:bg-white/[0.04]" {...props}>
          {children}
        </thead>
      ),
      th: ({ children, ...props }) => (
        <th
          className="border-b border-border/50 px-3 py-2 text-left font-semibold text-foreground dark:border-white/[0.06]"
          {...props}
        >
          {children}
        </th>
      ),
      td: ({ children, ...props }) => (
        <td
          className="border-b border-border/30 px-3 py-2 text-muted-foreground dark:border-white/[0.04]"
          {...props}
        >
          {children}
        </td>
      ),
      tr: ({ children, ...props }) => (
        <tr className="transition-colors hover:bg-muted/30 dark:hover:bg-white/[0.02]" {...props}>
          {children}
        </tr>
      ),
      a: ({ children, href, ...props }) => (
        <a
          href={href}
          className="text-violet underline-offset-3 hover:text-violet-soft hover:underline"
          target="_blank"
          rel="noopener noreferrer"
          {...props}
        >
          {children}
        </a>
      ),
      img: ({ src, alt, ...props }) => (
        <img
          src={src}
          alt={alt}
          className="my-2 max-w-full rounded-xl border border-border/50 dark:border-white/[0.06]"
          {...props}
        />
      ),
      hr: ({ ...props }) => (
        <hr className="my-4 border-border/40 dark:border-white/[0.06]" {...props} />
      ),
      strong: ({ children, ...props }) => (
        <strong className="font-semibold text-foreground" {...props}>
          {children}
        </strong>
      ),
      em: ({ children, ...props }) => (
        <em className="italic" {...props}>
          {children}
        </em>
      ),
      del: ({ children, ...props }) => (
        <del className="text-muted-foreground line-through" {...props}>
          {children}
        </del>
      ),
      input: ({ type, checked, ...props }) => {
        if (type === "checkbox") {
          return (
            <input
              type="checkbox"
              checked={checked}
              readOnly
              className="mr-2 h-4 w-4 accent-violet"
              {...props}
            />
          )
        }
        return <input type={type} {...props} />
      },
    }),
    [streaming],
  )

  return (
    <div className={cn("prose-chat", className)}>
      <ReactMarkdown
        remarkPlugins={REMARK_PLUGINS}
        rehypePlugins={REHYPE_PLUGINS}
        components={components}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}

/**
 * Memoizado por `content`/`streaming`: en un mensaje con tools intercaladas,
 * solo el bloque que cambia vuelve a ejecutar remark/rehype/KaTeX.
 */
export const MarkdownRenderer = memo(MarkdownRendererBase)
