import { useEffect, useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { useT } from '../i18n/I18nContext'

/**
 * Wraps secret material (seed phrase, private key) behind a cover that closes
 * itself whenever the page might be observed by something other than the user.
 *
 * It re-covers on:
 *   - visibilitychange to hidden (tab switch, app switch, screen lock)
 *   - window blur (another window took focus - including a screen recorder or
 *     a screen-share picker, which does NOT always fire visibilitychange)
 *
 * NOTE on what this cannot do: React state and the DOM still hold the string
 * while it is revealed, and JavaScript cannot scrub it from memory. This limits
 * how long it is on SCREEN, which is the realistic threat here - shoulder
 * surfing, screen sharing, and a screenshot taken by the OS when the app is
 * backgrounded. It is not a defence against a compromised device.
 */
export default function SecretShield({
  children,
  covered: controlledCovered,
  onCoveredChange,
}: {
  children: React.ReactNode
  covered?: boolean
  onCoveredChange?: (covered: boolean) => void
}) {
  const { t } = useT()
  const [internal, setInternal] = useState(true)
  const covered = controlledCovered ?? internal

  const setCovered = (v: boolean) => {
    setInternal(v)
    onCoveredChange?.(v)
  }

  useEffect(() => {
    const cover = () => setCovered(true)
    const onVisibility = () => {
      if (document.hidden) cover()
    }
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('blur', cover)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('blur', cover)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="relative">
      <div className={covered ? 'pointer-events-none select-none blur-sm' : ''} aria-hidden={covered}>
        {children}
      </div>
      {covered && (
        <button
          type="button"
          onClick={() => setCovered(false)}
          className="absolute inset-0 flex flex-col items-center justify-center gap-1 rounded-lg bg-slate-50/80 text-sm font-medium text-slate-700 backdrop-blur-sm hover:text-amber-700"
        >
          <Eye className="h-5 w-5" />
          {t('settings.tapToReveal')}
        </button>
      )}
      {!covered && (
        <button
          type="button"
          onClick={() => setCovered(true)}
          className="absolute right-1 top-1 flex items-center gap-1 rounded bg-white/90 px-1.5 py-0.5 text-xs text-slate-600 hover:text-amber-700"
        >
          <EyeOff className="h-3.5 w-3.5" /> {t('settings.hide')}
        </button>
      )}
    </div>
  )
}
