import HelpTip from './HelpTip'

/**
 * The one page-title idiom. A single quiet heading, an optional muted line
 * under it, and an optional slot for controls on the right.
 *
 * Every page used to hand-roll this, and most then repeated the same words in a
 * section <h2> a few rows down. One component makes the hierarchy consistent
 * and gives the duplicates somewhere to go.
 */
export default function PageHeader({
  title,
  subtitle,
  help,
  children,
}: {
  title: string
  subtitle?: string
  /** Help text for the page's subject, shown as a "?" beside the title. */
  help?: string
  /** Controls aligned to the right of the title - filters, toggles. */
  children?: React.ReactNode
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="flex items-center gap-1.5 text-2xl font-semibold tracking-tight text-slate-900">
          {title}
          {help && <HelpTip text={help} align="start" />}
        </h1>
        {subtitle && <p className="mt-0.5 text-sm text-slate-500">{subtitle}</p>}
      </div>
      {children && <div className="flex shrink-0 items-center gap-2">{children}</div>}
    </div>
  )
}
