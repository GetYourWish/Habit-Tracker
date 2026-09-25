/**
 * RecursiveMark — the app's brand glyph.
 *
 * A rotating line that calls itself: each blade is the previous one rotated
 * 42° and scaled to 0.78 (a self-similar spiral), anchored by a six-pointed
 * "start" spark at the pivot. Same geometry as build/icons/gradient.svg so
 * window chrome and in-app branding match.
 *
 * Props:
 *  - size: pixel size (square)
 *  - spin: when true, the blades rotate continuously (CSS animation)
 *  - className / style: passthrough
 */
export default function RecursiveMark({ size = 26, spin = false, className = '', style }) {
  const id = `rm-blade-${size}`
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 256 256"
      fill="none"
      className={`${className} recursive-mark${spin ? ' recursive-mark-spin' : ''}`}
      style={style}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.35" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="1" />
        </linearGradient>
      </defs>
      <g transform="translate(128 128)">
        {/* recursive blades: rotate(42°·n) · scale(0.78ⁿ) */}
        <g className="recursive-mark-blades">
          {[0, 1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
            <g key={n} transform={`rotate(${n * 42}) scale(${Math.pow(0.78, n)})`}>
              <rect x="-9" y="-88" width="18" height="88" rx="9" fill={`url(#${id})`} />
            </g>
          ))}
        </g>
        {/* start symbol: six-pointed spark at the origin */}
        <g fill="currentColor">
          <circle cx="0" cy="0" r="7" />
          {[0, 60, 120, 180, 240, 300].map((deg) => (
            <rect
              key={deg}
              x="-2.5"
              y="-24"
              width="5"
              height="17"
              rx="2.5"
              transform={`rotate(${deg})`}
            />
          ))}
        </g>
      </g>
    </svg>
  )
}
