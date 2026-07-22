import { useEffect } from 'react'

/**
 * Transient full-screen loading state.
 *
 * Deliberately NOT built on Modal: there is nothing to dismiss, so it has no
 * close control, no focus trap and no Escape handling — trapping focus in
 * something the user cannot act on or close would be worse than no dialog.
 * It is announced politely instead, via role="status".
 */
export default function LoadingOverlay({
  title,
  subtitle,
}: {
  title: string
  subtitle?: string
}) {
  // Hold the background still while it is up, and always restore on unmount.
  useEffect(() => {
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previous
    }
  }, [])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/30 p-4 backdrop-blur-[2px]"
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <div className="flex w-full max-w-xs flex-col items-center gap-4 rounded-2xl bg-white p-6 text-center shadow-xl">
        {/* Ring + orbiting dot. data-spinner keeps this moving under
            prefers-reduced-motion (see index.css): a small progress indicator
            is not a vestibular trigger, and a frozen spinner reads as a hang. */}
        <div className="relative h-14 w-14">
          <div className="absolute inset-0 rounded-full border-4 border-amber-100" />
          <div
            data-spinner
            className="absolute inset-0 animate-spin rounded-full border-4 border-transparent border-t-amber-500"
          />
          <div className="absolute inset-0 flex items-center justify-center">
            <img src={`${import.meta.env.BASE_URL}beehive.ico`} alt="" className="h-6 w-6" />
          </div>
        </div>

        <div>
          <p className="text-sm font-medium text-slate-900">{title}</p>
          {subtitle && <p className="mt-1 text-xs text-slate-600">{subtitle}</p>}
        </div>
      </div>
    </div>
  )
}
