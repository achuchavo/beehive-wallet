import { useEffect, useId, useRef, useState } from 'react'
import { HelpCircle } from 'lucide-react'
import { useT } from '../i18n/I18nContext'

/**
 * A "?" button that opens a small explanation popover.
 *
 * Deliberately NOT hover-only. Hover excludes touch (there is no hover on a
 * phone) and keyboard users, and a tooltip that disappears the moment the
 * pointer moves cannot be read at leisure - which is the whole point of an
 * explanation. So: click or Enter/Space opens it, Escape / clicking away / a
 * second click closes it.
 *
 * The help text is the popover's content and is linked to the button with
 * aria-describedby, so assistive tech announces "Help, button" and then reads
 * the explanation - rather than announcing an entire sentence as the button's
 * own name, which is what an aria-label holding the text would do.
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
  const panelId = useId()
  const wrapRef = useRef<HTMLSpanElement>(null)

  // Dismiss on Escape or on a click outside. Both are bound only while open, so
  // a page full of tips adds no listeners until one is actually used.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        setOpen(false)
      }
    }
    const onPointer = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onPointer)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onPointer)
    }
  }, [open])

  const pin =
    align === 'start' ? 'left-0' : align === 'end' ? 'right-0' : 'left-1/2 -translate-x-1/2'

  return (
    <span ref={wrapRef} className={`relative inline-flex align-middle ${className}`}>
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
          setOpen((o) => !o)
        }}
        aria-expanded={open}
        // Both only while open: the panel does not exist when closed, and an
        // aria-controls/aria-describedby pointing at a missing id is a dangling
        // reference that some screen readers report as an error.
        aria-controls={open ? panelId : undefined}
        // Described by the popover, named "Help" - see the note above.
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
          id={panelId}
          role="note"
          className={`absolute bottom-full z-30 mb-1.5 w-60 rounded-xl bg-slate-800 px-3 py-2 text-left text-xs font-normal leading-relaxed text-white shadow-lg ${pin}`}
        >
          {text}
        </span>
      )}
    </span>
  )
}
