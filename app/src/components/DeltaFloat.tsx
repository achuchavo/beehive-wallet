import { useEffect, useState } from 'react'

const VISIBLE_MS = 2600

/**
 * The "+1.23 MED" that drifts up and fades after the totals settle, showing the
 * change since the last time the dashboard was open.
 *
 * It is announced politely rather than hidden: it is real information about the
 * user's money, not decoration. Under prefers-reduced-motion it simply appears
 * and disappears without the drift.
 */
export default function DeltaFloat({
  text,
  positive,
  onDone,
}: {
  text: string
  positive: boolean
  onDone: () => void
}) {
  const [leaving, setLeaving] = useState(false)

  useEffect(() => {
    // Next frame, so the element paints at its start position before the
    // transition to the end position begins.
    const raf = requestAnimationFrame(() => setLeaving(true))
    const timer = setTimeout(onDone, VISIBLE_MS)
    return () => {
      cancelAnimationFrame(raf)
      clearTimeout(timer)
    }
  }, [onDone])

  return (
    <span
      role="status"
      aria-live="polite"
      className={`pointer-events-none absolute right-0 top-0 select-none whitespace-nowrap text-sm font-semibold transition-all duration-[2200ms] ease-out motion-reduce:transition-none ${
        positive ? 'text-green-700' : 'text-red-600'
      } ${leaving ? '-translate-y-6 opacity-0' : 'translate-y-0 opacity-100'}`}
    >
      {text}
    </span>
  )
}
