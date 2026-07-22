import { Link } from 'react-router-dom'
import type { LucideIcon } from 'lucide-react'

export interface EmptyAction {
  label: string
  to: string
  icon?: LucideIcon
  variant?: 'primary' | 'secondary'
}

// Friendly, centered empty/onboarding state with styled action buttons.
export default function EmptyState({
  icon: Icon,
  title,
  description,
  actions,
}: {
  icon: LucideIcon
  title: string
  description: string
  actions: EmptyAction[]
}) {
  return (
    <div className="mx-auto mt-6 max-w-md rounded-2xl border border-slate-200 bg-white px-6 py-10 text-center shadow-sm">
      <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-amber-100 text-amber-700">
        <Icon className="h-7 w-7" strokeWidth={1.8} />
      </div>
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="mx-auto mt-2 max-w-sm text-sm text-slate-500">{description}</p>
      <div className="mt-6 flex flex-wrap justify-center gap-2">
        {actions.map((a) => {
          const AIcon = a.icon
          const primary = a.variant !== 'secondary'
          return (
            <Link
              key={a.to + a.label}
              to={a.to}
              className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium ${
                primary
                  ? 'bg-amber-500 text-slate-900 hover:bg-amber-600'
                  : 'border border-slate-300 bg-white text-slate-700 hover:border-amber-500'
              }`}
            >
              {AIcon && <AIcon className="h-4 w-4" />}
              {a.label}
            </Link>
          )
        })}
      </div>
    </div>
  )
}
