import { useId, useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'

// A titled section that folds open/closed. Collapsed by default.
export default function Collapsible({
  title,
  subtitle,
  defaultOpen = false,
  children,
}: {
  title: string
  subtitle?: string
  defaultOpen?: boolean
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  // A disclosure without aria-expanded/aria-controls announces as a plain
  // button: nothing tells a screen-reader user that it reveals a region, or
  // whether that region is currently open.
  const panelId = useId()
  return (
    <section>
      <button
        // Explicit type: inside a <form> a bare <button> is a submit button,
        // and folding a section open must never submit the form around it.
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls={panelId}
        className="flex w-full items-center justify-between rounded-lg py-1 text-left hover:text-amber-700"
      >
        <span className="flex items-baseline gap-2">
          <span className="font-medium">{title}</span>
          {subtitle && <span className="text-xs text-slate-500">{subtitle}</span>}
        </span>
        {open ? (
          <ChevronDown className="h-4 w-4 shrink-0 text-slate-500" />
        ) : (
          <ChevronRight className="h-4 w-4 shrink-0 text-slate-500" />
        )}
      </button>
      <div id={panelId} hidden={!open} className="mt-2">
        {children}
      </div>
    </section>
  )
}
