import { LockKeyhole, TriangleAlert } from 'lucide-react'
import Modal from './Modal'
import { useT } from '../i18n/I18nContext'

export interface ReviewRow {
  label: string
  value: string
  mono?: boolean
  strong?: boolean
}

// Final review before signing: shows the verified network, full addresses,
// human amount, estimated fee, total debit and action, then an explicit confirm.
export default function TxReview({
  rows,
  warning,
  confirmLabel,
  busy,
  onConfirm,
  onClose,
}: {
  rows: ReviewRow[]
  warning?: string
  confirmLabel: string
  busy: boolean
  onConfirm: () => void
  onClose: () => void
}) {
  const { t } = useT()
  return (
    <Modal title={t('review.title')} onClose={busy ? () => {} : onClose}>
      <dl className="space-y-2 text-sm">
        {rows.map((r) => (
          <div key={r.label} className="flex items-start justify-between gap-3">
            <dt className="shrink-0 text-slate-500">{r.label}</dt>
            <dd
              className={`min-w-0 break-all text-right ${r.mono ? 'font-mono text-xs' : ''} ${
                r.strong ? 'font-semibold text-slate-900' : 'text-slate-800'
              }`}
            >
              {r.value}
            </dd>
          </div>
        ))}
      </dl>
      {warning && (
        <div className="mt-3 flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
          <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {warning}
        </div>
      )}
      <div className="mt-4 flex gap-2">
        <button
          onClick={onConfirm}
          disabled={busy}
          className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-amber-500 py-2 text-sm font-medium text-white hover:bg-amber-600 disabled:opacity-50"
        >
          <LockKeyhole className="h-4 w-4" /> {busy ? t('review.broadcasting') : confirmLabel}
        </button>
        <button
          onClick={onClose}
          disabled={busy}
          className="rounded-lg border border-slate-300 px-4 py-2 text-sm hover:border-amber-500 disabled:opacity-50"
        >
          {t('common.cancel')}
        </button>
      </div>
    </Modal>
  )
}
