import { useState } from 'react'
import { TriangleAlert, Trash2 } from 'lucide-react'
import Modal from './Modal'
import Checkbox from './Checkbox'
import { useT } from '../i18n/I18nContext'

/**
 * Accessible confirmation for removing a wallet (audit #27).
 *
 * Replaces window.confirm(), which is unstyled, untranslatable, not focus-
 * trapped and trivially dismissed. Removal destroys the only encrypted copy on
 * this device, so this makes the consequences explicit, asks the user to
 * confirm they hold a backup, and requires them to type the wallet name -
 * deliberately more effort than clicking OK.
 *
 * Typed confirmation is used rather than password re-entry so no secret has to
 * be held in component state just to delete something.
 */
export default function RemoveWalletDialog({
  walletName,
  address,
  busy = false,
  onConfirm,
  onClose,
}: {
  walletName: string
  address: string
  /** True while a wallet-sensitive operation is running; blocks removal. */
  busy?: boolean
  onConfirm: () => void
  onClose: () => void
}) {
  const { t } = useT()
  const [typed, setTyped] = useState('')
  const [hasBackup, setHasBackup] = useState(false)

  const nameMatches = typed.trim() === walletName.trim()
  const canRemove = nameMatches && hasBackup && !busy

  return (
    <Modal title={t('settings.removeTitle')} onClose={onClose} dismissible={!busy}>
      <div className="space-y-3 text-sm">
        <div className="flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2 text-red-800">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{t('settings.removeWarning')}</span>
        </div>

        <ul className="list-disc space-y-1 pl-5 text-slate-600">
          <li>{t('settings.removeFactLocal')}</li>
          <li>{t('settings.removeFactOnChain')}</li>
          <li>{t('settings.removeFactRecovery')}</li>
        </ul>

        <div className="rounded-lg bg-slate-50 px-3 py-2">
          <div className="text-xs text-slate-500">{t('settings.removeWallet')}</div>
          <div className="font-medium">{walletName}</div>
          <div className="break-all font-mono text-xs text-slate-500">{address}</div>
        </div>

        <Checkbox
          checked={hasBackup}
          onChange={setHasBackup}
          label={t('settings.removeHaveBackup')}
        />

        <div>
          <label htmlFor="remove-confirm-name" className="mb-1 block text-xs text-slate-600">
            {t('settings.removeTypeName', { name: walletName })}
          </label>
          <input
            id="remove-confirm-name"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoComplete="off"
            spellCheck={false}
            aria-describedby="remove-confirm-help"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-red-500 focus:outline-none"
          />
          {typed !== '' && !nameMatches && (
            <p id="remove-confirm-help" role="alert" className="mt-1 text-xs text-red-600">
              {t('settings.removeNameMismatch')}
            </p>
          )}
        </div>

        <div className="flex gap-2 pt-1">
          <button
            onClick={onConfirm}
            disabled={!canRemove}
            className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-red-600 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Trash2 className="h-4 w-4" /> {t('settings.removeConfirmBtn')}
          </button>
          <button
            onClick={onClose}
            disabled={busy}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm hover:border-slate-400 disabled:opacity-50"
          >
            {t('common.cancel')}
          </button>
        </div>
      </div>
    </Modal>
  )
}
