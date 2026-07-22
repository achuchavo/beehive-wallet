import { useState } from 'react'
import { Copy, Check } from 'lucide-react'

// An address (full or shortened) with a copy icon beside it. Copies the full
// address regardless of what's displayed.
export default function CopyAddress({
  address,
  display,
  className = '',
}: {
  address: string
  display?: string
  className?: string
}) {
  const [copied, setCopied] = useState(false)

  async function copy(e: React.MouseEvent) {
    e.stopPropagation()
    e.preventDefault()
    try {
      await navigator.clipboard.writeText(address)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // clipboard blocked - ignore
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      title={address}
      className={`inline-flex items-center gap-1 font-mono hover:text-amber-700 ${className}`}
    >
      <span className="truncate">{display ?? address}</span>
      {copied ? (
        <Check className="h-3.5 w-3.5 shrink-0 text-green-700" />
      ) : (
        <Copy className="h-3.5 w-3.5 shrink-0" />
      )}
    </button>
  )
}
