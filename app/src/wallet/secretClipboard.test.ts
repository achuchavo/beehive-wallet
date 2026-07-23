// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { copySecretTemporarily, cancelPendingSecretClear } from './secretClipboard'

const SECRET = 'abandon abandon abandon ability'

function stubClipboard(initial = '', opts: { readThrows?: boolean; writeThrows?: boolean } = {}) {
  let store = initial
  const writes: string[] = []
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: {
      writeText: (v: string) => {
        if (opts.writeThrows) return Promise.reject(new Error('denied'))
        writes.push(v)
        store = v
        return Promise.resolve()
      },
      readText: () =>
        opts.readThrows ? Promise.reject(new Error('denied')) : Promise.resolve(store),
    },
  })
  return { writes, current: () => store }
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  cancelPendingSecretClear()
  vi.useRealTimers()
})

describe('copySecretTemporarily', () => {
  it('writes the secret and reports success', async () => {
    const cb = stubClipboard()
    await expect(copySecretTemporarily(SECRET)).resolves.toBe(true)
    expect(cb.current()).toBe(SECRET)
  })

  it('reports failure when the clipboard is unavailable', async () => {
    stubClipboard('', { writeThrows: true })
    // The caller needs to know, so it can tell the user to write it down
    // instead of silently believing the copy worked.
    await expect(copySecretTemporarily(SECRET)).resolves.toBe(false)
  })

  it('clears the clipboard afterwards if it still holds the secret', async () => {
    const cb = stubClipboard()
    await copySecretTemporarily(SECRET)
    expect(cb.current()).toBe(SECRET)
    await vi.advanceTimersByTimeAsync(30_000)
    expect(cb.current()).toBe('')
  })

  // The guard that matters: wiping unconditionally would destroy whatever the
  // user copied in the meantime.
  it('leaves the clipboard alone if the user copied something else', async () => {
    const cb = stubClipboard()
    await copySecretTemporarily(SECRET)
    // User copies something of their own before the timer fires.
    await navigator.clipboard.writeText('a bank account number I need')
    await vi.advanceTimersByTimeAsync(30_000)
    expect(cb.current()).toBe('a bank account number I need')
  })

  // If we cannot READ the clipboard we cannot know what is in it, so we must
  // not overwrite. The on-screen reveal limits exposure in that case.
  it('does not overwrite blindly when the clipboard cannot be read', async () => {
    const cb = stubClipboard(SECRET, { readThrows: true })
    await copySecretTemporarily(SECRET)
    const writesBefore = cb.writes.length
    await vi.advanceTimersByTimeAsync(30_000)
    expect(cb.writes.length).toBe(writesBefore)
  })

  it('cancelling stops a pending clear', async () => {
    const cb = stubClipboard()
    await copySecretTemporarily(SECRET)
    cancelPendingSecretClear()
    await vi.advanceTimersByTimeAsync(30_000)
    expect(cb.current()).toBe(SECRET)
  })

  it('a second copy supersedes the first timer rather than stacking', async () => {
    const cb = stubClipboard()
    await copySecretTemporarily(SECRET)
    await vi.advanceTimersByTimeAsync(20_000)
    await copySecretTemporarily(SECRET) // resets the clock
    await vi.advanceTimersByTimeAsync(20_000) // 40s since first copy, 20s since second
    expect(cb.current()).toBe(SECRET) // not cleared yet
    await vi.advanceTimersByTimeAsync(10_000)
    expect(cb.current()).toBe('')
  })
})
