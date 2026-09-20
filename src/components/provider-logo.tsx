import { Route } from "lucide-react";

import { cn } from "@/lib/utils";

import { PROVIDER_LOGO } from "./provider-logos";

interface ProviderLogoProps {
  /** id del proveedor del engine (p.ej. "openrouter", "xai"). */
  id: string;
  /** Tamaño en px (los SVG son 1em). */
  size?: number;
  className?: string;
}

/**
 * Logo monocromo de un proveedor (LobeHub Icons, MIT).
 *
 * Los SVG usan `fill="currentColor"`, así que **heredan el color del texto**:
 * quedan en muted por defecto y en violeta cuando la fila está seleccionada,
 * sin variantes por tema ni filtros.
 *
 * Los proveedores sin logo de marca (p.ej. OmniRoute) reciben un glifo genérico
 * para que la lista nunca quede desalineada.
 */
export function ProviderLogo({ id, size = 18, className }: ProviderLogoProps) {
  const svg = PROVIDER_LOGO[id];

  if (!svg) {
    return (
      <Route
        aria-hidden
        className={cn("shrink-0 opacity-70", className)}
        style={{ width: size, height: size }}
      />
    );
  }

  return (
    <span
      aria-hidden
      className={cn("inline-flex shrink-0 items-center justify-center", className)}
      style={{ fontSize: size, lineHeight: 1 }}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
