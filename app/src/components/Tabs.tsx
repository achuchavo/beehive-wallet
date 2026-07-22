import { useRef } from 'react'

export interface TabItem {
  id: string
  label: string
}

/**
 * WAI-ARIA tabs pattern: a `tablist` of `tab`s with roving tabindex, arrow /
 * Home / End keyboard navigation and aria-selected + aria-controls wiring.
 *
 * Active state is signalled by more than colour (weight + underline + the
 * aria-selected state itself), so it survives greyscale and forced-colors.
 *
 * Render the matching panel with <TabPanel id=... activeId=...>.
 */
export default function Tabs({
  items,
  activeId,
  onChange,
  idPrefix,
  className = '',
  label,
}: {
  items: TabItem[]
  activeId: string
  onChange: (id: string) => void
  /** Namespace for the generated tab/panel element ids. */
  idPrefix: string
  className?: string
  /** Accessible name for the tablist. */
  label: string
}) {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({})

  function onKeyDown(e: React.KeyboardEvent) {
    const i = items.findIndex((it) => it.id === activeId)
    if (i < 0) return
    let next = -1
    if (e.key === 'ArrowRight') next = (i + 1) % items.length
    else if (e.key === 'ArrowLeft') next = (i - 1 + items.length) % items.length
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = items.length - 1
    else return
    e.preventDefault()
    const id = items[next].id
    onChange(id)
    refs.current[id]?.focus()
  }

  return (
    <div
      role="tablist"
      aria-label={label}
      onKeyDown={onKeyDown}
      className={`flex flex-wrap gap-1 border-b border-slate-200 ${className}`}
    >
      {items.map((it) => {
        const selected = it.id === activeId
        return (
          <button
            key={it.id}
            ref={(el) => {
              refs.current[it.id] = el
            }}
            role="tab"
            id={`${idPrefix}-tab-${it.id}`}
            aria-selected={selected}
            aria-controls={`${idPrefix}-panel-${it.id}`}
            // Roving tabindex: only the active tab is in the tab order.
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(it.id)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 ${
              selected
                ? 'border-amber-500 font-semibold text-amber-700'
                : 'border-transparent text-slate-600 hover:text-slate-900'
            }`}
          >
            {it.label}
          </button>
        )
      })}
    </div>
  )
}

export function TabPanel({
  id,
  activeId,
  idPrefix,
  children,
}: {
  id: string
  activeId: string
  idPrefix: string
  children: React.ReactNode
}) {
  if (id !== activeId) return null
  return (
    <div
      role="tabpanel"
      id={`${idPrefix}-panel-${id}`}
      aria-labelledby={`${idPrefix}-tab-${id}`}
      tabIndex={0}
      className="focus:outline-none"
    >
      {children}
    </div>
  )
}
