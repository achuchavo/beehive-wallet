/**
 * The standard surface: a soft card.
 *
 * A ring rather than a border, and a wider radius, so a page of stacked cards
 * reads as a few calm panels instead of a grid of boxed-in rectangles. Borders
 * are reserved for things that genuinely need an edge.
 */
export default function Card({
  children,
  className = '',
  padded = true,
}: {
  children: React.ReactNode
  className?: string
  /** Off for cards that own their own padding, e.g. a divided list. */
  padded?: boolean
}) {
  return (
    <div
      className={`rounded-2xl bg-white ring-1 ring-slate-200/70 ${padded ? 'p-4' : ''} ${className}`}
    >
      {children}
    </div>
  )
}
