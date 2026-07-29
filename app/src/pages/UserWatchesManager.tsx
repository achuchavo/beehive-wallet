import { useCallback, useEffect, useState } from 'react'
import { Eye, ChevronDown, ChevronRight } from 'lucide-react'
import { api, type AdminUserWatch, type AdminWatchAccount } from '../api'
import { CHAINS } from '../chains'
import { formatBase } from '../wallet/amount'
import { useT } from '../i18n/I18nContext'
import HelpTip from '../components/HelpTip'
import OptionPicker from '../components/OptionPicker'

/**
 * Who is watching what, and how it is paid for.
 *
 * Read-only by design, and there is no edit control anywhere on this screen:
 * switching off an alert somebody set up to watch their own money is not an
 * administrative action, and putting a button there would invite it.
 */
export default function UserWatchesManager({ onError }: { onError: (msg: string) => void }) {
  const { t } = useT()
  const [accounts, setAccounts] = useState<AdminWatchAccount[] | null>(null)
  const [totals, setTotals] = useState({ total: 0, paid: 0, free: 0, lapsed: 0 })
  const [matched, setMatched] = useState(0)
  const [page, setPage] = useState(1)
  const [perPage, setPerPage] = useState(25)
  const [q, setQ] = useState('')
  const [chainKey, setChainKey] = useState('')
  const [tier, setTier] = useState('')
  // Which accounts are expanded, by user id. Collapsed by default so the page
  // is a scannable list of people rather than every address in the deployment.
  const [open, setOpen] = useState<Set<number>>(new Set())

  const load = useCallback(() => {
    api
      .adminUserWatches({ q, chain_key: chainKey, tier, page })
      .then((r) => {
        setAccounts(r.accounts)
        setTotals(r.totals)
        setMatched(r.total_accounts)
        setPerPage(r.per_page)
      })
      .catch((e) => onError(e instanceof Error ? e.message : 'Failed'))
  }, [q, chainKey, tier, page, onError])

  function toggle(userId: number) {
    setOpen((prev) => {
      const next = new Set(prev)
      if (next.has(userId)) next.delete(userId)
      else next.add(userId)
      return next
    })
  }

  useEffect(() => {
    // Debounced so typing in the search box does not fire a query per keystroke
    // against a join over the two largest tables here.
    const timer = setTimeout(load, 250)
    return () => clearTimeout(timer)
  }, [load])

  function decimalsFor(key: string) {
    return CHAINS.find((c) => c.key === key)?.decimals ?? 6
  }

  /** Chain display name, falling back to the key for a chain since removed. */
  function chainLabel(key: string) {
    return CHAINS.find((c) => c.key === key)?.chainName ?? key
  }

  const lastPage = Math.max(1, Math.ceil(matched / perPage))

  return (
    <div className="space-y-3">
      <div>
        <h2 className="flex items-center gap-2 font-medium">
          <Eye className="h-4 w-4 text-slate-500" /> {t('admin.watchesTitle')}
          <HelpTip text={t('help.adminUserWatches')} />
        </h2>
        <p className="text-sm text-slate-500">{t('admin.watchesIntro')}</p>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label={t('admin.watchesFilterAll')} value={totals.total} />
        <Stat label={t('admin.watchesFilterFree')} value={totals.free} />
        <Stat label={t('admin.watchesFilterPaid')} value={totals.paid} />
        <Stat label={t('admin.watchesFilterLapsed')} value={totals.lapsed} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <input
          value={q}
          onChange={(e) => {
            setQ(e.target.value)
            setPage(1)
          }}
          placeholder={t('admin.watchesSearch')}
          aria-label={t('admin.watchesSearch')}
          className="min-w-48 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-amber-500 focus:outline-none"
        />
        <OptionPicker
          label={t('dash.chainFilter')}
          value={chainKey}
          onChange={(v) => {
            setChainKey(v)
            setPage(1)
          }}
          className="py-2"
          options={[
            { value: '', label: t('admin.watchesFilterAll') },
            ...CHAINS.map((c) => ({ value: c.key, label: c.chainName })),
          ]}
        />
        <OptionPicker
          label={t('pay.tierPaid')}
          value={tier}
          onChange={(v) => {
            setTier(v)
            setPage(1)
          }}
          className="py-2"
          options={[
            { value: '', label: t('admin.watchesFilterAll') },
            { value: 'free', label: t('admin.watchesFilterFree') },
            { value: 'paid', label: t('admin.watchesFilterPaid') },
            { value: 'lapsed', label: t('admin.watchesFilterLapsed') },
          ]}
        />
      </div>

      {!accounts ? (
        <p className="text-sm text-slate-500">{t('common.loading')}</p>
      ) : accounts.length === 0 ? (
        <p className="text-sm text-slate-500">{t('admin.watchesNone')}</p>
      ) : (
        <ul className="divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white">
          {accounts.map((acct) => {
            const expanded = open.has(acct.user_id)
            return (
              <li key={acct.user_id}>
                {/* The account row is a disclosure. aria-expanded/aria-controls
                    matter here: without them this announces as a plain button
                    with nothing to say it reveals a region. */}
                <button
                  onClick={() => toggle(acct.user_id)}
                  aria-expanded={expanded}
                  aria-controls={`watches-${acct.user_id}`}
                  className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-slate-50"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    {expanded ? (
                      <ChevronDown className="h-4 w-4 shrink-0 text-slate-500" />
                    ) : (
                      <ChevronRight className="h-4 w-4 shrink-0 text-slate-500" />
                    )}
                    <span className="truncate text-sm font-medium">{acct.email}</span>
                  </span>
                  {/* Summary on the collapsed row, so the list is worth reading
                      without expanding anything. */}
                  <span className="flex shrink-0 items-center gap-1.5 text-xs">
                    <span className="text-slate-500">
                      {t('admin.watchesAddressCount', { count: acct.counts.total })}
                    </span>
                    {acct.counts.paid > 0 && (
                      <span className="rounded bg-green-100 px-1.5 py-0.5 font-medium text-green-700">
                        {t('admin.watchesPaidCount', { count: acct.counts.paid })}
                      </span>
                    )}
                    {acct.counts.lapsed > 0 && (
                      <span className="rounded bg-red-100 px-1.5 py-0.5 font-medium text-red-700">
                        {t('admin.watchesLapsedCount', { count: acct.counts.lapsed })}
                      </span>
                    )}
                  </span>
                </button>

                <div id={`watches-${acct.user_id}`} hidden={!expanded}>
                  <ul className="divide-y divide-slate-100 border-t border-slate-100 bg-slate-50/60">
                    {acct.watches.map((w) => (
                      <li
                        key={w.id}
                        className="flex flex-wrap items-start justify-between gap-3 py-2.5 pl-10 pr-4 text-sm"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-xs text-slate-600">
                            {w.label ? `${w.label} · ` : ''}
                            <span className="font-mono">
                              {w.address.slice(0, 14)}...{w.address.slice(-6)}
                            </span>
                          </div>
                          <div className="mt-0.5 text-xs text-slate-400">
                            {chainLabel(w.chain_key)} · {w.alarm_type}
                            {w.alarm_enabled === 0 && ` · ${t('admin.watchesAlarmOff')}`}
                          </div>
                        </div>
                        <div className="shrink-0 text-right text-xs">
                          <WatchBilling watch={w} decimals={decimalsFor(w.chain_key)} />
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {matched > perPage && (
        <div className="flex items-center justify-between text-xs text-slate-500">
          <span>{t('admin.watchesAccountCount', { shown: accounts?.length ?? 0, total: matched })}</span>
          <div className="flex gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="rounded-lg border border-slate-300 px-2.5 py-1 hover:border-amber-500 disabled:opacity-40"
            >
              {t('admin.prev')}
            </button>
            <button
              onClick={() => setPage((p) => p + 1)}
              disabled={page >= lastPage}
              className="rounded-lg border border-slate-300 px-2.5 py-1 hover:border-amber-500 disabled:opacity-40"
            >
              {t('admin.next')}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

/** Billing state for one watched address: tier, expiry and payment history. */
function WatchBilling({ watch: w, decimals }: { watch: AdminUserWatch; decimals: number }) {
  const { t } = useT()

  if (w.tier !== 'paid') {
    return (
      <>
        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-600">
          {t('pay.tierFree')}
        </span>
        <div className="mt-1 text-slate-400">{t('admin.watchesNever')}</div>
      </>
    )
  }

  return (
    <>
      <span
        className={`rounded px-1.5 py-0.5 font-medium ${
          w.payment_state === 'lapsed' ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'
        }`}
      >
        {w.payment_state === 'lapsed' ? t('pay.lapsed') : t('pay.tierPaid')}
      </span>
      <div className="mt-1 text-slate-500">
        {w.paid_until ? t('pay.paidUntil', { date: w.paid_until.slice(0, 10) }) : t('pay.paidForever')}
      </div>
      <div className="text-slate-400">
        {t('admin.watchesPayments', { count: w.payment_count })}
        {w.last_amount && (
          <>
            {' · '}
            {formatBase(w.last_amount, decimals)} {w.last_denom}
          </>
        )}
      </div>
      {w.last_paid_at && (
        <div className="text-slate-400">
          {t('admin.watchesLastPaid', { date: w.last_paid_at.slice(0, 10) })}
        </div>
      )}
    </>
  )
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-3 py-2">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="text-lg font-semibold tabular-nums">{value.toLocaleString()}</div>
    </div>
  )
}
