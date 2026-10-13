import { FolderOpen } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";

import { BRAND_LOGO } from "./brand-logos";

interface BrandLogoProps {
  /** id de marca: "vscode" | "cursor" | "windsurf" | "zed" | "windows" | "finder" | "linux". */
  id: string;
  /** Tamaño en px (los SVG son 1em). */
  size?: number;
  className?: string;
}

/**
 * Logo oficial de una marca (svgl.app) a color. Las marcas con variante para
 * tema oscuro (Cursor, Windsurf, Zed, Finder/Apple) cambian con `next-themes`;
 * el resto usa el mismo SVG en ambos temas.
 *
 * Sin logo conocido: carpeta genérica, para que la fila nunca quede desalineada.
 */
export function BrandLogo({ id, size = 16, className }: BrandLogoProps) {
  const { resolvedTheme } = useTheme();
  // SSR/hidratación: hasta montar no se sabe el tema real; se pinta `light`.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const variants = BRAND_LOGO[id];

  if (!variants) {
    return (
      <FolderOpen
        aria-hidden
        className={cn("shrink-0 opacity-70", className)}
        style={{ width: size, height: size }}
      />
    );
  }

  const svg =
    mounted && resolvedTheme === "dark" && variants.dark ? variants.dark : variants.light;

  return (
    <span
      aria-hidden
      className={cn("inline-flex shrink-0 items-center justify-center", className)}
      style={{ fontSize: size, lineHeight: 1 }}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
