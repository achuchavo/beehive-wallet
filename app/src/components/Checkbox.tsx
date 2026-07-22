import { Check } from 'lucide-react'

// A branded checkbox: a real <input> (accessible, focusable) styled with
// appearance-none plus an overlaid check mark, wrapped with its label.
export default function Checkbox({
  checked,
  onChange,
  label,
  disabled = false,
  className = '',
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label: React.ReactNode
  disabled?: boolean
  className?: string
}) {
  return (
    <label className={`flex cursor-pointer items-center gap-2 ${disabled ? 'opacity-60' : ''} ${className}`}>
      <span className="relative flex h-5 w-5 shrink-0 items-center justify-center">
        <input
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
          className="peer h-5 w-5 cursor-pointer appearance-none rounded-md border border-slate-300 bg-white transition-colors checked:border-amber-500 checked:bg-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-500/30"
        />
        <Check
          className="pointer-events-none absolute h-3.5 w-3.5 text-white opacity-0 transition-opacity peer-checked:opacity-100"
          strokeWidth={3}
        />
      </span>
      <span className="text-sm text-slate-700">{label}</span>
    </label>
  )
}
