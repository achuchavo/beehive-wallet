import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'

export default function Modal({
  title,
  onClose,
  children,
  wide = false,
  dismissible = true,
  initialFocus,
}: {
  title: string
  onClose: () => void
  children: React.ReactNode
  wide?: boolean
  /**
   * When false the dialog cannot be dismissed at all - Escape, the backdrop and
   * the X are inert AND the X is visibly disabled. Used while an irreversible
   * action (a broadcast) is in flight, so the UI never offers an exit that
   * silently does nothing.
   */
  dismissible?: boolean
  /**
   * Where to put focus on open. Without this the first focusable wins, and
   * since the header precedes the body that is always the Close button - fine
   * for a confirmation, wrong for a dialog whose whole purpose is a list the
   * user came to operate.
   */
  initialFocus?: React.RefObject<HTMLElement | null>
}) {
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null
    const panel = panelRef.current
    const focusables = () =>
      panel ? Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)) : []

    // Move focus into the dialog on open.
    ;(initialFocus?.current ?? focusables()[0] ?? panel)?.focus()

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // Escape must not abandon an in-flight irreversible action.
        if (dismissible) onClose()
        return
      }
      if (e.key === 'Tab') {
        // Trap Tab focus inside the dialog.
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
      // Restore focus to whatever opened the dialog.
      previouslyFocused?.focus?.()
    }
  }, [onClose, dismissible, initialFocus])

  // Rendered into document.body, not where it was declared.
  //
  // A dialog nested inside a <label> (several pickers are) receives the label's
  // click forwarding: clicking an option bubbles to the label, which
  // re-dispatches to its control - the trigger button - reopening the dialog
  // that just closed. The visible symptom was "it selects but never closes".
  // Escaping the DOM subtree fixes it for every caller at once, and is correct
  // regardless: a full-screen overlay does not belong inside a form control.
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 py-10"
      onClick={dismissible ? onClose : undefined}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={`w-full ${wide ? 'max-w-2xl' : 'max-w-lg'} rounded-xl bg-white shadow-xl focus:outline-none`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
          <h2 className="font-medium">{title}</h2>
          <button
            onClick={onClose}
            disabled={!dismissible}
            aria-label="Close"
            className="rounded text-slate-500 hover:text-slate-700 focus:outline-none focus:ring-2 focus:ring-amber-500 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:text-slate-500"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="px-5 py-4">{children}</div>
      </div>
    </div>,
    document.body,
  )
}
