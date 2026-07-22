import { fromBaseUnits, type ChainInfo } from '../chains'
import { useT } from '../i18n/I18nContext'

function toBig(s: string): bigint {
  const digits = (s ?? '').split('.')[0].replace(/[^0-9]/g, '')
  return digits ? BigInt(digits) : 0n
}

// Quick amount presets (25/50/75/Max) computed from a base-unit maximum.
// reserveBase is held back from Max so a spend can still pay gas.
export default function PercentButtons({
  maxBase,
  reserveBase = '0',
  chain,
  onPick,
  className = '',
}: {
  maxBase: string
  reserveBase?: string
  chain: ChainInfo
  onPick: (amount: string) => void
  className?: string
}) {
  const { t } = useT()
  const total = toBig(maxBase)
  if (total <= 0n) return null
  const reserve = toBig(reserveBase)

  const pickFraction = (num: bigint, den: bigint) =>
    onPick(fromBaseUnits(((total * num) / den).toString(), chain))
  const pickMax = () =>
    onPick(fromBaseUnits((total > reserve ? total - reserve : total).toString(), chain))

  const btn =
    'flex-1 rounded-lg border border-slate-300 py-1 text-xs text-slate-600 hover:border-amber-500 hover:text-amber-700'

  return (
    <div className={`flex gap-1 ${className}`}>
      <button type="button" onClick={() => pickFraction(1n, 4n)} className={btn}>
        25%
      </button>
      <button type="button" onClick={() => pickFraction(1n, 2n)} className={btn}>
        50%
      </button>
      <button type="button" onClick={() => pickFraction(3n, 4n)} className={btn}>
        75%
      </button>
      <button type="button" onClick={pickMax} className={btn}>
        {t('common.max')}
      </button>
    </div>
  )
}
