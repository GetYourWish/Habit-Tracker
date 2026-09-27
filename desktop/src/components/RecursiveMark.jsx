/**
 * RecursiveMark — the app's brand glyph: the Habit Loop.
 *
 * Two arrows chasing each other around a circle — the recursive daily cycle
 * every habit rides — wrapped around a check, the habit itself, done. Same
 * geometry as build/icons/gradient.svg so window chrome and in-app branding
 * match.
 *
 * Props:
 *  - size: pixel size (square)
 *  - spin: when true, the loop rotates continuously (CSS animation)
 *  - className / style: passthrough
 */
export default function RecursiveMark({ size = 26, spin = false, className = '', style }) {
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
      {/* the recursive loop */}
      <g className="recursive-mark-blades" stroke="currentColor" strokeWidth="21" strokeLinecap="round">
        <path d="M 163 67.4 A 70 70 0 0 1 140.2 196.9" />
        <path d="M 93 188.6 A 70 70 0 0 1 115.8 59.1" />
      </g>
      {/* arrowheads */}
      <g fill="currentColor">
        <path d="M 124.4 199.7 L 137.9 184.1 L 142.5 209.7 Z" />
        <path d="M 131.6 56.3 L 118.1 71.9 L 113.5 46.3 Z" />
      </g>
      {/* the habit, done */}
      <path
        d="M 101 132 L 122 153 L 162 107"
        stroke="currentColor"
        strokeWidth="22"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
