import { useCallback, useEffect, useState } from 'react'
import { Server, Plus, Trash2 } from 'lucide-react'
import { api, type AdminChain, type AdminEndpoint } from '../api'

const BLANK: AdminChain = {
  chain_key: '',
  chain_id: '',
  chain_name: '',
  bech32_prefix: '',
  denom: '',
  display_denom: '',
  decimals: 6,
  coin_type: 118,
  gas_price: '',
  explorer_tx_url: '',
  explorer_validator_url: '',
  beehive_validator: '',
  beehive_moniker: '',
  service_fee: '0',
  fee_collector: '',
  is_active: 1,
  sort_order: 0,
}

export default function ChainManager({ onError }: { onError: (m: string) => void }) {
  const [chains, setChains] = useState<AdminChain[]>([])
  const [endpoints, setEndpoints] = useState<AdminEndpoint[]>([])
  const [editingChain, setEditingChain] = useState<AdminChain | null>(null)
  const [adding, setAdding] = useState(false)

  const load = useCallback(async () => {
    try {
      const d = await api.adminChains()
      setChains(d.chains)
      setEndpoints(d.endpoints)
      onError('')
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Could not load chains')
    }
  }, [onError])

  useEffect(() => {
    load()
  }, [load])

  async function saveChain(chain: AdminChain) {
    try {
      await api.adminChainSave(chain)
      setEditingChain(null)
      setAdding(false)
      await load()
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Save failed')
    }
  }

  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 font-medium">
          <Server className="h-4 w-4 text-slate-400" /> Chains
        </h2>
        <button
          onClick={() => {
            setAdding(true)
            setEditingChain({ ...BLANK })
          }}
          className="flex items-center gap-1 rounded-lg bg-amber-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-600"
        >
          <Plus className="h-4 w-4" /> Add chain
        </button>
      </div>

      {adding && editingChain && (
        <ChainForm
          chain={editingChain}
          isNew
          onSave={saveChain}
          onCancel={() => {
            setAdding(false)
            setEditingChain(null)
          }}
        />
      )}

      <div className="space-y-2">
        {chains.map((c) => (
          <div key={c.chain_key} className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="flex items-center justify-between gap-2">
              <div>
                <div className="flex items-center gap-2 text-sm font-medium">
                  {c.chain_name}
                  <span className="font-mono text-xs text-slate-400">{c.chain_key}</span>
                  {c.is_active !== 1 && (
                    <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-500">
                      inactive
                    </span>
                  )}
                </div>
                <div className="text-xs text-slate-500">
                  {c.chain_id} · {c.display_denom} · fee{' '}
                  {c.service_fee === '0' ? 'off' : `${c.service_fee} ${c.denom}`}
                </div>
              </div>
              <button
                onClick={() => setEditingChain(editingChain?.chain_key === c.chain_key ? null : c)}
                className="shrink-0 text-xs text-amber-700 hover:underline"
              >
                {editingChain?.chain_key === c.chain_key && !adding ? 'Close' : 'Edit'}
              </button>
            </div>

            {editingChain?.chain_key === c.chain_key && !adding && (
              <div className="mt-3">
                <ChainForm chain={editingChain} onSave={saveChain} onCancel={() => setEditingChain(null)} />
              </div>
            )}

            <EndpointList
              chainKey={c.chain_key}
              endpoints={endpoints.filter((e) => e.chain_key === c.chain_key)}
              onChanged={load}
              onError={onError}
            />
          </div>
        ))}
      </div>
    </section>
  )
}

function ChainForm({
  chain,
  isNew,
  onSave,
  onCancel,
}: {
  chain: AdminChain
  isNew?: boolean
  onSave: (c: AdminChain) => void
  onCancel: () => void
}) {
  const [form, setForm] = useState<AdminChain>(chain)
  const set = (k: keyof AdminChain, v: string | number) => setForm({ ...form, [k]: v })

  const field = (label: string, key: keyof AdminChain, mono = false) => (
    <label className="block">
      <span className="text-xs text-slate-500">{label}</span>
      <input
        value={String(form[key] ?? '')}
        onChange={(e) => set(key, e.target.value)}
        className={`w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm focus:border-amber-500 focus:outline-none ${mono ? 'font-mono' : ''}`}
      />
    </label>
  )

  return (
    <div className="space-y-2 rounded-lg bg-slate-50 p-3">
      <div className="grid grid-cols-2 gap-2">
        <label className="block">
          <span className="text-xs text-slate-500">Chain key</span>
          <input
            value={form.chain_key}
            disabled={!isNew}
            onChange={(e) => set('chain_key', e.target.value.toLowerCase())}
            placeholder="rizon"
            className="w-full rounded-lg border border-slate-300 px-2 py-1.5 font-mono text-sm focus:border-amber-500 focus:outline-none disabled:bg-slate-100"
          />
        </label>
        {field('Chain ID', 'chain_id')}
        {field('Name', 'chain_name')}
        {field('Bech32 prefix', 'bech32_prefix', true)}
        {field('Base denom', 'denom', true)}
        {field('Display denom', 'display_denom')}
        {field('Decimals', 'decimals')}
        {field('Coin type', 'coin_type')}
        {field('Gas price', 'gas_price', true)}
        {field('Beehive validator', 'beehive_validator', true)}
        {field('Beehive moniker', 'beehive_moniker')}
        {field('Service fee (base)', 'service_fee', true)}
        {field('Fee collector', 'fee_collector', true)}
        {field('Explorer tx URL', 'explorer_tx_url')}
        {field('Explorer validator URL', 'explorer_validator_url')}
        {field('Sort order', 'sort_order')}
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={form.is_active === 1}
          onChange={(e) => set('is_active', e.target.checked ? 1 : 0)}
        />
        Active (visible to users)
      </label>
      <div className="flex gap-2">
        <button
          onClick={() => onSave(form)}
          className="rounded-lg bg-amber-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-600"
        >
          Save chain
        </button>
        <button onClick={onCancel} className="px-3 py-1.5 text-sm text-slate-500 hover:underline">
          Cancel
        </button>
      </div>
    </div>
  )
}

function EndpointList({
  chainKey,
  endpoints,
  onChanged,
  onError,
}: {
  chainKey: string
  endpoints: AdminEndpoint[]
  onChanged: () => void
  onError: (m: string) => void
}) {
  const [kind, setKind] = useState('lcd')
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)

  async function add() {
    setBusy(true)
    onError('')
    try {
      await api.adminEndpointSave({ chain_key: chainKey, kind, url, priority: endpoints.length, is_active: 1 })
      setUrl('')
      await onChanged()
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Could not add endpoint')
    } finally {
      setBusy(false)
    }
  }

  async function toggle(ep: AdminEndpoint) {
    await api.adminEndpointSave({ ...ep, is_active: ep.is_active === 1 ? 0 : 1 })
    onChanged()
  }

  async function remove(id: number) {
    await api.adminEndpointDelete(id)
    onChanged()
  }

  return (
    <div className="mt-3 space-y-2 border-t border-slate-100 pt-3">
      <div className="text-xs font-medium text-slate-500">
        Endpoints (tried in order; failover on outage)
      </div>
      {endpoints.length === 0 && <div className="text-xs text-slate-400">No endpoints yet.</div>}
      {endpoints.map((ep) => (
        <div key={ep.id} className="flex items-center gap-2 text-xs">
          <span className="w-8 shrink-0 rounded bg-slate-100 px-1 py-0.5 text-center font-medium uppercase text-slate-600">
            {ep.kind}
          </span>
          <span className={`flex-1 truncate font-mono ${ep.is_active === 1 ? '' : 'text-slate-400 line-through'}`}>
            {ep.url}
          </span>
          <button onClick={() => toggle(ep)} className="text-amber-700 hover:underline">
            {ep.is_active === 1 ? 'Disable' : 'Enable'}
          </button>
          <button onClick={() => remove(ep.id)} className="text-red-600 hover:underline">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
      <div className="flex gap-1.5">
        <select
          value={kind}
          onChange={(e) => setKind(e.target.value)}
          className="rounded-lg border border-slate-300 px-2 text-xs"
        >
          <option value="lcd">LCD</option>
          <option value="rpc">RPC</option>
        </select>
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value.trim())}
          placeholder="https://api.example.org"
          className="flex-1 rounded-lg border border-slate-300 px-2 py-1.5 font-mono text-xs focus:border-amber-500 focus:outline-none"
        />
        <button
          onClick={add}
          disabled={busy || !url}
          className="rounded-lg bg-amber-500 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-amber-600 disabled:opacity-50"
        >
          Add
        </button>
      </div>
    </div>
  )
}
