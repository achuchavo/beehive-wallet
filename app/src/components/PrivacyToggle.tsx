import { Eye, EyeOff } from 'lucide-react'
import { usePrivacyMode, setPrivacyMode } from '../privacyMode'
import { useT } from '../i18n/I18nContext'

/**
 * The hide-balances eye, on EVERY page that shows amounts - privacy mode used
 * to be toggleable only on the Dashboard, so switching it off meant going
 * back there first. The state is global (privacyMode.ts), so every instance
 * of this button reflects and controls the same switch.
 *
 * Display-only, and labelled as such in the title: the figures are still in
 * the page and anyone with the device can switch it back. It is for
 * shoulder-surfing and screen sharing, not secrecy.
 */
export default function PrivacyToggle() {
  const hidden = usePrivacyMode()
  const { t } = useT()
  return (
    <button
      type="button"
      onClick={() => setPrivacyMode(!hidden)}
      aria-pressed={hidden}
      title={t('dash.privacyHint')}
      className="rounded-xl bg-white px-2.5 py-1.5 text-slate-600 ring-1 ring-slate-200 hover:text-amber-700"
    >
      {hidden ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      <span className="sr-only">{t('dash.privacyToggle')}</span>
    </button>
  )
}
