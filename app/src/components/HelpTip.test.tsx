// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import HelpTip from './HelpTip'
import { I18nProvider } from '../i18n/I18nContext'

/**
 * The "?" opens on HOVER. These tests exist because that is only half the
 * requirement: a phone has no hover state, and a keyboard user has no pointer,
 * so tap and focus have to reach the same content or the explanation is simply
 * unavailable to them. Each of those paths is asserted separately.
 */

let root: Root | null = null
let host: HTMLDivElement | null = null

function render(text = 'the explanation') {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => {
    root!.render(
      <I18nProvider>
        <HelpTip text={text} />
      </I18nProvider>,
    )
  })
  const button = host.querySelector('button')!
  const wrap = button.parentElement!
  return { button, wrap }
}

const panel = () => host!.querySelector('[role="note"]')

/**
 * React does not listen for `pointerenter`/`pointerleave` directly - it
 * synthesises them from the bubbling `pointerover`/`pointerout` pair at the root
 * container. Dispatching the enter/leave events themselves reaches nothing, so
 * these helpers send what React is actually subscribed to.
 *
 * relatedTarget is the element the pointer came from or went to; React uses it
 * to decide whether the boundary was really crossed.
 */
function hoverIn(el: Element) {
  act(() => {
    el.dispatchEvent(
      new MouseEvent('pointerover', { bubbles: true, relatedTarget: document.body }),
    )
  })
}

function hoverOut(el: Element) {
  act(() => {
    el.dispatchEvent(
      new MouseEvent('pointerout', { bubbles: true, relatedTarget: document.body }),
    )
  })
}

/** pointerleave schedules a 120ms close; wait past it. */
async function settle(ms = 250) {
  await act(async () => {
    await new Promise((r) => setTimeout(r, ms))
  })
}

afterEach(() => {
  act(() => root?.unmount())
  host?.remove()
  root = null
  host = null
})

describe('HelpTip', () => {
  it('is closed until something asks for it', () => {
    render()
    expect(panel()).toBeNull()
  })

  it('opens on hover and closes when the pointer leaves', async () => {
    const { wrap } = render()

    hoverIn(wrap)
    expect(panel()).not.toBeNull()
    expect(panel()!.textContent).toBe('the explanation')

    hoverOut(wrap)
    await settle()
    expect(panel()).toBeNull()
  })

  it('opens on keyboard focus - a keyboard user has no pointer to hover with', async () => {
    const { button } = render()

    // focusin/focusout bubble; React's onFocus/onBlur are built on those.
    act(() => button.dispatchEvent(new FocusEvent('focusin', { bubbles: true })))
    expect(panel()).not.toBeNull()

    act(() => button.dispatchEvent(new FocusEvent('focusout', { bubbles: true })))
    await settle()
    expect(panel()).toBeNull()
  })

  it('opens on tap - there is no hover on a phone', () => {
    const { button } = render()
    act(() => button.click())
    expect(panel()).not.toBeNull()
  })

  it('a click PINS it, so it survives the pointer leaving', async () => {
    const { button, wrap } = render()

    hoverIn(wrap)
    act(() => button.click()) // pin

    hoverOut(wrap)
    await settle()
    // Still open: an explanation you are reading must not vanish because the
    // pointer moved a few pixels.
    expect(panel()).not.toBeNull()
  })

  it('survives a real TAP, where pointerleave fires BEFORE click', async () => {
    // The touch sequence is pointerover -> pointerout -> click: the leave arms
    // the 120ms close timer, and the click then pins. The stale timer used to
    // close the tip right after the tap opened it - the "shows the hint and
    // disappears immediately" bug.
    const { button, wrap } = render()

    hoverIn(wrap)
    hoverOut(wrap)
    act(() => button.click())
    expect(panel()).not.toBeNull()

    await settle()
    expect(panel()).not.toBeNull()
  })

  it('a second click releases the pin', async () => {
    const { button } = render()
    act(() => button.click())
    expect(panel()).not.toBeNull()
    act(() => button.click())
    expect(panel()).toBeNull()
  })

  it('Escape closes a pinned tip', async () => {
    const { button } = render()
    act(() => button.click())
    expect(panel()).not.toBeNull()

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(panel()).toBeNull()
  })

  it('clicking away closes a pinned tip', async () => {
    const { button } = render()
    act(() => button.click())
    expect(panel()).not.toBeNull()

    act(() => {
      document.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }))
    })
    expect(panel()).toBeNull()
  })

  it('wires aria only while open, so nothing points at a missing element', () => {
    const { button, wrap } = render()
    expect(button.getAttribute('aria-expanded')).toBe('false')
    expect(button.getAttribute('aria-controls')).toBeNull()
    expect(button.getAttribute('aria-describedby')).toBeNull()

    hoverIn(wrap)
    expect(button.getAttribute('aria-expanded')).toBe('true')
    // The button is NAMED "Help" and DESCRIBED by the popover - so assistive
    // tech announces "Help, button" then reads the text, rather than reading a
    // whole sentence as the button's name.
    expect(button.getAttribute('aria-describedby')).toBe(panel()!.id)
    expect(button.getAttribute('aria-controls')).toBe(panel()!.id)
  })
})
