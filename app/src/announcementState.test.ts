// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import {
  shouldShowAnnouncement,
  markAnnouncementShown,
  dismissAnnouncement,
  snoozeAnnouncement,
} from './announcementState'

/**
 * The contract these tests pin down: dismissal and snooze are PER ANNOUNCEMENT
 * ID. A new announcement must always break through old state - that is the
 * difference between "the user closed announcement #4" and "the user closed
 * announcements".
 */

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
})

describe('shouldShowAnnouncement', () => {
  it('shows an announcement with no recorded state', () => {
    expect(shouldShowAnnouncement(1)).toBe(true)
  })

  it('never shows a dismissed announcement again', () => {
    dismissAnnouncement(1)
    expect(shouldShowAnnouncement(1)).toBe(false)
  })

  it('shows a NEW announcement even though an older one was dismissed', () => {
    dismissAnnouncement(1)
    expect(shouldShowAnnouncement(2)).toBe(true)
  })

  it('hides a snoozed announcement until the snooze lapses', () => {
    const now = new Date('2026-07-30T12:00:00Z')
    snoozeAnnouncement(1, 24, now)
    expect(shouldShowAnnouncement(1, new Date('2026-07-31T11:59:00Z'))).toBe(false)
    expect(shouldShowAnnouncement(1, new Date('2026-07-31T12:01:00Z'))).toBe(true)
  })

  it('shows a NEW announcement even while an older one is snoozed', () => {
    snoozeAnnouncement(1, 24)
    expect(shouldShowAnnouncement(2)).toBe(true)
  })

  it('does not re-show within the same session once marked shown', () => {
    markAnnouncementShown(3)
    expect(shouldShowAnnouncement(3)).toBe(false)
    // ...but a different id still gets through.
    expect(shouldShowAnnouncement(4)).toBe(true)
  })

  it('dismissing wins over the session mark being for another id', () => {
    markAnnouncementShown(3)
    dismissAnnouncement(4)
    expect(shouldShowAnnouncement(4)).toBe(false)
  })

  it('survives corrupted stored state by failing open', () => {
    localStorage.setItem('beehive_announcement_state_v1', '{not json')
    expect(shouldShowAnnouncement(1)).toBe(true)
    localStorage.setItem('beehive_announcement_state_v1', '"a string"')
    expect(shouldShowAnnouncement(1)).toBe(true)
  })

  it('treats an unparseable snooze timestamp as expired', () => {
    localStorage.setItem(
      'beehive_announcement_state_v1',
      JSON.stringify({ '1': { status: 'snoozed', until: 'garbage' } }),
    )
    expect(shouldShowAnnouncement(1)).toBe(true)
  })
})

describe('state transitions', () => {
  it('snooze then dismiss ends in dismissed', () => {
    snoozeAnnouncement(1, 24)
    dismissAnnouncement(1)
    expect(shouldShowAnnouncement(1, new Date(Date.now() + 48 * 3600_000))).toBe(false)
  })

  it('keeps state for multiple announcements independently', () => {
    dismissAnnouncement(1)
    snoozeAnnouncement(2, 24)
    expect(shouldShowAnnouncement(1)).toBe(false)
    expect(shouldShowAnnouncement(2)).toBe(false)
    expect(shouldShowAnnouncement(3)).toBe(true)
  })
})
