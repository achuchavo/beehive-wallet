// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest'
import {
  isInAppBrowser,
  requestPersistentStorage,
  getStorageState,
  storageAtRisk,
} from './storagePersistence'

/**
 * A user reported importing a wallet on Android, leaving, and finding it gone.
 * These cover the two things that cause that: evictable storage, and an in-app
 * WebView with its own short-lived storage jar.
 */

function stubStorage(impl: Partial<StorageManager> | undefined) {
  Object.defineProperty(navigator, 'storage', {
    configurable: true,
    get: () => impl,
  })
}

afterEach(() => {
  vi.restoreAllMocks()
  stubStorage(undefined)
})

describe('isInAppBrowser', () => {
  // The reported case came through KakaoTalk.
  it('recognises KakaoTalk', () => {
    expect(isInAppBrowser('Mozilla/5.0 (Linux; Android 14) KAKAOTALK 10.5.0')).toBe(true)
  })

  it('recognises the other common embedded browsers', () => {
    for (const ua of [
      'Mozilla/5.0 NAVER(inapp; search; 1000; 12.0)',
      'Mozilla/5.0 Instagram 300.0.0.0 Android',
      'Mozilla/5.0 [FBAN/FBIOS;FBAV/450.0]',
      'Mozilla/5.0 Line/13.0.0',
    ]) {
      expect(isInAppBrowser(ua)).toBe(true)
    }
  })

  it('does not flag ordinary mobile browsers', () => {
    for (const ua of [
      'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36',
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) Version/18.0 Mobile Safari/604.1',
      'Mozilla/5.0 (Linux; Android 14; SM-S918B) SamsungBrowser/23.0 Chrome/115 Mobile',
    ]) {
      expect(isInAppBrowser(ua)).toBe(false)
    }
  })
})

describe('requestPersistentStorage', () => {
  it('returns false when the API is missing, without throwing', async () => {
    stubStorage(undefined)
    await expect(requestPersistentStorage()).resolves.toBe(false)
  })

  it('does not re-ask when already granted', async () => {
    const persist = vi.fn().mockResolvedValue(true)
    stubStorage({ persisted: vi.fn().mockResolvedValue(true), persist } as never)
    await expect(requestPersistentStorage()).resolves.toBe(true)
    expect(persist).not.toHaveBeenCalled()
  })

  it('asks when not yet granted', async () => {
    const persist = vi.fn().mockResolvedValue(true)
    stubStorage({ persisted: vi.fn().mockResolvedValue(false), persist } as never)
    await expect(requestPersistentStorage()).resolves.toBe(true)
    expect(persist).toHaveBeenCalledTimes(1)
  })

  it('swallows a rejection - this must never break wallet creation', async () => {
    stubStorage({
      persisted: vi.fn().mockRejectedValue(new Error('nope')),
      persist: vi.fn(),
    } as never)
    await expect(requestPersistentStorage()).resolves.toBe(false)
  })
})

describe('storageAtRisk', () => {
  it('warns when the browser says storage is evictable', () => {
    expect(storageAtRisk({ supported: true, persisted: false, inAppBrowser: false })).toBe(true)
  })

  it('is quiet when storage is persistent', () => {
    expect(storageAtRisk({ supported: true, persisted: true, inAppBrowser: false })).toBe(false)
  })

  it('warns in an in-app browser even if storage claims to be persistent', () => {
    // Persistence within a jar that is discarded with the WebView, and is not
    // the user's real browser anyway, is not reassuring.
    expect(storageAtRisk({ supported: true, persisted: true, inAppBrowser: true })).toBe(true)
  })

  it('stays quiet when the API is simply absent', () => {
    // No API is not evidence of a problem. Warning everyone there would be noise
    // that teaches people to ignore the message.
    expect(storageAtRisk({ supported: false, persisted: false, inAppBrowser: false })).toBe(false)
  })
})

describe('getStorageState', () => {
  it('reports unsupported without throwing when the API is absent', async () => {
    stubStorage(undefined)
    await expect(getStorageState()).resolves.toMatchObject({ supported: false, persisted: false })
  })

  it('reports what the browser says', async () => {
    stubStorage({ persisted: vi.fn().mockResolvedValue(true) } as never)
    await expect(getStorageState()).resolves.toMatchObject({ supported: true, persisted: true })
  })
})
