import { useState } from 'react'
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
  return (
    <section>
      <button
        onClick={() => setOpen((o) => !o)}
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
      {open && <div className="mt-2">{children}</div>}
    </section>
  )
}
