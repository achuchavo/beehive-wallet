import { useCallback, useEffect, useState } from 'react'
import { Coins, TriangleAlert, CircleCheck } from 'lucide-react'
import {
  api,
  PERM_WRITE,
  type AdminChainPricing,
  type PermLevel,
  type WatchCadence,
} from '../api'
// Straight from the amount helpers rather than the chain-shaped wrappers: this
// screen works from an admin row (which carries `decimals`) and may be pricing
// a chain that is not in the active registry at all.
import { formatBase, toBaseUnits, fromBaseUnits } from '../wallet/amount'
import { useT } from '../i18n/I18nContext'
import Modal from '../components/Modal'
import ConfirmDelete from '../components/ConfirmDelete'
import HelpTip from '../components/HelpTip'
import Checkbox from '../components/Checkbox'
import OptionPicker from '../components/OptionPicker'

const CADENCE_KEY: Record<WatchCadence, string> = {
  one_time: 'pay.cadenceOneTime',
  weekly: 'pay.cadenceWeekly',
  monthly: 'pay.cadenceMonthly',
}

/**
 * Per-chain pricing for address alerts.
 *
 * One row per network with a form MODAL rather than an inline expander, so the
 * page stays short and the form has room for the explanations a screen that
 * sets a collection address needs.
 */
export default function AlertPricingManager({
  level,
  onError,
}: {
  level: PermLevel
  onError: (msg: string) => void
}) {
  const { t } = useT()
  const [rows, setRows] = useState<AdminChainPricing[] | null>(null)
  const [editing, setEditing] = useState<AdminChainPricing | null>(null)
  const [clearing, setClearing] = useState<AdminChainPricing | null>(null)
  const [clearBusy, setClearBusy] = useState(false)

  const canWrite = level >= PERM_WRITE

  const load = useCallback(() => {
    api
      .adminAlertPricing()
      .then((r) => setRows(r.chains))
      .catch((e) => onError(e instanceof Error ? e.message : 'Failed'))
  }, [onError])

  useEffect(() => {
    load()
  }, [load])

  async function confirmClear() {
    if (!clearing) return
    setClearBusy(true)
    try {
      await api.adminAlertPricingClear(clearing.chain_key)
      setClearing(null)
      load()
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Failed')
    } finally {
      setClearBusy(false)
    }
  }

  if (!rows) return <p className="text-sm text-slate-500">{t('common.loading')}</p>

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-2 font-medium">
            <Coins className="h-4 w-4 text-amber-600" /> {t('admin.pricingTitle')}
            <HelpTip text={t('help.paidAlerts')} />
          </h2>
          <p className="text-sm text-slate-500">{t('admin.pricingIntro')}</p>
        </div>
      </div>

      {!canWrite && (
        <p className="rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-600">
          {t('admin.readOnlyNote')}
        </p>
      )}

      <ul className="divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white">
        {rows.map((row) => (
          <li key={row.chain_key} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-1.5 text-sm font-medium">
                {row.chain_name}
                {!row.chain_is_active && (
                  <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-normal text-slate-500">
                    {t('staking.statusInactive')}
                  </span>
                )}
                {/* Three states, not two. "Nobody may buy more" is a normal
                    choice and must not wear a warning icon; only a chain that
                    LOOKS like it is selling but cannot take payment is a
                    misconfiguration worth shouting about. Telling them apart is
                    just whether a fee was set at all. */}
                {row.pricing &&
                  (row.pricing.sellable ? (
                    <span className="flex items-center gap-1 rounded bg-green-100 px-1.5 py-0.5 text-[11px] font-normal text-green-700">
                      <CircleCheck className="h-3 w-3" /> {t('admin.pricingSellable')}
                    </span>
                  ) : row.pricing.fee_amount === '0' ? (
                    <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-normal text-slate-600">
                      {t('admin.pricingFreeLimitOnly')}
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-normal text-amber-800">
                      <TriangleAlert className="h-3 w-3" /> {t('admin.pricingMisconfigured')}
                    </span>
                  ))}
              </div>
              <div className="mt-0.5 text-xs text-slate-500">
                {!row.pricing ? (
                  t('admin.pricingUnmetered')
                ) : row.pricing.fee_amount === '0' ? (
                  // No price means nothing is for sale, so quoting one would be
                  // noise. Say what actually happens instead.
                  <>
                    {t('admin.pricingFreeCap')}: {row.pricing.free_cap} · {t('admin.pricingHardStop')}
                  </>
                ) : (
                  <>
                    {t('admin.pricingFreeCap')}: {row.pricing.free_cap} ·{' '}
                    {formatBase(row.pricing.fee_amount, row.decimals)} {row.display_denom} ·{' '}
                    {t(CADENCE_KEY[row.pricing.cadence])}
                  </>
                )}
              </div>
              <div className="mt-0.5 text-xs text-slate-400">
                {t('admin.pricingCounts', {
                  total: row.watch_counts.total,
                  free: row.watch_counts.free,
                  paid: row.watch_counts.paid,
                  lapsed: row.watch_counts.lapsed,
                })}
              </div>
            </div>
            <div className="flex shrink-0 gap-3 text-xs">
              <button
                onClick={() => setEditing(row)}
                disabled={!canWrite}
                className="text-amber-700 hover:underline disabled:cursor-not-allowed disabled:text-slate-400 disabled:no-underline"
              >
                {row.pricing ? t('admin.pricingEdit') : t('admin.pricingConfigure')}
              </button>
              {row.pricing && (
                <button
                  onClick={() => setClearing(row)}
                  disabled={!canWrite}
                  className="text-red-600 hover:underline disabled:cursor-not-allowed disabled:text-slate-400 disabled:no-underline"
                >
                  {t('admin.pricingClear')}
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>

      {editing && (
        <PricingForm
          row={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            load()
          }}
          onError={onError}
        />
      )}

      {clearing && (
        <ConfirmDelete
          title={t('admin.pricingClearTitle', { chain: clearing.chain_name })}
          name={clearing.chain_name}
          impact={t('admin.pricingClearImpact')}
          busy={clearBusy}
          onConfirm={confirmClear}
          onCancel={() => setClearing(null)}
        />
      )}
    </div>
  )
}

function PricingForm({
  row,
  onClose,
  onSaved,
  onError,
}: {
  row: AdminChainPricing
  onClose: () => void
  onSaved: () => void
  onError: (msg: string) => void
}) {
  const { t } = useT()
  const p = row.pricing

  const [enabled, setEnabled] = useState(p?.alerts_enabled ?? true)
  const [freeCap, setFreeCap] = useState(String(p?.free_cap ?? 2))
  /**
   * Whether users may buy alerts beyond the free allowance.
   *
   * Stored as "fee of zero means nothing is for sale" - no extra column, and
   * unambiguous, since a paid tier priced at nothing is not a thing. But an
   * admin should not have to KNOW that: leaving this off is a deliberate "two
   * free and that is the end of it", so it gets its own control rather than
   * being inferred from an empty box.
   */
  const [sellExtra, setSellExtra] = useState(p ? p.fee_amount !== '0' : true)
  // Entered in DISPLAY units (what an admin thinks in) and converted exactly to
  // base units below. The converted value is shown before saving, so what is
  // stored is what was confirmed rather than what was assumed.
  const [feeDisplay, setFeeDisplay] = useState(
    p ? fromBaseUnits(p.fee_amount, row.decimals) : '0',
  )
  const [collect, setCollect] = useState(p?.collect_address ?? '')
  const [cadence, setCadence] = useState<WatchCadence>(p?.cadence ?? 'one_time')
  const [grace, setGrace] = useState(String(p?.grace_days ?? 0))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  // Exact conversion, no floats. An unparseable entry yields null rather than a
  // silently wrong number. toBaseUnits() rejects zero (it exists for amounts
  // people send), but zero is meaningful here - "keep the free limit, sell
  // nothing beyond it" - so it is handled before the conversion.
  const feeTrimmed = feeDisplay.trim()
  let feeBase: string | null = null
  if (feeTrimmed === '' || /^0(\.0*)?$/.test(feeTrimmed)) {
    feeBase = '0'
  } else {
    try {
      feeBase = toBaseUnits(feeTrimmed, row.decimals)
    } catch {
      feeBase = null
    }
  }

  const collectLooksRight =
    collect.trim() === '' || collect.trim().startsWith(`${row.bech32_prefix}1`)

  const capValid = /^\d+$/.test(freeCap.trim())
  const graceValid = /^\d+$/.test(grace.trim())
  // A price with nowhere to send it is the configuration that would take money
  // to an address nobody controls. Refused here as well as server-side.
  const hasSomewhereToPay = feeBase === '0' || collect.trim() !== ''
  // With selling off, the fee and collection address are not part of the
  // decision, so they cannot block the save either.
  const valid = sellExtra
    ? feeBase !== null && capValid && graceValid && collectLooksRight && hasSomewhereToPay
    : capValid

  async function save(e: React.FormEvent) {
    e.preventDefault()
    if (!valid) return
    setBusy(true)
    setError('')
    try {
      await api.adminAlertPricingSave({
        chain_key: row.chain_key,
        alerts_enabled: enabled,
        free_cap: Number(freeCap),
        // Selling off is stored as a zero fee. The collection address is kept
        // rather than wiped, so turning it back on does not mean re-typing it.
        fee_amount: sellExtra ? (feeBase ?? '0') : '0',
        fee_denom: row.denom,
        collect_address: collect.trim(),
        cadence,
        grace_days: Number(grace),
      })
      onSaved()
    } catch (err) {
      // Shown in the form, not behind it: the admin needs it next to the field
      // that caused it.
      setError(err instanceof Error ? err.message : 'Failed')
      onError('')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title={row.chain_name} onClose={busy ? () => {} : onClose} dismissible={!busy}>
      <form onSubmit={save} className="space-y-4">
        <div className="flex items-center gap-1.5">
          <Checkbox checked={enabled} onChange={setEnabled} label={t('admin.pricingEnabled')} />
          <HelpTip text={t('help.adminAlertsEnabled')} />
        </div>

        <label className="block">
          <span className="mb-1 flex items-center gap-1.5 text-xs font-medium text-slate-600">
            {t('admin.pricingFreeCap')}
            <HelpTip text={t('help.adminFreeCap')} align="start" />
          </span>
          <input
            value={freeCap}
            onChange={(e) => setFreeCap(e.target.value.trim())}
            inputMode="numeric"
            aria-invalid={!capValid}
            className="w-28 rounded-lg border border-slate-300 px-3 py-2 text-sm tabular-nums focus:border-amber-500 focus:outline-none"
          />
        </label>

        {/* The question an admin actually has, asked directly. Everything below
            it only exists if the answer is yes, so a "free limit and no more"
            setup is three fields rather than seven. */}
        <div className="rounded-lg bg-slate-50 p-3">
          <div className="flex items-center gap-1.5">
            <Checkbox
              checked={sellExtra}
              onChange={setSellExtra}
              label={t('admin.pricingSellExtra')}
            />
            <HelpTip text={t('help.adminSellExtra')} />
          </div>
          <p className="mt-1 pl-6 text-xs text-slate-500">
            {sellExtra
              ? t('admin.pricingSellExtraOn', { cap: capValid ? freeCap : '—' })
              : t('admin.pricingSellExtraOff', { cap: capValid ? freeCap : '—' })}
          </p>
        </div>

        {sellExtra && (
          <>
        <label className="block">
          <span className="mb-1 flex items-center gap-1.5 text-xs font-medium text-slate-600">
            {t('admin.pricingFee')}
            <HelpTip text={t('help.adminFee')} align="start" />
          </span>
          <div className="flex items-center gap-2">
            <input
              value={feeDisplay}
              onChange={(e) => setFeeDisplay(e.target.value.trim())}
              inputMode="decimal"
              aria-invalid={feeBase === null}
              className="w-40 rounded-lg border border-slate-300 px-3 py-2 text-sm tabular-nums focus:border-amber-500 focus:outline-none"
            />
            <span className="text-sm text-slate-500">{row.display_denom}</span>
          </div>
          {/* What will actually be stored and compared against the chain. */}
          <span className="mt-1 block text-xs text-slate-500">
            {feeBase === null
              ? t('admin.pricingFeeInvalid')
              : t('admin.pricingFeeBase', { base: feeBase, denom: row.denom })}
          </span>
        </label>

        <label className="block">
          <span className="mb-1 flex items-center gap-1.5 text-xs font-medium text-slate-600">
            {t('admin.pricingCollect')}
            <HelpTip text={t('help.adminCollect')} align="start" />
          </span>
          <input
            value={collect}
            onChange={(e) => setCollect(e.target.value.trim())}
            placeholder={`${row.bech32_prefix}1...`}
            autoComplete="off"
            spellCheck={false}
            aria-invalid={!collectLooksRight}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-xs focus:border-amber-500 focus:outline-none"
          />
          {!collectLooksRight && (
            <span className="mt-1 block text-xs text-red-600">
              {t('admin.pricingCollectInvalid', { chain: row.chain_name })}
            </span>
          )}
        </label>

        <label className="block">
          <span className="mb-1 flex items-center gap-1.5 text-xs font-medium text-slate-600">
            {t('admin.pricingCadence')}
            <HelpTip text={t('help.adminCadence')} align="start" />
          </span>
          <OptionPicker
            label={t('admin.pricingCadence')}
            value={cadence}
            onChange={(v) => setCadence(v as WatchCadence)}
            options={(['one_time', 'weekly', 'monthly'] as WatchCadence[]).map((c) => ({
              value: c,
              label: t(CADENCE_KEY[c]),
            }))}
          />
        </label>

        {cadence !== 'one_time' && (
          <label className="block">
            <span className="mb-1 flex items-center gap-1.5 text-xs font-medium text-slate-600">
              {t('admin.pricingGrace')}
              <HelpTip text={t('help.adminGrace')} align="start" />
            </span>
            <input
              value={grace}
              onChange={(e) => setGrace(e.target.value.trim())}
              inputMode="numeric"
              aria-invalid={!graceValid}
              className="w-28 rounded-lg border border-slate-300 px-3 py-2 text-sm tabular-nums focus:border-amber-500 focus:outline-none"
            />
          </label>
        )}
          </>
        )}

        {error && (
          <div role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-lg px-4 py-2 text-sm text-slate-600 hover:text-slate-900 disabled:opacity-50"
          >
            {t('common.cancel')}
          </button>
          <button
            disabled={busy || !valid}
            className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-slate-900 hover:bg-amber-600 disabled:opacity-50"
          >
            {busy ? t('alarms.working') : t('common.save')}
          </button>
        </div>
      </form>
    </Modal>
  )
}
