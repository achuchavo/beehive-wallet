import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { HelpCircle } from 'lucide-react'
import { useT } from '../i18n/I18nContext'

/**
 * A "?" that reveals a short explanation.
 *
 * OPENS ON HOVER. It also opens on tap and on keyboard focus, because those are
 * the only ways the same content can be reached without a mouse - a phone has
 * no hover state at all, so hover-only would mean every tip on the site is
 * invisible to a phone user.
 *
 * Clicking PINS it open. Hover alone closes as soon as the pointer leaves, which
 * is right for a glance but wrong for a paragraph about how a fee is charged -
 * pinning lets the text be read, and selected, at leisure.
 *
 * The close is delayed a little so that moving the pointer from the "?" onto the
 * popover does not dismiss it in the gap between the two elements.
 */
export default function HelpTip({
  text,
  align = 'center',
  className = '',
}: {
  text: string
  /**
   * Which edge the popover is pinned to. 'center' is right for a tip in the
   * middle of a line; 'start'/'end' stop it being clipped by the viewport when
   * the tip sits at the beginning or end of a row.
   */
  align?: 'center' | 'start' | 'end'
  className?: string
}) {
  const { t } = useT()
  const [open, setOpen] = useState(false)
  // Pinned by a click/tap: stays until dismissed rather than following the
  // pointer. Mirrored in a ref because the close timer's callback would
  // otherwise read the pinned value from when it was SCHEDULED - on a touch
  // tap, pointerleave fires before click, so a timer armed by that leave used
  // to close the tip ~120ms after the tap had pinned it open.
  const [pinned, setPinned] = useState(false)
  const pinnedRef = useRef(false)
  const panelId = useId()
  const wrapRef = useRef<HTMLSpanElement>(null)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  function setPinnedBoth(v: boolean) {
    pinnedRef.current = v
    setPinned(v)
  }

  function cancelClose() {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current)
      closeTimer.current = null
    }
  }

  function show() {
    cancelClose()
    setOpen(true)
  }

  function scheduleClose() {
    if (pinnedRef.current) return
    cancelClose()
    closeTimer.current = setTimeout(() => {
      // Re-checked at fire time, not capture time - see pinnedRef above.
      if (!pinnedRef.current) setOpen(false)
    }, 120)
  }

  // A timer that outlives the component would call setState on an unmounted one.
  useEffect(() => cancelClose, [])

  // Escape, and clicking away, both close a PINNED tip. Bound only while open,
  // so a page full of tips adds no listeners until one is actually used.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        setPinnedBoth(false)
        setOpen(false)
      }
    }
    const onPointer = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) {
        setPinnedBoth(false)
        setOpen(false)
      }
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onPointer)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onPointer)
    }
  }, [open])

  // Viewport clamping. The align prop is only the STARTING position; a tip can
  // still be rendered near an edge (a picker at the end of a row, a label on a
  // narrow phone), and a fixed 15rem panel then runs off screen. Measured once
  // per open: shifted horizontally back inside the viewport, and flipped below
  // the "?" when there is no room above it.
  const panelRef = useRef<HTMLSpanElement>(null)
  const [shift, setShift] = useState(0)
  const [below, setBelow] = useState(false)

  useLayoutEffect(() => {
    if (!open) {
      setShift(0)
      setBelow(false)
      return
    }
    const rect = panelRef.current?.getBoundingClientRect()
    if (!rect || rect.width === 0) return // jsdom / not laid out yet
    const margin = 8
    let dx = 0
    if (rect.left < margin) dx = margin - rect.left
    else if (rect.right > window.innerWidth - margin) dx = window.innerWidth - margin - rect.right
    if (dx !== 0) setShift(dx)
    if (rect.top < margin) setBelow(true)
  }, [open])

  const pin = align === 'start' ? 'left-0' : align === 'end' ? 'right-0' : 'left-1/2'
  const baseX = align === 'center' ? `calc(-50% + ${shift}px)` : `${shift}px`

  return (
    <span
      ref={wrapRef}
      // On the wrapper, not the button, so the popover counts as "inside" and
      // moving onto it keeps the tip open.
      onPointerEnter={show}
      onPointerLeave={scheduleClose}
      className={`relative inline-flex align-middle ${className}`}
    >
      <button
        type="button"
        onClick={(e) => {
          // Most tips sit inside a <label>, and a click anywhere in a label is
          // forwarded to the labelled control - so opening a tip would also
          // focus (or worse, toggle) the field beside it. preventDefault stops
          // that forwarding for every call site at once; stopPropagation keeps
          // the click out of any clickable row this tip is nested in.
          e.preventDefault()
          e.stopPropagation()
          // Tap on touch (where there is no hover) opens; click on a desktop
          // pins what hover already opened, and a second click releases it.
          if (pinned) {
            setPinnedBoth(false)
            setOpen(false)
          } else {
            // A tap's pointerleave has already armed the close timer by the
            // time click fires - pinning must disarm it or the tip vanishes.
            cancelClose()
            setPinnedBoth(true)
            setOpen(true)
          }
        }}
        // Keyboard users get the same content: focus opens, blur closes.
        onFocus={show}
        onBlur={scheduleClose}
        aria-expanded={open}
        // Both only while open: the panel does not exist when closed, and an
        // aria-controls/aria-describedby pointing at a missing id is a dangling
        // reference that some screen readers report as an error.
        aria-controls={open ? panelId : undefined}
        // Described by the popover, named "Help" - so assistive tech announces
        // "Help, button" and then reads the explanation, rather than announcing
        // an entire sentence as the button's own name.
        aria-describedby={open ? panelId : undefined}
        aria-label={t('help.label')}
        // Inherits the colour of whatever label it sits beside (slate on a
        // white card, amber inside the hero) and is dimmed until wanted, so one
        // component suits every surface without a palette prop.
        className="inline-flex text-current opacity-50 transition-opacity hover:opacity-100"
      >
        <HelpCircle className="h-3.5 w-3.5" strokeWidth={2} />
      </button>
      {/* Rendered only when open: an always-present hidden panel would be read
          by aria-describedby even while invisible. */}
      {open && (
        <span
          ref={panelRef}
          id={panelId}
          role="note"
          style={{ transform: `translateX(${baseX})` }}
          className={`absolute z-30 w-60 rounded-xl bg-slate-800 px-3 py-2 text-left text-xs font-normal leading-relaxed text-white shadow-lg ${pin} ${
            below ? 'top-full mt-1.5' : 'bottom-full mb-1.5'
          }`}
        >
          {text}
        </span>
      )}
    </span>
  )
}
