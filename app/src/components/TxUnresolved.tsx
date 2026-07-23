import { TriangleAlert, ExternalLink, RefreshCw } from 'lucide-react'
import Modal from './Modal'
import CopyAddress from './CopyAddress'
import type { ChainInfo } from '../chains'
import { useT } from '../i18n/I18nContext'

/**
 * Shown when a broadcast could neither be confirmed nor ruled out - a timeout
 * or dropped connection after the signed bytes were already sent.
 *
 * There is deliberately NO retry control here. The whole reason this state
 * exists is that the previous code reported an ambiguous result as a plain
 * failure, putting a one-click retry in front of what may be an already-
 * accepted transaction: a duplicate send, delegation or reward claim.
 *
 * What it offers instead is everything needed to find out: the hash (computed
 * from the signed bytes, so it is correct whether or not the node replied), a
 * re-check against the chain, and an explorer link.
 */
export default function TxUnresolved({
  chain,
  hash,
  busy,
  onRecheck,
  onDismiss,
}: {
  chain: ChainInfo
  hash: string
  busy: boolean
  onRecheck: () => void
  onDismiss: () => void
}) {
  const { t } = useT()
  return (
    <Modal title={t('tx.unresolvedTitle')} onClose={onDismiss}>
      <div className="space-y-3">
        <div className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <p>{t('tx.unresolvedBody')}</p>
        </div>

        <p className="text-sm font-medium text-red-700">{t('tx.unresolvedDoNotRetry')}</p>

        <div>
          <div className="mb-1 text-xs font-medium text-slate-600">{t('tx.hash')}</div>
          <CopyAddress address={hash} className="max-w-full font-mono text-xs text-slate-600" />
        </div>

        <div className="flex flex-wrap gap-2 pt-1">
          <button
            type="button"
            onClick={onRecheck}
            disabled={busy}
            className="flex items-center gap-1.5 rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-slate-900 hover:bg-amber-600 disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${busy ? 'animate-spin' : ''}`} />
            {busy ? t('tx.checking') : t('tx.checkStatus')}
          </button>
          {chain.explorerTxUrl && (
            <a
              href={`${chain.explorerTxUrl}${hash}`}
              target="_blank"
              rel="noreferrer noopener"
              className="flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm hover:border-amber-500"
            >
              <ExternalLink className="h-4 w-4" /> {t('tx.openExplorer')}
            </a>
          )}
          <button
            type="button"
            onClick={onDismiss}
            className="rounded-lg px-4 py-2 text-sm text-slate-600 hover:text-slate-900"
          >
            {t('common.close')}
          </button>
        </div>
      </div>
    </Modal>
  )
}
