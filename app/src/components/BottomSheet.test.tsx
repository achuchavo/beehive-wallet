// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import BottomSheet from './BottomSheet'

/**
 * The sheet replaced an inline expander, so the things worth asserting are the
 * ones an expander did not have to get right: it escapes its DOM position, it
 * traps focus, it can refuse to be dismissed while a broadcast is in flight, and
 * it restores the page when it goes.
 */

let root: Root | null = null
let host: HTMLDivElement | null = null

function open(props: Partial<React.ComponentProps<typeof BottomSheet>> = {}) {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  const onClose = props.onClose ?? vi.fn()
  act(() => {
    root!.render(
      <BottomSheet title="Delegate" onClose={onClose} {...props}>
        <input aria-label="amount" />
        <button>Sign</button>
      </BottomSheet>,
    )
  })
  return { onClose: onClose as ReturnType<typeof vi.fn> }
}

const sheet = () => document.querySelector('[role="dialog"]') as HTMLElement | null

afterEach(() => {
  act(() => root?.unmount())
  host?.remove()
  root = null
  host = null
  document.body.style.overflow = ''
})

describe('BottomSheet', () => {
  it('renders into document.body, not where it was declared', () => {
    open()
    expect(sheet()).not.toBeNull()
    // Escaping the subtree is what stops a sheet declared inside a <label>
    // being reopened by that label's click forwarding.
    expect(host!.contains(sheet())).toBe(false)
    expect(document.body.contains(sheet())).toBe(true)
  })

  it('is a modal dialog named by its title', () => {
    open()
    expect(sheet()!.getAttribute('aria-modal')).toBe('true')
    expect(sheet()!.getAttribute('aria-label')).toBe('Delegate')
  })

  it('anchors to the bottom and takes about half the screen', () => {
    open()
    const backdrop = sheet()!.parentElement!
    // items-end is the anchoring: the panel sits on the bottom edge.
    expect(backdrop.className).toContain('items-end')
    // The clamped half-viewport height comes from the [data-sheet] rule in
    // index.css, asserted via the hook rather than a computed value - jsdom does
    // not implement min()/max(), so a style assertion here would test the CSS
    // parser rather than the component.
    expect(sheet()!.hasAttribute('data-sheet')).toBe(true)
    // Rounded only at the TOP: the bottom edge is flush with the screen.
    expect(sheet()!.className).toContain('rounded-t-2xl')
    // Content scrolls inside a fixed-height sheet rather than the sheet growing
    // and pushing its own submit button off-screen.
    expect(sheet()!.querySelector('.overflow-y-auto')).not.toBeNull()
  })

  it('carries the rise animation hook', () => {
    open()
    expect(sheet()!.hasAttribute('data-sheet')).toBe(true)
  })

  it('locks background scroll while open and restores it on close', () => {
    open()
    expect(document.body.style.overflow).toBe('hidden')
    act(() => root!.unmount())
    root = null
    expect(document.body.style.overflow).toBe('')
  })

  it('closes on Escape and on the backdrop', () => {
    const { onClose } = open()
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(onClose).toHaveBeenCalledTimes(1)

    act(() => sheet()!.parentElement!.click())
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('a click inside does NOT close it', () => {
    const { onClose } = open()
    act(() => sheet()!.querySelector('input')!.click())
    expect(onClose).not.toHaveBeenCalled()
  })

  it('when not dismissible, Escape and the backdrop are inert and the X is disabled', () => {
    const { onClose } = open({ dismissible: false })
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    act(() => sheet()!.parentElement!.click())
    // An in-flight broadcast must not be offered an exit that does nothing.
    expect(onClose).not.toHaveBeenCalled()
    const close = sheet()!.querySelector('button[aria-label="Close"]') as HTMLButtonElement
    expect(close.disabled).toBe(true)
  })

  it('moves focus into the sheet, past the close button', () => {
    open()
    // The header precedes the body, so the first focusable is always the X -
    // focusing it would mean every open starts on "dismiss".
    expect(document.activeElement).not.toBe(
      sheet()!.querySelector('button[aria-label="Close"]'),
    )
    expect(sheet()!.contains(document.activeElement)).toBe(true)
  })

  it('honours an explicit initialFocus', () => {
    const ref = { current: null as HTMLInputElement | null }
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    act(() => {
      root!.render(
        <BottomSheet title="Delegate" onClose={() => {}} initialFocus={ref}>
          <button>first</button>
          <input aria-label="amount" ref={ref} />
        </BottomSheet>,
      )
    })
    expect(document.activeElement).toBe(ref.current)
  })

  it('traps Tab inside the sheet', () => {
    open()
    const focusables = [...sheet()!.querySelectorAll<HTMLElement>('button,input')]
    const last = focusables[focusables.length - 1]
    last.focus()
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }))
    })
    // Wrapped to the first rather than escaping to the page behind.
    expect(document.activeElement).toBe(focusables[0])
  })
})
