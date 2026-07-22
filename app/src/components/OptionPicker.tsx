import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronDown, Search } from 'lucide-react'
import Modal from './Modal'
import { useT } from '../i18n/I18nContext'

export interface PickerOption {
  value: string
  label: string
  /** Secondary line - address tail, commission, voting power. */
  hint?: string
  disabled?: boolean
}

/**
 * Replacement for a native <select>: a branded trigger that opens a modal grid
 * of options, with a search field once the list gets long.
 *
 * Why not a native select: on iOS it renders as an OS wheel picker that cannot
 * be styled at all, and with 250+ validators it is close to unusable.
 *
 * A native select gives keyboard support and screen-reader semantics for free,
 * so all of that is reimplemented here rather than dropped - the listbox
 * follows the WAI-ARIA pattern (roving tabindex, aria-selected, typed search)
 * and the surrounding Modal already handles focus trapping, Escape, scroll lock
 * and focus restore.
 */
export default function OptionPicker({
  value,
  onChange,
  options,
  label,
  placeholder,
  full = false,
  disabled = false,
  className = '',
  id,
  layout = 'grid',
  searchThreshold = 8,
  describedBy,
}: {
  value: string
  onChange: (value: string) => void
  options: PickerOption[]
  /** Accessible name for the trigger, and the dialog's title. */
  label: string
  /** Trigger text when nothing is selected. Defaults to the label. */
  placeholder?: string
  full?: boolean
  disabled?: boolean
  className?: string
  id?: string
  /**
   * 'grid' packs short labels into columns; 'list' forces one per row, which is
   * what long labels (wallet names, validator monikers) actually need.
   */
  layout?: 'grid' | 'list'
  /** Show the search field once the list reaches this many options. */
  searchThreshold?: number
  describedBy?: string
}) {
  const { t } = useT()
  const [open, setOpen] = useState(false)

  const selected = options.find((o) => o.value === value)
  const triggerText = selected?.label ?? placeholder ?? label
  // Handed to Modal so opening lands on the search box (or the current
  // selection) instead of the Close button, which is what the first-focusable
  // default would pick since the dialog header precedes its body.
  const initialFocus = useRef<HTMLElement | null>(null)

  return (
    <>
      <button
        type="button"
        id={id}
        disabled={disabled}
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={selected ? `${label}: ${selected.label}` : label}
        aria-describedby={describedBy}
        className={`relative flex items-center justify-between gap-2 rounded-lg border border-slate-300 bg-white py-1.5 pl-3 pr-2 text-left text-sm text-slate-700 shadow-sm transition-colors hover:border-slate-400 disabled:cursor-default disabled:opacity-60 ${
          full ? 'w-full' : 'inline-flex'
        } ${className}`}
      >
        <span className={`truncate ${selected ? '' : 'text-slate-500'}`}>{triggerText}</span>
        <ChevronDown className="h-4 w-4 shrink-0 text-slate-500" />
      </button>

      {open && (
        <Modal title={label} onClose={() => setOpen(false)} initialFocus={initialFocus}>
          <PickerBody
            options={options}
            value={value}
            layout={layout}
            showSearch={options.length >= searchThreshold}
            label={label}
            t={t}
            focusRef={initialFocus}
            onPick={(v) => {
              // Only an explicit choice changes the value. Filtering, arrowing
              // and dismissing all leave the current selection untouched -
              // this control also picks the network for a transaction.
              onChange(v)
              setOpen(false)
            }}
          />
        </Modal>
      )}
    </>
  )
}

function PickerBody({
  options,
  value,
  layout,
  showSearch,
  label,
  onPick,
  t,
  focusRef,
}: {
  options: PickerOption[]
  value: string
  layout: 'grid' | 'list'
  showSearch: boolean
  label: string
  onPick: (value: string) => void
  t: (key: string, vars?: Record<string, string | number>) => string
  focusRef: React.RefObject<HTMLElement | null>
}) {
  const [query, setQuery] = useState('')
  const listRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return options
    return options.filter(
      (o) => o.label.toLowerCase().includes(q) || (o.hint ?? '').toLowerCase().includes(q),
    )
  }, [options, query])

  // Which option owns the tabstop. Starts on the current selection so keyboard
  // users land where they already are rather than at the top of the list.
  const selectedIndex = filtered.findIndex((o) => o.value === value)
  const [activeIndex, setActiveIndex] = useState(selectedIndex >= 0 ? selectedIndex : 0)

  // Filtering can shrink the list out from under the cursor.
  useEffect(() => {
    setActiveIndex((i) => (i >= filtered.length ? Math.max(0, filtered.length - 1) : i))
  }, [filtered.length])

  // Publish the element Modal should focus on open: the search box when there
  // is one, otherwise the option that is currently selected.
  useEffect(() => {
    focusRef.current =
      searchRef.current ??
      listRef.current?.querySelectorAll<HTMLElement>('[role="option"]')[activeIndex] ??
      null
    // Only on mount - after that the user owns focus.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function focusOption(index: number) {
    const el = listRef.current?.querySelectorAll<HTMLElement>('[role="option"]')[index]
    el?.focus()
  }

  function move(delta: number) {
    if (filtered.length === 0) return
    const next = Math.min(filtered.length - 1, Math.max(0, activeIndex + delta))
    setActiveIndex(next)
    focusOption(next)
  }

  function onListKeyDown(e: React.KeyboardEvent) {
    // Arrow keys move linearly in both axes rather than by grid row. Column
    // count depends on the responsive breakpoint, so row-wise movement would
    // have to measure layout and would change under the user on resize;
    // prev/next is predictable and never strands the cursor.
    switch (e.key) {
      case 'ArrowDown':
      case 'ArrowRight':
        e.preventDefault()
        move(1)
        break
      case 'ArrowUp':
      case 'ArrowLeft':
        e.preventDefault()
        move(-1)
        break
      case 'Home':
        e.preventDefault()
        setActiveIndex(0)
        focusOption(0)
        break
      case 'End':
        e.preventDefault()
        setActiveIndex(filtered.length - 1)
        focusOption(filtered.length - 1)
        break
    }
  }

  return (
    <div>
      {showSearch && (
        <div className="relative mb-3">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            ref={searchRef}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            // Down-arrow out of the field and into the list, so search and
            // keyboard selection are one continuous motion.
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                focusOption(activeIndex)
              }
            }}
            placeholder={t('picker.search')}
            aria-label={t('picker.searchIn', { label })}
            className="w-full rounded-lg border border-slate-300 py-2 pl-9 pr-3 text-sm focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-500/30"
          />
        </div>
      )}

      {filtered.length === 0 ? (
        <p className="py-6 text-center text-sm text-slate-500">{t('picker.noMatches')}</p>
      ) : (
        <div
          ref={listRef}
          role="listbox"
          aria-label={label}
          onKeyDown={onListKeyDown}
          className={`max-h-[55vh] overflow-y-auto ${
            layout === 'grid' ? 'grid grid-cols-2 gap-2 sm:grid-cols-3' : 'flex flex-col gap-1.5'
          }`}
        >
          {filtered.map((o, i) => {
            const isSelected = o.value === value
            return (
              <div
                key={o.value}
                role="option"
                aria-selected={isSelected}
                aria-disabled={o.disabled || undefined}
                // Roving tabindex: exactly one option is tabbable, so Tab moves
                // past the list instead of through every one of 250 entries.
                tabIndex={i === activeIndex ? 0 : -1}
                onClick={() => !o.disabled && onPick(o.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    if (!o.disabled) onPick(o.value)
                  }
                }}
                onFocus={() => setActiveIndex(i)}
                className={`flex cursor-pointer items-center justify-between gap-2 rounded-lg border px-3 py-2.5 text-sm transition-colors ${
                  isSelected
                    ? 'border-amber-500 bg-amber-50 font-medium text-amber-900'
                    : 'border-slate-200 bg-white text-slate-700 hover:border-amber-300 hover:bg-amber-50/50'
                } ${o.disabled ? 'cursor-not-allowed opacity-50' : ''}`}
              >
                <span className="min-w-0">
                  <span className="block truncate">{o.label}</span>
                  {o.hint && (
                    <span
                      className={`block truncate text-xs ${
                        isSelected ? 'text-amber-700' : 'text-slate-500'
                      }`}
                    >
                      {o.hint}
                    </span>
                  )}
                </span>
                {isSelected && <Check className="h-4 w-4 shrink-0 text-amber-600" />}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
