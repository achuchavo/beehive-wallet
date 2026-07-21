import { useEffect, useState } from 'react'
import { DEFAULT_CHAIN, formatAmount } from '../chains'
import { api, type WatchedAddress } from '../api'

interface TxRow {
  hash: string
  height: number
  time: string
  direction: 'sent' | 'received' | 'other'
  summary: string
}

type Filter = 'all' | 'sent' | 'received' | 'other'

const MAX_ROWS = 50

interface LcdTxResponse {
  txhash: string
  height: string
  timestamp: string
  tx: { body: { messages: Record<string, unknown>[] } }
}

function shortAddr(a: string) {
  return a.length > 20 ? `${a.slice(0, 12)}...${a.slice(-6)}` : a
}

function msgTypeName(type: string) {
  const last = type.split('.').pop() ?? type
  return last.replace(/^Msg/, '')
}

function classify(resp: LcdTxResponse, address: string, fromQuery: 'sent' | 'received'): TxRow {
  const chain = DEFAULT_CHAIN
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
        summary = `Sent ${amt} to ${shortAddr(to)}`
      } else if (to === address) {
        direction = 'received'
        summary = `Received ${amt} from ${shortAddr(from)}`
      }
      break
    }
  }

  if (!summary) {
    const type = messages[0] ? msgTypeName(String(messages[0]['@type'] ?? '')) : 'Transaction'
    summary = direction === 'received' ? `Received (${type})` : type
  }

  return {
    hash: resp.txhash,
    height: Number(resp.height),
    time: resp.timestamp?.replace('T', ' ').replace('Z', ' UTC') ?? '',
    direction,
    summary,
  }
}

async function fetchTxs(address: string): Promise<TxRow[]> {
  const chain = DEFAULT_CHAIN
  const queries: { events: string; kind: 'sent' | 'received' }[] = [
    { events: `message.sender='${address}'`, kind: 'sent' },
    { events: `transfer.recipient='${address}'`, kind: 'received' },
  ]

  const results = await Promise.allSettled(
    queries.map(async (q) => {
      const url = `${chain.lcd}/cosmos/tx/v1beta1/txs?events=${encodeURIComponent(q.events)}&order_by=2`
      const res = await fetch(url)
      if (!res.ok) throw new Error(`LCD returned ${res.status}`)
      const data = await res.json()
      return ((data.tx_responses ?? []) as LcdTxResponse[])
        .slice(0, MAX_ROWS)
        .map((r) => classify(r, address, q.kind))
    }),
  )

  const ok = results.filter((r) => r.status === 'fulfilled').flatMap((r) => r.value)
  if (ok.length === 0 && results.some((r) => r.status === 'rejected')) {
    throw new Error('Could not load transactions from the chain API')
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

export default function History() {
  const chain = DEFAULT_CHAIN
  const [address, setAddress] = useState('')
  const [rows, setRows] = useState<TxRow[] | null>(null)
  const [filter, setFilter] = useState<Filter>('all')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [watched, setWatched] = useState<WatchedAddress[]>([])

  useEffect(() => {
    api
      .watchedList()
      .then((r) => setWatched(r.addresses))
      .catch(() => setWatched([]))
  }, [])

  async function load(addr: string) {
    if (!addr.startsWith(chain.bech32Prefix)) {
      setError(`Enter a ${chain.chainName} address (starts with "${chain.bech32Prefix}")`)
      return
    }
    setAddress(addr)
    setLoading(true)
    setError('')
    setRows(null)
    try {
      setRows(await fetchTxs(addr))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Lookup failed')
    } finally {
      setLoading(false)
    }
  }

  const visible = (rows ?? []).filter((r) => filter === 'all' || r.direction === filter)

  const dirStyle: Record<TxRow['direction'], string> = {
    sent: 'bg-red-100 text-red-700',
    received: 'bg-green-100 text-green-700',
    other: 'bg-slate-100 text-slate-600',
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">History</h1>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          load(address.trim())
        }}
        className="flex gap-2"
      >
        <input
          value={address}
          onChange={(e) => setAddress(e.target.value.trim())}
          placeholder={`${chain.bech32Prefix}1...`}
          required
          className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm focus:border-amber-500 focus:outline-none"
        />
        <button
          disabled={loading}
          className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-white hover:bg-amber-600 disabled:opacity-50"
        >
          {loading ? 'Loading...' : 'Load'}
        </button>
      </form>

      {watched.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {watched.map((w) => (
            <button
              key={w.id}
              onClick={() => load(w.address)}
              className="rounded-full border border-slate-300 bg-white px-3 py-1 text-xs text-slate-600 hover:border-amber-500 hover:text-amber-700"
            >
              {w.label || shortAddr(w.address)}
            </button>
          ))}
        </div>
      )}

      {loading && (
        <p className="text-sm text-slate-500">
          Querying the chain... the public LCD can take up to a minute. Our own node will make
          this fast.
        </p>
      )}
      {error && <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      {rows !== null && (
        <>
          <div className="flex gap-1">
            {(['all', 'sent', 'received', 'other'] as Filter[]).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`rounded-full px-3 py-1 text-xs capitalize ${
                  filter === f ? 'bg-amber-500 font-medium text-white' : 'bg-slate-100 text-slate-600'
                }`}
              >
                {f}
              </button>
            ))}
          </div>
          {visible.length === 0 ? (
            <p className="text-sm text-slate-500">No transactions found.</p>
          ) : (
            <ul className="divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white">
              {visible.map((r) => (
                <li key={r.hash} className="px-4 py-3">
                  <div className="flex items-center justify-between gap-2">
                    <span
                      className={`rounded px-1.5 py-0.5 text-xs font-medium capitalize ${dirStyle[r.direction]}`}
                    >
                      {r.direction}
                    </span>
                    <span className="text-xs text-slate-400">{r.time}</span>
                  </div>
                  <div className="mt-1 text-sm">{r.summary}</div>
                  <a
                    href={`${chain.explorerTxUrl}${r.hash}`}
                    target="_blank"
                    rel="noreferrer"
                    className="font-mono text-xs text-amber-700 hover:underline"
                  >
                    {r.hash.slice(0, 16)}...
                  </a>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  )
}
