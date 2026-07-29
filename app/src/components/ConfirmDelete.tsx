import Modal from './Modal'
import { TriangleAlert } from 'lucide-react'
import { useT } from '../i18n/I18nContext'

/**
 * Confirmation for a delete that takes history with it.
 *
 * Removing a watched address or an uptime subscription also removes the alerts
 * recorded against it - a record of past activity the user may have been
 * keeping deliberately. A single unguarded trash icon next to it is too easy to
 * hit, and there is no undo on the server, so the friction goes here.
 *
 * `impact` names what else disappears, in the user's terms. A confirmation that
 * only asks "are you sure?" tells them nothing they did not already know.
 */
export default function ConfirmDelete({
  title,
  name,
  impact,
  busy,
  confirmLabel,
  onConfirm,
  onCancel,
}: {
  title: string
  name: string
  impact: string
  busy?: boolean
  /**
   * Text on the confirming button. Defaults to "Remove".
   *
   * Not every irreversible action is a deletion - withdrawing an authorisation
   * removes nothing but stops a service someone relies on, and a button reading
   * "Remove" would misdescribe what is about to happen.
   */
  confirmLabel?: string
  onConfirm: () => void
  onCancel: () => void
}) {
  const { t } = useT()
  return (
    <Modal title={title} onClose={busy ? () => {} : onCancel} dismissible={!busy}>
      <div className="space-y-3">
        <p className="text-sm font-medium">{name}</p>
        <div className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <p>{impact}</p>
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded-lg px-4 py-2 text-sm text-slate-600 hover:text-slate-900 disabled:opacity-50"
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
          >
            {busy ? t('alarms.working') : (confirmLabel ?? t('common.remove'))}
          </button>
        </div>
      </div>
    </Modal>
  )
}
