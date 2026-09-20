import { useId } from "react"

interface PhosonLogoProps {
  showText?: boolean
  size?: number
  className?: string
  /** Animate the mark — used as a loading indicator. */
  animated?: boolean
}

export function PhosonLogo({
  showText = true,
  size = 40,
  className = "",
  animated = false,
}: PhosonLogoProps) {
  const uid = useId().replace(/:/g, "")

  return (
    <div className={`flex items-center gap-3 ${className}`}>
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 130 130"
        width={size}
        height={size}
        aria-label="Phoson logo mark"
        aria-hidden={animated ? true : undefined}
        className={animated ? "phoson-logo-mark" : undefined}
      >
        <defs>
          <radialGradient id={`logoGlow-${uid}`} cx="65" cy="65" r="50" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#b89cff" stopOpacity="0.3" />
            <stop offset="60%" stopColor="#5b2eff" stopOpacity="0.1" />
            <stop offset="100%" stopColor="#5b2eff" stopOpacity="0" />
          </radialGradient>
          <radialGradient id={`lineFade-${uid}`} cx="65" cy="65" r="38" gradientUnits="userSpaceOnUse">
            <stop offset="15%" stopColor="black" />
            <stop offset="100%" stopColor="white" />
          </radialGradient>
          <mask id={`logoLineMask-${uid}`}>
            <rect width="130" height="130" fill="white" />
            <circle cx="65" cy="65" r="38" fill={`url(#lineFade-${uid})`} />
          </mask>
        </defs>

        {/* Outer ring */}
        <circle
          className={animated ? "logo-ring" : undefined}
          cx="65"
          cy="65"
          r="60"
          fill="none"
          stroke="var(--border)"
          strokeWidth="1"
        />

        {/* Hexagon */}
        <polygon
          className={animated ? "logo-hex" : undefined}
          points="65,25 100,45 100,85 65,105 30,85 30,45"
          fill="none"
          stroke="#5b2eff"
          strokeWidth="2"
          strokeLinejoin="miter"
        />

        {/* Internal structural lines */}
        <g stroke="#5b2eff" strokeWidth="1.2" mask={`url(#logoLineMask-${uid})`}>
          <line x1="65" y1="25" x2="65" y2="105" />
          <line x1="30" y1="45" x2="100" y2="85" />
          <line x1="30" y1="85" x2="100" y2="45" />
        </g>

        {/* Center glow */}
        <circle
          className={animated ? "logo-glow" : undefined}
          cx="65"
          cy="65"
          r="50"
          fill={`url(#logoGlow-${uid})`}
        />

        {/* Spark lines */}
        <g
          className={animated ? "logo-sparks" : undefined}
          stroke="#b89cff"
          strokeWidth="1.5"
          strokeLinecap="round"
        >
          <line x1="82" y1="65" x2="93" y2="65" />
          <line x1="48" y1="65" x2="37" y2="65" />
          <line x1="73" y1="52" x2="79" y2="41" />
          <line x1="57" y1="52" x2="51" y2="41" />
          <line x1="73" y1="78" x2="79" y2="89" />
          <line x1="57" y1="78" x2="51" y2="89" />
        </g>

        {/* Central star */}
        <path
          className={animated ? "logo-star" : undefined}
          d="M 65,51 Q 65,65 79,65 Q 65,65 65,79 Q 65,65 51,65 Q 65,65 65,51 Z"
          fill="#967bbf"
        />
      </svg>

      {showText && (
        <span
          style={{
            fontFamily: "'DM Sans', sans-serif",
            fontWeight: 500,
            fontSize: "1.25rem",
            letterSpacing: "-0.02em",
            color: "var(--foreground)",
          }}
        >
          Phoson
        </span>
      )}
    </div>
  )
}
