import { useEffect, useRef, useState } from 'react'

const DURATION_MS = 900
/** Interpolation precision. Fractions are integers over this, never floats. */
const SCALE = 100000n

// Ease-out cubic: fast start, gentle settle.
const ease = (t: number) => 1 - (1 - t) ** 3

/**
 * Animate a base-unit amount from a previous value up (or down) to the current
 * one, formatting each frame with the caller's formatter.
 *
 * Two things this must never do:
 *
 *  1. Go through Number. Base-unit balances exceed Number.MAX_SAFE_INTEGER
 *     routinely (HUAHUA's supply is ~13x past it), so the whole interpolation
 *     runs in BigInt - the eased fraction is scaled to an integer first.
 *  2. Leave an interpolated value on screen. The animation is decoration; the
 *     final frame is always the exact `value` string, assigned directly rather
 *     than arrived at, so a dropped frame or an interrupted animation cannot
 *     leave a wrong balance displayed.
 */
export default function CountUp({
  value,
  from,
  format,
  className = '',
}: {
  /** Target, as an exact base-unit integer string. */
  value: string
  /** Starting point. Omit (or pass the same value) to render without animating. */
  from?: string
  format: (base: string) => string
  className?: string
}) {
  const [display, setDisplay] = useState(() => format(from ?? value))
  const frameRef = useRef<number | undefined>(undefined)
  // Callers pass an inline arrow, so `format` is a new function on every
  // render. Keeping it in a ref stops it from being an effect dependency -
  // otherwise each render restarts the animation and it never finishes.
  const formatRef = useRef(format)
  formatRef.current = format

  useEffect(() => {
    const format = formatRef.current
    const target = BigInt(value)
    const start = from !== undefined && /^\d+$/.test(from) ? BigInt(from) : target

    // Nothing to animate, or the user asked for less motion: land immediately.
    const reduced =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

    if (start === target || reduced) {
      setDisplay(format(value))
      return
    }

    const diff = target - start
    const t0 = performance.now()

    const step = (now: number) => {
      const progress = Math.min(1, (now - t0) / DURATION_MS)
      if (progress >= 1) {
        // Exact final value - not the last interpolated frame.
        setDisplay(format(value))
        return
      }
      const scaled = BigInt(Math.round(ease(progress) * Number(SCALE)))
      setDisplay(format((start + (diff * scaled) / SCALE).toString()))
      frameRef.current = requestAnimationFrame(step)
    }
    frameRef.current = requestAnimationFrame(step)

    return () => {
      if (frameRef.current !== undefined) cancelAnimationFrame(frameRef.current)
      // If this unmounts or `value` changes mid-flight, the next render still
      // shows a true figure rather than wherever the animation stopped.
      setDisplay(format(value))
    }
  }, [value, from])

  return <span className={className}>{display}</span>
}
