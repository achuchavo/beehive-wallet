import { ChevronDown } from 'lucide-react'

// A native <select> (keeps full accessibility + keyboard support) restyled with
// a branded border, focus ring, and a custom chevron instead of the OS default.
export default function Select({
  className = '',
  full = false,
  children,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement> & { full?: boolean }) {
  return (
    <div className={`relative ${full ? 'block w-full' : 'inline-block'}`}>
      <select
        {...props}
        className={`w-full cursor-pointer appearance-none rounded-lg border border-slate-300 bg-white py-1.5 pl-3 pr-8 text-sm text-slate-700 shadow-sm transition-colors hover:border-slate-400 focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-500/30 disabled:cursor-default disabled:opacity-60 ${className}`}
      >
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
    </div>
  )
}
