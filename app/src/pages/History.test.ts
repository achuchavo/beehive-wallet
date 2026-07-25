// @vitest-environment jsdom
// Needed because History imports chains.ts, which reads window.location at
// module scope to build the API origin.
import { describe, expect, it } from 'vitest'
import { formatWhen } from './History'

// The rule this locks in: rows read in the viewer's own locale and zone, but the
// exact UTC value stays reachable in the tooltip. Showing raw UTC to everyone
// makes people convert in their heads and get it wrong; showing ONLY local time
// loses the value that matches the explorer.
describe('formatWhen', () => {
  it('keeps the chain timestamp verbatim as UTC in the tooltip', () => {
    expect(formatWhen('2026-07-21T06:39:30Z').exact).toBe('2026-07-21 06:39:30 UTC')
  })

  it('renders a readable local label, not the raw ISO string', () => {
    const { label } = formatWhen('2026-07-21T06:39:30Z')
    expect(label).not.toContain('T')
    expect(label).not.toContain('Z')
    expect(label.length).toBeGreaterThan(0)
  })

  // Some Cosmos nodes return fractional seconds. It must not throw or produce
  // "Invalid Date" - a history row is not worth breaking the page for.
  it('handles fractional seconds', () => {
    const { label, exact } = formatWhen('2026-07-21T06:39:30.123456Z')
    expect(exact).toBe('2026-07-21 06:39:30.123456 UTC')
    expect(label).not.toMatch(/Invalid/)
  })

  // An unparseable value is echoed rather than shown as "Invalid Date".
  it('falls back to the input when it is not a date', () => {
    expect(formatWhen('')).toEqual({ label: '', exact: '' })
    expect(formatWhen('not-a-date')).toEqual({ label: 'not-a-date', exact: 'not-a-date' })
  })
})
