import { describe, expect, it } from 'vitest'
import { en } from './en'
import { ko } from './ko'
import { translate } from './i18n'

// Every user-facing string has to exist in both dictionaries. translate() falls
// back to English for a missing key, so a gap is silent: Korean users just see
// English in the middle of a Korean page, and nothing fails until someone
// notices. These checks are what makes that loud.
describe('dictionary parity', () => {
  it('has the same keys in both languages', () => {
    const missingInKo = Object.keys(en).filter((k) => !(k in ko))
    const missingInEn = Object.keys(ko).filter((k) => !(k in en))
    expect({ missingInKo, missingInEn }).toEqual({ missingInKo: [], missingInEn: [] })
  })

  it('uses the same {placeholders} in both languages', () => {
    // A translation that drops a placeholder renders a sentence with a hole in
    // it; one that invents a placeholder renders a literal "{amt}".
    const names = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()
    const mismatched = Object.keys(en)
      .filter((k) => k in ko)
      .filter((k) => names(en[k]).join() !== names(ko[k]).join())
    expect(mismatched).toEqual([])
  })

  it('has no empty strings', () => {
    const empty = [...Object.keys(en), ...Object.keys(ko)].filter(
      (k) => (en[k] ?? '').trim() === '' || (ko[k] ?? '').trim() === '',
    )
    expect(empty).toEqual([])
  })
})

describe('translate', () => {
  it('interpolates vars', () => {
    expect(translate('en', 'history.page', { page: 2, total: 5, count: 42 })).toBe(
      'Page 2 of 5 · 42 txs',
    )
  })

  it('falls back to the key itself when nothing matches', () => {
    expect(translate('ko', 'no.such.key')).toBe('no.such.key')
  })
})
