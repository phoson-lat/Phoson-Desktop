import { Brain, Chrome, FolderTree, Palette, Plug, Rocket } from "lucide-react";
import type { ComponentType, CSSProperties } from "react";

import { cn } from "@/lib/utils";

import { mcpLogoFor } from "./mcp-logos";

/** Fallback (lucide) por familia de servidor, cuando no hay logo de marca. */
const LUCIDE_FALLBACK: {
  match: string[];
  Icon: ComponentType<{ className?: string; style?: CSSProperties }>;
}[] = [
  { match: ["filesystem", "file", "fs-", "shell"], Icon: FolderTree },
  { match: ["memory", "mem0", "knowledge", "obsidian"], Icon: Brain },
  { match: ["chrome", "devtools", "browser", "puppeteer", "playwright"], Icon: Chrome },
  { match: ["canva", "figma", "design", "image"], Icon: Palette },
  { match: ["dokploy", "deploy", "docker", "kubernetes", "k8s", "railway"], Icon: Rocket },
];

interface McpLogoProps {
  /** Nombre del servidor MCP (p. ej. "github", "brave-search", "postgres"). */
  name: string;
  size?: number;
  className?: string;
}

/**
 * Logo de un servidor MCP. Usa el SVG de marca cuando existe (LobeHub/svgl,
 * monocromo con `currentColor`, así hereda el color del texto) y cae a un icono
 * de lucide acorde a la familia del servidor.
 */
export function McpLogo({ name, size = 16, className }: McpLogoProps) {
  const svg = mcpLogoFor(name);

  if (svg) {
    return (
      <span
        aria-hidden
        className={cn("inline-flex shrink-0 items-center justify-center", className)}
        style={{ fontSize: size, lineHeight: 1 }}
        dangerouslySetInnerHTML={{ __html: svg }}
      />
    );
  }

  const key = name.toLowerCase();
  const Icon = LUCIDE_FALLBACK.find((f) => f.match.some((m) => key.includes(m)))?.Icon ?? Plug;

  return <Icon aria-hidden className={cn("shrink-0", className)} style={{ width: size, height: size }} />;
}
