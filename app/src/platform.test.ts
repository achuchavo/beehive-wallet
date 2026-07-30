// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { apiRoot, isNative, nativePlatform } from './platform'

// The web app and the native shells share this bundle but reach the API
// differently, and getting the WEB branch wrong would break the live site while
// every native test still passed. These assertions pin the web behaviour to
// exactly what it was before the native work: same-origin, base-aware.
describe('platform (web)', () => {
  it('is not native under test', () => {
    expect(isNative()).toBe(false)
    expect(nativePlatform()).toBeNull()
  })

  it('addresses the API on its own origin', () => {
    // BASE_URL is '/' under vitest, matching the subdomain deploy.
    expect(apiRoot()).toBe(`${window.location.origin}/api`)
  })

  it('never produces a doubled or missing slash', () => {
    const root = apiRoot()
    expect(root.endsWith('/api')).toBe(true)
    // A '//' anywhere after the scheme would mean the base and the origin were
    // joined wrongly - the exact bug a naive replace('//', '/') introduces when
    // it is applied to an absolute URL.
    expect(root.slice('https://'.length).includes('//')).toBe(false)
  })

  it('does not require VITE_API_ORIGIN on the web', () => {
    // Only native builds set it; the web must work without it.
    expect(import.meta.env.VITE_API_ORIGIN).toBeUndefined()
    expect(() => apiRoot()).not.toThrow()
  })
})
