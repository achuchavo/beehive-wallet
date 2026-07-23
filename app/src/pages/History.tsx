import { useCallback, useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight, ExternalLink, Wallet } from 'lucide-react'
import { DEFAULT_CHAIN, chainForAddress, formatAmount, type ChainInfo } from '../chains'
import { api, type WatchedAddress } from '../api'
import { useWallet } from '../wallet/WalletContext'
import { fetchTxSearch } from '../wallet/txsearch'
import LoadingOverlay from '../components/LoadingOverlay'
import { useT } from '../i18n/I18nContext'

type Translate = (key: string, vars?: Record<string, string | number>) => string

interface TxRow {
  hash: string
  height: number
  time: string
  direction: 'sent' | 'received' | 'other'
  summary: string
}

type Filter = 'all' | 'sent' | 'received' | 'other'

const MAX_ROWS = 50
const PAGE_SIZE = 10

interface LcdTxResponse {
  txhash: string
  height: string
  timestamp: string
  tx: { body: { messages: Record<string, unknown>[] } }
}

/** Local date+time for reading, with the precise UTC value in the tooltip. */
export function formatWhen(iso: string): { label: string; exact: string } {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return { label: iso, exact: iso }
  return {
    label: d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }),
    exact: `${iso.replace('T', ' ').replace('Z', '')} UTC`,
  }
}

function shortAddr(a: string) {
  return a.length > 20 ? `${a.slice(0, 12)}...${a.slice(-6)}` : a
}

function msgTypeName(type: string) {
  const last = type.split('.').pop() ?? type
  return last.replace(/^Msg/, '')
}

function classify(
  resp: LcdTxResponse,
  address: string,
  fromQuery: 'sent' | 'received',
  t: Translate,
  chain: ChainInfo,
): TxRow {
  const messages = resp.tx?.body?.messages ?? []
  let direction: TxRow['direction'] = fromQuery === 'sent' ? 'other' : 'received'
  let summary = ''

  for (const msg of messages) {
    const type = String(msg['@type'] ?? '')
    if (type.endsWith('MsgSend')) {
      const from = String(msg['from_address'] ?? '')
      const to = String(msg['to_address'] ?? '')
      const coins = (msg['amount'] ?? []) as { amount: string; denom: string }[]
      const amt = coins[0] ? `${formatAmount(coins[0].amount, chain)} ${chain.displayDenom}` : ''
      if (from === address) {
        direction = 'sent'
        summary = t('history.sentTo', { amt, to: shortAddr(to) })
      } else if (to === address) {
        direction = 'received'
        summary = t('history.receivedFrom', { amt, from: shortAddr(from) })
      }
      break
    }
  }

  if (!summary) {
    const type = messages[0] ? msgTypeName(String(messages[0]['@type'] ?? '')) : t('history.txDefault')
    summary = direction === 'received' ? t('history.receivedType', { type }) : type
  }

  return {
    hash: resp.txhash,
    height: Number(resp.height),
    // Stored and compared as the chain's UTC ISO string; formatted for display
    // in the viewer's own locale and zone. Showing raw UTC to everyone makes
    // people mentally convert, and they get it wrong.
    time: resp.timestamp ?? '',
    direction,
    summary,
  }
}

async function fetchTxs(address: string, t: Translate, chain: ChainInfo): Promise<TxRow[]> {
  const queries: { events: string; kind: 'sent' | 'received' }[] = [
    { events: `message.sender='${address}'`, kind: 'sent' },
    { events: `transfer.recipient='${address}'`, kind: 'received' },
  ]

  const results = await Promise.allSettled(
    queries.map(async (q) => {
      // Parameter name differs by SDK version - see txsearch.ts.
      const data = await fetchTxSearch(chain, q.events, '&order_by=2')
      if (!data) throw new Error('LCD tx search failed')
      return ((data.tx_responses ?? []) as LcdTxResponse[])
        .slice(0, MAX_ROWS)
        .map((r) => classify(r, address, q.kind, t, chain))
    }),
  )

  const ok = results.filter((r) => r.status === 'fulfilled').flatMap((r) => r.value)
  if (ok.length === 0 && results.some((r) => r.status === 'rejected')) {
    throw new Error(t('history.errLcd'))
  }

  const byHash = new Map<string, TxRow>()
  for (const row of ok) {
    const existing = byHash.get(row.hash)
    if (!existing || (existing.direction === 'other' && row.direction !== 'other')) {
      byHash.set(row.hash, row)
    }
  }
  return [...byHash.values()].sort((a, b) => b.height - a.height).slice(0, MAX_ROWS)
}

interface Chip {
  address: string
  label: string
  mine: boolean
}

export default function History() {
  const { t } = useT()
  const { wallets, active } = useWallet()
  const [address, setAddress] = useState('')
  const [loadedAddress, setLoadedAddress] = useState('')
  const [rows, setRows] = useState<TxRow[] | null>(null)
  const [filter, setFilter] = useState<Filter>('all')
  const [page, setPage] = useState(0)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [watched, setWatched] = useState<WatchedAddress[]>([])

  useEffect(() => {
    api
      .watchedList()
      .then((r) => setWatched(r.addresses))
      .catch(() => setWatched([]))
  }, [])

  const load = useCallback(
    async (addr: string) => {
      // Chain resolved from the address's own Bech32 prefix.
      const chain = chainForAddress(addr)
      if (!addr.startsWith(chain.bech32Prefix + '1')) {
        setError(
          t('history.errAddress', {
            chain: DEFAULT_CHAIN.chainName,
            prefix: DEFAULT_CHAIN.bech32Prefix,
          }),
        )
        return
      }
      setAddress(addr)
      setLoadedAddress(addr)
      setLoading(true)
      setError('')
      setRows(null)
      setFilter('all')
      setPage(0)
      try {
        setRows(await fetchTxs(addr, t, chain))
      } catch (e) {
        setError(e instanceof Error ? e.message : t('history.errLookup'))
      } finally {
        setLoading(false)
      }
    },
    [t],
  )

  // Chain of the currently-shown address, for explorer links and placeholder.
  const displayChain = chainForAddress(loadedAddress)

  // Auto-load the active wallet's history on first visit.
  useEffect(() => {
    if (active && !loadedAddress) {
      load(active.address)
    }
  }, [active, loadedAddress, load])

  // Chips: the user's own wallets first (tagged), then watched addresses.
  const chips: Chip[] = [
    ...wallets.map((w) => ({ address: w.address, label: w.name, mine: true })),
    ...watched
      .filter((w) => !wallets.some((mine) => mine.address === w.address))
      .map((w) => ({ address: w.address, label: w.label || shortAddr(w.address), mine: false })),
  ]

  const visible = (rows ?? []).filter((r) => filter === 'all' || r.direction === filter)
  const pageCount = Math.max(1, Math.ceil(visible.length / PAGE_SIZE))
  const pageRows = visible.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE)

  const dirStyle: Record<TxRow['direction'], string> = {
    sent: 'bg-red-100 text-red-700',
    received: 'bg-green-100 text-green-700',
    other: 'bg-slate-100 text-slate-600',
  }
  const dirLabel: Record<TxRow['direction'], string> = {
    sent: t('history.filterSent'),
    received: t('history.filterReceived'),
    other: t('history.filterOther'),
  }
  const filterLabel: Record<Filter, string> = {
    all: t('history.filterAll'),
    sent: t('history.filterSent'),
    received: t('history.filterReceived'),
    other: t('history.filterOther'),
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">{t('history.title')}</h1>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          load(address.trim())
        }}
        className="flex gap-2"
      >
        <input
          name="beehive-history-address"
          value={address}
          onChange={(e) => setAddress(e.target.value.trim())}
          placeholder={`${displayChain.bech32Prefix}1...`}
          aria-label={t('history.addressLabel')}
          required
          autoComplete="off"
          className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm focus:border-amber-500 focus:outline-none"
        />
        <button
          disabled={loading}
          className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-slate-900 hover:bg-amber-600 disabled:opacity-50"
        >
          {loading ? t('common.loading') : t('history.load')}
        </button>
      </form>

      {chips.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {chips.map((c) => {
            const activeChip = c.address === loadedAddress
            return (
              <button
                key={c.address}
                onClick={() => load(c.address)}
                className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs ${
                  activeChip
                    ? 'border-amber-500 bg-amber-50 font-medium text-amber-700'
                    : 'border-slate-300 bg-white text-slate-600 hover:border-amber-500 hover:text-amber-700'
                }`}
              >
                {c.mine && <Wallet className="h-3 w-3" />}
                {c.label}
                {c.mine && (
                  <span className="rounded bg-amber-100 px-1 text-[10px] text-amber-700">{t('history.mine')}</span>
                )}
              </button>
            )
          })}
        </div>
      )}

      {loadedAddress && (
        <p className="font-mono text-xs text-slate-500">{t('history.showing', { addr: shortAddr(loadedAddress) })}</p>
      )}

      {/* history.querying is a full sentence written for an inline line of
          text; as a modal heading it reads as a wall. Short title, explanation
          underneath. */}
      {loading && (
        <LoadingOverlay title={t('history.queryingTitle')} subtitle={t('history.querying')} />
      )}
      {error && <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      {rows !== null && (
        <>
          <div className="flex gap-1">
            {(['all', 'sent', 'received', 'other'] as Filter[]).map((f) => (
              <button
                key={f}
                onClick={() => {
                  setFilter(f)
                  setPage(0)
                }}
                className={`rounded-full px-3 py-1 text-xs ${
                  filter === f ? 'bg-amber-500 font-medium text-slate-900' : 'bg-slate-100 text-slate-600'
                }`}
              >
                {filterLabel[f]}
              </button>
            ))}
          </div>
          {visible.length === 0 ? (
            <p className="text-sm text-slate-500">{t('history.noTx')}</p>
          ) : (
            <>
              <ul className="divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white">
                {pageRows.map((r) => (
                  <li key={r.hash} className="px-4 py-3">
                    <div className="flex items-center justify-between gap-2">
                      <span
                        className={`rounded px-1.5 py-0.5 text-xs font-medium ${dirStyle[r.direction]}`}
                      >
                        {dirLabel[r.direction]}
                      </span>
                      <span className="text-xs text-slate-500" title={formatWhen(r.time).exact}>
                        {formatWhen(r.time).label}
                      </span>
                    </div>
                    <div className="mt-1 text-sm">{r.summary}</div>
                    <a
                      href={`${displayChain.explorerTxUrl}${r.hash}`}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 font-mono text-xs text-amber-700 hover:underline"
                    >
                      {r.hash.slice(0, 16)}...
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  </li>
                ))}
              </ul>
              {pageCount > 1 && (
                <div className="flex items-center justify-between text-sm">
                  <button
                    onClick={() => setPage((p) => Math.max(0, p - 1))}
                    disabled={page === 0}
                    className="flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-1.5 hover:border-amber-500 disabled:opacity-40"
                  >
                    <ChevronLeft className="h-4 w-4" /> {t('common.prev')}
                  </button>
                  <span className="text-xs text-slate-500">
                    {t('history.page', { page: page + 1, total: pageCount, count: visible.length })}
                  </span>
                  <button
                    onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
                    disabled={page >= pageCount - 1}
                    className="flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-1.5 hover:border-amber-500 disabled:opacity-40"
                  >
                    {t('common.next')} <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  )
}
