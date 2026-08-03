import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
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

  // Parity cannot catch a key deleted from BOTH files while a page still calls
  // t() with it - translate() then renders the raw key on screen and nothing
  // fails. That happened once (rewards.claimableRewards, removed in a refactor
  // but still used by Staking), which is why this walks the real source.
  it('every t(\'...\') literal used in src exists in the dictionary', () => {
    const srcRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
    const used = new Map<string, string>()
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name)
        if (statSync(p).isDirectory()) walk(p)
        else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) {
          for (const m of readFileSync(p, 'utf8').matchAll(/\bt\(\s*'([a-zA-Z0-9_.]+)'/g)) {
            if (!used.has(m[1])) used.set(m[1], name)
          }
        }
      }
    }
    walk(srcRoot)
    const missing = [...used.entries()]
      .filter(([key]) => !(key in en))
      .map(([key, file]) => `${key} (${file})`)
    expect(missing).toEqual([])
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
