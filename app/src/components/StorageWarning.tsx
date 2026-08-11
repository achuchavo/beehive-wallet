import { useEffect, useState } from 'react'
import { TriangleAlert } from 'lucide-react'
import { getStorageState, storageAtRisk, type StorageState } from '../wallet/storagePersistence'
import { useT } from '../i18n/I18nContext'
import HelpTip from './HelpTip'

/**
 * Warns when this browser might not keep the wallets stored in it.
 *
 * Shown only when there is something to lose - a user with no wallet has no
 * problem yet, and a warning they cannot act on is just noise.
 *
 * Two distinct messages, because the remedies are different. An in-app browser
 * (a link opened inside KakaoTalk, Instagram, Line) keeps its storage in a
 * short-lived jar that is not the user's real browser, so a wallet made there
 * can vanish and is invisible from anywhere else - the fix is to open the site
 * properly. Evictable storage is milder: the browser may clear it under
 * pressure, and the fix is to have the recovery phrase written down.
 */
export default function StorageWarning({ hasWallets }: { hasWallets: boolean }) {
  const { t } = useT()
  const [state, setState] = useState<StorageState | null>(null)

  useEffect(() => {
    let cancelled = false
    getStorageState().then((s) => {
      if (!cancelled) setState(s)
    })
    return () => {
      cancelled = true
    }
  }, [hasWallets])

  // Always reported, even when healthy: when a user says "my wallet vanished",
  // the first question is whether this browser was keeping it, and that has to
  // be answerable from the screen rather than guessed at afterwards.
  if (!hasWallets || !state) return null

  if (!storageAtRisk(state)) {
    return (
      <p className="text-xs text-slate-400">
        {t('storage.persistedOk')}
      </p>
    )
  }

  const inApp = state.inAppBrowser

  return (
    <div
      role="status"
      className={`flex items-start gap-2.5 rounded-xl border px-4 py-3 text-sm ${
        inApp
          ? 'border-red-200 bg-red-50 text-red-900'
          : 'border-amber-200 bg-amber-50 text-amber-900'
      }`}
    >
      <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="space-y-1">
        <p className="font-medium">
          {inApp ? t('storage.inAppTitle') : t('storage.evictableTitle')}
        </p>
        <p className="text-xs leading-relaxed">
          {inApp ? t('storage.inAppBody') : t('storage.evictableBody')}
        </p>
        {/* Stated every time, because it is the one thing that makes this
            recoverable rather than merely alarming. */}
        <p className="flex items-center gap-1.5 text-xs font-medium">
          {t('storage.backupReminder')}
          <HelpTip text={t('help.storageBackup')} align="start" />
        </p>
      </div>
    </div>
  )
}
