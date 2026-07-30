import Modal from './Modal'
import RichText from './RichText'
import { useT } from '../i18n/I18nContext'
import type { Announcement } from '../api'

/**
 * The announcement popup. Purely presentational: what closing, dismissing,
 * snoozing and the CTA actually DO (persist state, navigate) is wired by the
 * caller, so App can persist per-announcement state while the admin editor can
 * reuse this exact component as a live preview that persists nothing.
 *
 * X / Escape / backdrop are a SOFT close: they only put the popup away for
 * now, and it may come back on the next visit. Silencing must be the explicit
 * "don't show again" button - reflex-closing a dialog is not consent to never
 * seeing it again.
 */
export default function AnnouncementModal({
  announcement,
  onClose,
  onDismiss,
  onSnooze,
  onCta,
}: {
  announcement: Announcement
  /** Soft close (X, Escape, backdrop): put it away for now, persist nothing. */
  onClose: () => void
  /** The explicit "don't show again" button. */
  onDismiss: () => void
  /** Show again after a day. */
  onSnooze: () => void
  /** CTA pressed; caller navigates to announcement.cta_path. */
  onCta: () => void
}) {
  const { t } = useT()
  const hasCta = announcement.cta_label !== '' && announcement.cta_path !== ''

  return (
    <Modal title={announcement.message} onClose={onClose}>
      <div className="space-y-4">
        {announcement.body !== '' && <RichText text={announcement.body} />}
        <div className="space-y-2 pt-1">
          {hasCta && (
            <button
              onClick={onCta}
              className="w-full rounded-xl bg-amber-500 px-4 py-2.5 text-sm font-medium text-slate-900 hover:bg-amber-600"
            >
              {announcement.cta_label}
            </button>
          )}
          <div className="flex items-center justify-center gap-5 pt-1">
            <button
              onClick={onSnooze}
              className="text-sm text-slate-600 hover:text-amber-700"
            >
              {t('announce.snooze')}
            </button>
            <button onClick={onDismiss} className="text-sm text-slate-500 hover:text-slate-700">
              {t('announce.dismiss')}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  )
}
