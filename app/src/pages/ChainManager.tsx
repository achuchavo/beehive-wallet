import { useCallback, useEffect, useState } from 'react'
import { Server, Plus, Trash2, Settings2 } from 'lucide-react'
import { api, type AdminChain, type AdminEndpoint, type AdminFreeValidator } from '../api'
import Modal from '../components/Modal'
import HelpTip from '../components/HelpTip'
import OptionPicker from '../components/OptionPicker'

const FREE_HELP =
  'Validators you offer for free staking (no service fee) to people using the wallet. They are pinned and badged Free on the staking list.'

const LCD_HELP =
  'LCD (REST API, usually port 1317): the HTTP endpoint the app reads balances, staking, and history from.'
const RPC_HELP =
  'RPC (Tendermint, usually port 26657): the endpoint used to broadcast signed transactions.'

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
  coingecko_id: '',
  service_fee: '0',
  fee_collector: '',
  is_active: 1,
  sort_order: 0,
}

export default function ChainManager({ onError }: { onError: (m: string) => void }) {
  const [chains, setChains] = useState<AdminChain[]>([])
  const [endpoints, setEndpoints] = useState<AdminEndpoint[]>([])
  const [freeValidators, setFreeValidators] = useState<AdminFreeValidator[]>([])
  // The chain open in the manage modal: an existing chain, a blank new one, or null.
  const [managing, setManaging] = useState<AdminChain | null>(null)
  const [isNew, setIsNew] = useState(false)

  const load = useCallback(async () => {
    try {
      const d = await api.adminChains()
      setChains(d.chains)
      setEndpoints(d.endpoints)
      setFreeValidators(d.free_validators)
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
      await load()
      // Keep the modal open on an existing chain (so endpoints stay reachable);
      // close it after creating a new one.
      if (isNew) setManaging(null)
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Save failed')
    }
  }

  function endpointsFor(key: string) {
    return endpoints.filter((e) => e.chain_key === key)
  }

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 font-medium">
          <Server className="h-4 w-4 text-slate-500" /> Chains
        </h2>
        <button
          onClick={() => {
            setManaging({ ...BLANK })
            setIsNew(true)
          }}
          className="flex items-center gap-1 rounded-lg bg-amber-500 px-3 py-1.5 text-sm font-medium text-slate-900 hover:bg-amber-600"
        >
          <Plus className="h-4 w-4" /> Add chain
        </button>
      </div>

      <div className="divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white">
        {chains.map((c) => {
          const eps = endpointsFor(c.chain_key)
          const lcd = eps.filter((e) => e.kind === 'lcd').length
          const rpc = eps.filter((e) => e.kind === 'rpc').length
          return (
            <div key={c.chain_key} className="flex items-center justify-between gap-2 px-4 py-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-sm font-medium">
                  {c.chain_name}
                  <span className="font-mono text-xs text-slate-500">{c.chain_key}</span>
                  {c.is_active !== 1 && (
                    <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-500">
                      inactive
                    </span>
                  )}
                </div>
                <div className="text-xs text-slate-500">
                  {c.display_denom} · {lcd} LCD · {rpc} RPC ·{' '}
                  {c.service_fee === '0' ? 'no fee' : `fee ${c.service_fee} ${c.denom}`}
                </div>
              </div>
              <button
                onClick={() => {
                  setManaging(c)
                  setIsNew(false)
                }}
                className="flex shrink-0 items-center gap-1 rounded-lg border border-slate-300 px-2.5 py-1 text-xs hover:border-amber-500"
              >
                <Settings2 className="h-3.5 w-3.5" /> Manage
              </button>
            </div>
          )
        })}
        {chains.length === 0 && (
          <p className="px-4 py-6 text-center text-sm text-slate-500">No chains yet.</p>
        )}
      </div>

      {managing && (
        <Modal
          title={isNew ? 'Add chain' : `Manage ${managing.chain_name}`}
          onClose={() => setManaging(null)}
          wide
        >
          <div className="space-y-5">
            <ChainForm chain={managing} isNew={isNew} onSave={saveChain} />
            {!isNew && (
              <>
                <EndpointList
                  chainKey={managing.chain_key}
                  endpoints={endpointsFor(managing.chain_key)}
                  onChanged={load}
                  onError={onError}
                />
                <FreeValidatorList
                  chainKey={managing.chain_key}
                  freeValidators={freeValidators.filter((f) => f.chain_key === managing.chain_key)}
                  onChanged={load}
                  onError={onError}
                />
              </>
            )}
          </div>
        </Modal>
      )}
    </section>
  )
}

function ChainForm({
  chain,
  isNew,
  onSave,
}: {
  chain: AdminChain
  isNew?: boolean
  onSave: (c: AdminChain) => void
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
    <div className="space-y-3">
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
        {field('CoinGecko id (price)', 'coingecko_id', true)}
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
      <button
        onClick={() => onSave(form)}
        className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-slate-900 hover:bg-amber-600"
      >
        Save chain details
      </button>
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
    <div className="space-y-2 border-t border-slate-200 pt-4">
      <div className="flex items-center gap-1.5 text-sm font-medium">
        Endpoints
        <span className="font-normal text-slate-500">(tried in order; failover on outage)</span>
      </div>
      <div className="flex gap-4 text-xs text-slate-500">
        <span className="flex items-center gap-1">LCD <HelpTip text={LCD_HELP} /></span>
        <span className="flex items-center gap-1">RPC <HelpTip text={RPC_HELP} /></span>
      </div>
      {endpoints.length === 0 && <div className="text-xs text-slate-500">No endpoints yet.</div>}
      {endpoints.map((ep) => (
        <div key={ep.id} className="flex items-center gap-2 text-xs">
          <span className="w-9 shrink-0 rounded bg-slate-100 px-1 py-0.5 text-center font-medium uppercase text-slate-600">
            {ep.kind}
          </span>
          <span className={`flex-1 truncate font-mono ${ep.is_active === 1 ? '' : 'text-slate-500 line-through'}`}>
            {ep.url}
          </span>
          <button onClick={() => toggle(ep)} className="text-amber-700 hover:underline">
            {ep.is_active === 1 ? 'Disable' : 'Enable'}
          </button>
          <button onClick={() => remove(ep.id)} aria-label="Delete endpoint" className="text-red-600 hover:underline">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
      <div className="flex gap-1.5">
        <OptionPicker
          label="Endpoint kind"
          value={kind}
          onChange={setKind}
          className="text-xs"
          options={[
            { value: 'lcd', label: 'LCD' },
            { value: 'rpc', label: 'RPC' },
          ]}
        />
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value.trim())}
          placeholder="https://api.example.org"
          className="flex-1 rounded-lg border border-slate-300 px-2 py-1.5 font-mono text-xs focus:border-amber-500 focus:outline-none"
        />
        <button
          onClick={add}
          disabled={busy || !url}
          className="rounded-lg bg-amber-500 px-2.5 py-1.5 text-xs font-medium text-slate-900 hover:bg-amber-600 disabled:opacity-50"
        >
          Add
        </button>
      </div>
    </div>
  )
}

function FreeValidatorList({
  chainKey,
  freeValidators,
  onChanged,
  onError,
}: {
  chainKey: string
  freeValidators: AdminFreeValidator[]
  onChanged: () => void
  onError: (m: string) => void
}) {
  const [valoper, setValoper] = useState('')
  const [busy, setBusy] = useState(false)

  async function add() {
    setBusy(true)
    onError('')
    try {
      await api.adminFreeValidatorAdd(chainKey, valoper)
      setValoper('')
      await onChanged()
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Could not add validator')
    } finally {
      setBusy(false)
    }
  }

  async function remove(id: number) {
    await api.adminFreeValidatorRemove(id)
    onChanged()
  }

  return (
    <div className="space-y-2 border-t border-slate-200 pt-4">
      <div className="flex items-center gap-1.5 text-sm font-medium">
        Free-staking validators <HelpTip text={FREE_HELP} />
      </div>
      {freeValidators.length === 0 && (
        <div className="text-xs text-slate-500">None yet - no validators are free.</div>
      )}
      {freeValidators.map((f) => (
        <div key={f.id} className="flex items-center gap-2 text-xs">
          <span className="flex-1 truncate font-mono">{f.valoper}</span>
          <button onClick={() => remove(f.id)} aria-label="Remove" className="text-red-600 hover:underline">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
      <div className="flex gap-1.5">
        <input
          value={valoper}
          onChange={(e) => setValoper(e.target.value.trim())}
          placeholder="validator (valoper1...) address"
          className="flex-1 rounded-lg border border-slate-300 px-2 py-1.5 font-mono text-xs focus:border-amber-500 focus:outline-none"
        />
        <button
          onClick={add}
          disabled={busy || !valoper}
          className="rounded-lg bg-amber-500 px-2.5 py-1.5 text-xs font-medium text-slate-900 hover:bg-amber-600 disabled:opacity-50"
        >
          Add
        </button>
      </div>
    </div>
  )
}
