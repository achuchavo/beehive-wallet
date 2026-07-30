import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'

/**
 * A panel that rises from the bottom of the screen and stays anchored there.
 *
 * Used where the alternative was an inline expander that pushed the rest of the
 * page around: in a list of two hundred validators, opening a form under one row
 * moves every row below it, and on a phone the form can open below the fold so
 * nothing appears to happen at all. A sheet anchored to the bottom edge is
 * always where the thumb already is, and never moves the thing you tapped.
 *
 * Sized to about half the viewport and capped, so the list behind stays visible
 * for context - this is a form about one row, not a new page. Content scrolls
 * inside the sheet rather than the sheet growing.
 *
 * Shares Modal's semantics: role="dialog", aria-modal, focus moved in on open,
 * Tab trapped, focus restored on close, background scroll locked. Escape and the
 * backdrop close it unless `dismissible` is false, which is how an in-flight
 * broadcast avoids offering an exit that silently does nothing.
 */
export default function BottomSheet({
  title,
  subtitle,
  onClose,
  children,
  dismissible = true,
  initialFocus,
}: {
  title: string
  subtitle?: string
  onClose: () => void
  children: React.ReactNode
  dismissible?: boolean
  initialFocus?: React.RefObject<HTMLElement | null>
}) {
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null
    const panel = panelRef.current
    const focusables = () =>
      panel ? Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)) : []

    // Focus the field the sheet exists for, not the close button - the header
    // precedes the body, so the first focusable is always the X otherwise.
    ;(initialFocus?.current ?? focusables()[1] ?? focusables()[0] ?? panel)?.focus()

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (dismissible) onClose()
        return
      }
      if (e.key === 'Tab') {
        const items = focusables()
        if (items.length === 0) {
          e.preventDefault()
          return
        }
        const first = items[0]
        const last = items[items.length - 1]
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault()
          last.focus()
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault()
          first.focus()
        }
      }
    }

    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
      previouslyFocused?.focus?.()
    }
  }, [onClose, dismissible, initialFocus])

  // Portalled to body, like Modal: a sheet nested inside a <label> would receive
  // that label's click forwarding, which re-dispatches to the control that
  // opened it and reopens the sheet that just closed.
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40"
      onClick={dismissible ? onClose : undefined}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        // data-sheet carries BOTH the rise animation and the clamped
        // half-viewport height, in index.css. Kept out of an inline style so the
        // sizing rule sits next to the animation it belongs with - and because
        // min()/max() in an inline style is silently dropped by some CSS
        // parsers, which made the height untestable.
        data-sheet
        className="flex w-full max-w-lg flex-col rounded-t-2xl bg-white shadow-2xl focus:outline-none sm:rounded-t-3xl"
      >
        {/* Grab handle: the affordance that says "this came from the bottom and
            can go back". Decorative, so hidden from assistive tech. */}
        <div className="flex justify-center pt-2.5" aria-hidden="true">
          <div className="h-1 w-9 rounded-full bg-slate-300" />
        </div>

        <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-5 pb-3 pt-2">
          <div className="min-w-0">
            <h2 className="truncate font-medium">{title}</h2>
            {subtitle && <p className="truncate text-xs text-slate-500">{subtitle}</p>}
          </div>
          <button
            onClick={onClose}
            disabled={!dismissible}
            aria-label="Close"
            className="-mr-1 shrink-0 rounded p-1 text-slate-500 hover:text-slate-700 focus:outline-none focus:ring-2 focus:ring-amber-500 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* The sheet is a fixed height, so the CONTENT scrolls. Growing the
            sheet instead would let a long form push its own submit button off
            the screen. */}
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
      </div>
    </div>,
    document.body,
  )
}
