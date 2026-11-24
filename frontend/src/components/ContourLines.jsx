// Banner background: thin gold contour lines, like the guilloche on an ID card. Stacked waves made of two sines whose
// phases drift from line to line, so neighbours bunch up and spread out like a topographic map. Fixed, same every render.
// Cropped (slice), not stretched, so the waves keep their shape on any banner size. Put it inside a `relative overflow-hidden` box.
const CONTOURS = Array.from({ length: 36 }, (_, i) => {
  const y = (x) => -70 + i * 14 + 40 * Math.sin(x / 260 + i * 0.09) + 22 * Math.sin(x / 110 - i * 0.15 + 1.3)
  return Array.from({ length: 101 }, (_, k) => `${k ? 'L' : 'M'}${k * 16},${y(k * 16).toFixed(1)}`).join('')
})

export default function ContourLines() {
  return (
    <svg aria-hidden="true" viewBox="0 0 1600 400" preserveAspectRatio="xMidYMid slice" className="pointer-events-none absolute inset-0 h-full w-full">
      <g fill="none" className="stroke-gold" strokeOpacity="0.16" strokeWidth="1">
        {CONTOURS.map((d, i) => <path key={i} d={d} vectorEffect="non-scaling-stroke" />)}
      </g>
    </svg>
  )
}
