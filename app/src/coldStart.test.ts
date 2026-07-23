// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import {
  noteHidden,
  noteVisible,
  resetColdStart,
  peekColdStart,
  BACKGROUND_COLD_MS,
} from './coldStart'

const T0 = 1_800_000_000_000 // fixed clock; the rule takes injectable timestamps
const mins = (n: number) => n * 60 * 1000

beforeEach(() => {
  // Start warm: a session already in progress is the interesting case.
  resetColdStart(false)
})

describe('background-to-cold rule', () => {
  it('stays warm for a brief background trip', () => {
    noteHidden(T0)
    noteVisible(T0 + mins(2))
    expect(peekColdStart()).toBe(false)
  })

  it('goes cold after a long background trip', () => {
    noteHidden(T0)
    noteVisible(T0 + mins(20))
    expect(peekColdStart()).toBe(true)
  })

  it('treats exactly the threshold as cold', () => {
    noteHidden(T0)
    noteVisible(T0 + BACKGROUND_COLD_MS)
    expect(peekColdStart()).toBe(true)
  })

  it('stays warm one millisecond under the threshold', () => {
    noteHidden(T0)
    noteVisible(T0 + BACKGROUND_COLD_MS - 1)
    expect(peekColdStart()).toBe(false)
  })

  // Some browsers fire visibilitychange on load, or twice in a row. Without a
  // recorded hidden timestamp there is no elapsed time to judge, so this must
  // not silently promote the session to cold.
  it('ignores a visible event with no preceding hidden event', () => {
    noteVisible(T0 + mins(60))
    expect(peekColdStart()).toBe(false)
  })

  it('does not re-trigger on a second visible event', () => {
    noteHidden(T0)
    noteVisible(T0 + mins(20))
    resetColdStart(false) // simulate the mount consuming the cold flag
    noteVisible(T0 + mins(40))
    expect(peekColdStart()).toBe(false)
  })

  // Backgrounding twice must measure the LATEST trip, not the first.
  it('measures the most recent background period', () => {
    noteHidden(T0)
    noteVisible(T0 + mins(20)) // long trip -> cold
    resetColdStart(false)
    noteHidden(T0 + mins(30))
    noteVisible(T0 + mins(31)) // short trip -> stays warm
    expect(peekColdStart()).toBe(false)
  })

  it('never flips an already-cold session back to warm', () => {
    resetColdStart(true)
    noteHidden(T0)
    noteVisible(T0 + mins(1))
    expect(peekColdStart()).toBe(true)
  })

  it('is 15 minutes', () => {
    expect(BACKGROUND_COLD_MS).toBe(15 * 60 * 1000)
  })
})
