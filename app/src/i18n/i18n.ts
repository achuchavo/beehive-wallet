// Lightweight i18n. No dependency: a dictionary per language, a t(key, vars)
// lookup with {var} interpolation, English fallback, and system-language
// detection (Korean-first). Language preference persists in localStorage.

import { en } from './en'
import { ko } from './ko'

export type Lang = 'en' | 'ko'

export const LANGUAGES: { code: Lang; label: string }[] = [
  { code: 'ko', label: '한국어' },
  { code: 'en', label: 'English' },
]

const KEY = 'beehive_lang_v1'

const dict: Record<Lang, Record<string, string>> = { en, ko }

export function detectLang(): Lang {
  const stored = localStorage.getItem(KEY)
  if (stored === 'en' || stored === 'ko') return stored
  // No preference yet: follow the system language, defaulting to Korean.
  const sys = (navigator.language || '').toLowerCase()
  return sys.startsWith('en') ? 'en' : 'ko'
}

export function storeLang(lang: Lang): void {
  localStorage.setItem(KEY, lang)
}

export function translate(lang: Lang, key: string, vars?: Record<string, string | number>): string {
  let s = dict[lang][key] ?? dict.en[key] ?? key
  if (vars) {
    for (const k of Object.keys(vars)) {
      s = s.replaceAll(`{${k}}`, String(vars[k]))
    }
  }
  return s
}
