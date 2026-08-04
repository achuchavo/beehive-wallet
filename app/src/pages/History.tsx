import { useCallback, useEffect, useState } from 'react'
import {
  ArrowDownLeft,
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Repeat,
  Wallet,
} from 'lucide-react'
import { DEFAULT_CHAIN, chainForAddress, formatAmount, type ChainInfo } from '../chains'
import { api, type WatchedAddress } from '../api'
import { useWallet } from '../wallet/WalletContext'
import { fetchTxSearch } from '../wallet/txsearch'
import { isValidAccountAddress } from '../wallet/address'
import { maskAmount, usePrivacyMode } from '../privacyMode'
import Card from '../components/Card'
import Collapsible from '../components/Collapsible'
import CopyAddress from '../components/CopyAddress'
import LoadingOverlay from '../components/LoadingOverlay'
import Modal from '../components/Modal'
import PageHeader from '../components/PageHeader'
import PrivacyToggle from '../components/PrivacyToggle'
import { useT } from '../i18n/I18nContext'

type Translate = (key: string, vars?: Record<string, string | number>) => string

interface TxRow {
  hash: string
  height: number
  time: string
  direction: 'sent' | 'received' | 'other'
  /** Base-unit amount moved, or '' when this message type does not carry one. */
  amount: string
  /** The other party in a transfer. Empty for non-transfer messages. */
  counterparty: string
  /** Base-unit network fee, or '' when the response did not include one. */
  fee: string
  memo: string
  /** Message type name, e.g. "Delegate" - shown when there is no amount. */
  type: string
}

type Filter = 'all' | 'sent' | 'received' | 'other'

const MAX_ROWS = 50
const PAGE_SIZE = 10

interface LcdTxResponse {
  txhash: string
  height: string
  timestamp: string
  tx: {
    body: { messages: Record<string, unknown>[]; memo?: string }
    auth_info?: { fee?: { amount?: { denom: string; amount: string }[] } }
  }
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

/** The fee actually paid, in the chain's own denom. Base units, never a float. */
function feeOf(resp: LcdTxResponse, chain: ChainInfo): string {
  const coins = resp.tx?.auth_info?.fee?.amount ?? []
  return coins.find((c) => c.denom === chain.denom)?.amount ?? ''
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
  let amount = ''
  let counterparty = ''

  for (const msg of messages) {
    const type = String(msg['@type'] ?? '')
    if (type.endsWith('MsgSend')) {
      const from = String(msg['from_address'] ?? '')
      const to = String(msg['to_address'] ?? '')
      const coins = (msg['amount'] ?? []) as { amount: string; denom: string }[]
      // Base units all the way through - the value is only ever formatted for
      // display, never parsed into a number.
      const coin = coins.find((c) => c.denom === chain.denom) ?? coins[0]
      if (from === address) {
        direction = 'sent'
        counterparty = to
        amount = coin?.amount ?? ''
      } else if (to === address) {
        direction = 'received'
        counterparty = from
        amount = coin?.amount ?? ''
      }
      break
    }
  }

  return {
    hash: resp.txhash,
    height: Number(resp.height),
    // Stored and compared as the chain's UTC ISO string; formatted for display
    // in the viewer's own locale and zone. Showing raw UTC to everyone makes
    // people mentally convert, and they get it wrong.
    time: resp.timestamp ?? '',
    direction,
    amount,
    counterparty,
    fee: feeOf(resp, chain),
    memo: resp.tx?.body?.memo ?? '',
    type: messages[0] ? msgTypeName(String(messages[0]['@type'] ?? '')) : t('history.txDefault'),
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

const DIR_ICON: Record<TxRow['direction'], typeof ArrowDownLeft> = {
  received: ArrowDownLeft,
  sent: ArrowUpRight,
  other: Repeat,
}

// Muted on purpose. A statement earns its calm by letting the amounts carry the
// meaning, not by colour-coding every row.
const DIR_TONE: Record<TxRow['direction'], string> = {
  received: 'bg-green-50 text-green-700',
  sent: 'bg-slate-100 text-slate-600',
  other: 'bg-slate-100 text-slate-500',
}

export default function History() {
  const { t } = useT()
  const { wallets, active } = useWallet()
  const hidden = usePrivacyMode()
  const [address, setAddress] = useState('')
  const [loadedAddress, setLoadedAddress] = useState('')
  const [rows, setRows] = useState<TxRow[] | null>(null)
  const [filter, setFilter] = useState<Filter>('all')
  const [page, setPage] = useState(0)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [watched, setWatched] = useState<WatchedAddress[]>([])
  // The row whose detail dialog is open. Held as the row itself so the dialog
  // keeps rendering the transaction the user opened even if the list reloads.
  const [detail, setDetail] = useState<TxRow | null>(null)

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
      // Full Bech32 validation, not a prefix check. A mistyped address passes a
      // startsWith test, finds nothing, and is then reported as "No
      // transactions found" - an empty statement presented as fact about an
      // address the user never asked about.
      if (!isValidAccountAddress(addr, chain.bech32Prefix)) {
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

  /**
   * Signed, grouped, and masked when privacy mode is on. Empty for message
   * types that move nothing - formatAmount('') would render a confident "0".
   */
  function amountText(r: TxRow): string {
    if (!r.amount) return ''
    const formatted = maskAmount(formatAmount(r.amount, displayChain), hidden)
    return `${r.direction === 'sent' ? '−' : '+'}${formatted}`
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('history.title')}
        // The denom rides here once, instead of being printed under all ten
        // rows - it cannot vary within a loaded statement.
        subtitle={
          loadedAddress ? `${shortAddr(loadedAddress)} · ${displayChain.displayDenom}` : undefined
        }
        help={t('help.history')}
      >
        <PrivacyToggle />
      </PageHeader>

      {chips.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {chips.map((c) => {
            const activeChip = c.address === loadedAddress
            return (
              <button
                key={c.address}
                onClick={() => load(c.address)}
                aria-pressed={activeChip}
                className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs transition-colors ${
                  activeChip
                    ? 'bg-amber-100 font-medium text-amber-900'
                    : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:text-amber-700'
                }`}
              >
                {c.mine && <Wallet className="h-3 w-3" strokeWidth={1.8} />}
                {c.label}
              </button>
            )
          })}
        </div>
      )}

      {/* Looking up someone else's address is the secondary use of this page -
          its own comment always said so - so the form folds away instead of
          occupying a full row above the statement on every visit. */}
      <Collapsible title={t('history.addressLabel')}>
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
            className="w-full rounded-xl bg-white px-3.5 py-2.5 font-mono text-sm text-slate-700 ring-1 ring-slate-200 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-500"
          />
          <button
            disabled={loading}
            className="shrink-0 rounded-xl px-4 py-2.5 text-sm font-medium text-slate-600 ring-1 ring-slate-200 hover:text-amber-700 disabled:opacity-50"
          >
            {loading ? t('common.loading') : t('history.load')}
          </button>
        </form>
      </Collapsible>

      {/* history.querying is a full sentence written for an inline line of
          text; as a modal heading it reads as a wall. Short title, explanation
          underneath. */}
      {loading && <LoadingOverlay title={t('history.queryingTitle')} subtitle={t('history.querying')} />}
      {error && <div className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      {rows !== null && (
        <div className="space-y-3">
          <div className="flex gap-1">
            {(['all', 'sent', 'received', 'other'] as Filter[]).map((f) => (
              <button
                key={f}
                onClick={() => {
                  setFilter(f)
                  setPage(0)
                }}
                // A selected filter is conveyed by colour alone otherwise;
                // aria-pressed carries the same state non-visually.
                aria-pressed={filter === f}
                className={`rounded-full px-3 py-1 text-xs transition-colors ${
                  filter === f
                    ? 'bg-amber-100 font-medium text-amber-900'
                    : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                {filterLabel[f]}
              </button>
            ))}
          </div>

          {visible.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-500">{t('history.noTx')}</p>
          ) : (
            <>
              {/* A statement: direction, amount, date. Everything else - the
                  counterparty, the hash, the fee, the memo - lives in the
                  detail dialog, one tap away. */}
              <Card padded={false}>
                <ul className="divide-y divide-slate-100">
                  {pageRows.map((r) => {
                    const Icon = DIR_ICON[r.direction]
                    const when = formatWhen(r.time)
                    return (
                      <li key={r.hash}>
                        <button
                          type="button"
                          onClick={() => setDetail(r)}
                          aria-label={t('history.openDetail', {
                            label: r.amount ? dirLabel[r.direction] : r.type,
                            when: when.label,
                          })}
                          className="flex w-full items-center gap-3.5 px-4 py-3.5 text-left transition-colors hover:bg-slate-50/80"
                        >
                          <span
                            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${DIR_TONE[r.direction]}`}
                          >
                            <Icon className="h-4 w-4" strokeWidth={2} />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium text-slate-900">
                              {r.amount ? dirLabel[r.direction] : r.type}
                            </span>
                            <span className="block text-xs text-slate-500" title={when.exact}>
                              {when.label}
                            </span>
                          </span>
                          {r.amount && (
                            <span className="shrink-0 text-right">
                              <span
                                className={`block text-[15px] font-semibold tabular-nums ${
                                  r.direction === 'received' ? 'text-green-700' : 'text-slate-900'
                                }`}
                              >
                                {amountText(r)}
                              </span>
                            </span>
                          )}
                          <ChevronRight className="h-4 w-4 shrink-0 text-slate-300" />
                        </button>
                      </li>
                    )
                  })}
                </ul>
              </Card>

              {pageCount > 1 && (
                <div className="flex items-center justify-between text-sm">
                  <button
                    onClick={() => setPage((p) => Math.max(0, p - 1))}
                    disabled={page === 0}
                    className="flex items-center gap-1 rounded-xl px-3 py-1.5 text-slate-600 ring-1 ring-slate-200 hover:text-amber-700 disabled:opacity-40"
                  >
                    <ChevronLeft className="h-4 w-4" /> {t('common.prev')}
                  </button>
                  <span className="text-xs text-slate-500">
                    {t('history.page', { page: page + 1, total: pageCount, count: visible.length })}
                  </span>
                  <button
                    onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
                    disabled={page >= pageCount - 1}
                    className="flex items-center gap-1 rounded-xl px-3 py-1.5 text-slate-600 ring-1 ring-slate-200 hover:text-amber-700 disabled:opacity-40"
                  >
                    {t('common.next')} <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {detail && (
        <TxDetail
          row={detail}
          chain={displayChain}
          hidden={hidden}
          amountText={amountText(detail)}
          dirLabel={dirLabel[detail.direction]}
          onClose={() => setDetail(null)}
        />
      )}
    </div>
  )
}

function TxDetail({
  row,
  chain,
  hidden,
  amountText,
  dirLabel,
  onClose,
}: {
  row: TxRow
  chain: ChainInfo
  hidden: boolean
  amountText: string
  dirLabel: string
  onClose: () => void
}) {
  const { t } = useT()
  const when = formatWhen(row.time)

  return (
    <Modal title={t('history.detailTitle')} onClose={onClose}>
      <div className="space-y-5">
        {/* The amount is the headline here too, so the dialog answers the
            question the row was already asking. */}
        <div className="text-center">
          <div className="text-xs uppercase tracking-wide text-slate-500">
            {row.amount ? dirLabel : row.type}
          </div>
          {row.amount && (
            <div className="mt-1 text-3xl font-semibold tabular-nums text-slate-900">
              {amountText}{' '}
              <span className="text-base font-medium text-slate-500">{chain.displayDenom}</span>
            </div>
          )}
        </div>

        <dl className="divide-y divide-slate-100 text-sm">
          <Detail label={t('history.detailWhen')}>
            <span title={when.exact}>{when.label}</span>
          </Detail>
          {row.counterparty && (
            <Detail
              label={row.direction === 'sent' ? t('history.detailTo') : t('history.detailFrom')}
            >
              <CopyAddress
                address={row.counterparty}
                display={shortAddr(row.counterparty)}
                className="max-w-full text-xs text-slate-700"
              />
            </Detail>
          )}
          {row.fee && (
            <Detail label={t('history.detailFee')}>
              {/* The fee is money too, so it honours privacy mode. */}
              {maskAmount(formatAmount(row.fee, chain), hidden)} {chain.displayDenom}
            </Detail>
          )}
          <Detail label={t('history.detailMemo')}>
            {row.memo ? (
              <span className="break-words">{row.memo}</span>
            ) : (
              <span className="text-slate-400">{t('history.detailNoMemo')}</span>
            )}
          </Detail>
          <Detail label={t('history.detailHash')}>
            <CopyAddress
              address={row.hash}
              display={`${row.hash.slice(0, 12)}...${row.hash.slice(-8)}`}
              className="max-w-full text-xs text-slate-700"
            />
          </Detail>
          <Detail label={t('history.detailBlock')}>
            <span className="tabular-nums">{row.height.toLocaleString()}</span>
          </Detail>
        </dl>

        <a
          href={`${chain.explorerTxUrl}${row.hash}`}
          target="_blank"
          rel="noreferrer noopener"
          className="flex items-center justify-center gap-1.5 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-slate-800"
        >
          {t('history.viewOnExplorer')} <ExternalLink className="h-3.5 w-3.5" />
        </a>
      </div>
    </Modal>
  )
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2.5">
      <dt className="shrink-0 text-slate-500">{label}</dt>
      <dd className="min-w-0 text-right text-slate-900">{children}</dd>
    </div>
  )
}
