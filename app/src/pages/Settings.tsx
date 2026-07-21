import { useState } from 'react'
import { Plus, Import, TriangleAlert, Copy, Check } from 'lucide-react'
import { DEFAULT_CHAIN } from '../chains'
import { useWallet, generateMnemonic } from '../wallet/WalletContext'

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false)
  async function copy() {
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }
  return (
    <button
      type="button"
      onClick={copy}
      className="flex items-center gap-1 text-xs text-amber-700 hover:underline"
    >
      {copied ? <Check className="h-3.5 w-3.5 text-green-600" /> : <Copy className="h-3.5 w-3.5" />}
      {copied ? 'Copied' : label}
    </button>
  )
}

type Mode = 'list' | 'create' | 'import'

export default function Settings() {
  const [mode, setMode] = useState<Mode>('list')

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Settings</h1>
      {mode === 'list' && <WalletList onCreate={() => setMode('create')} onImport={() => setMode('import')} />}
      {mode === 'create' && <CreateWallet onDone={() => setMode('list')} />}
      {mode === 'import' && <ImportWallet onDone={() => setMode('list')} />}
    </div>
  )
}

function WalletList({ onCreate, onImport }: { onCreate: () => void; onImport: () => void }) {
  const { wallets, active, setActive, removeWallet, revealSecret } = useWallet()
  const [revealFor, setRevealFor] = useState<string | null>(null)
  const [password, setPassword] = useState('')
  const [secret, setSecret] = useState('')
  const [error, setError] = useState('')

  async function reveal(address: string) {
    setError('')
    try {
      const r = await revealSecret(address, password)
      setSecret(r.secret)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed')
    }
  }

  function closeReveal() {
    setRevealFor(null)
    setPassword('')
    setSecret('')
    setError('')
  }

  function remove(address: string) {
    if (
      window.confirm(
        'Remove this wallet from this browser? Make sure you have the seed phrase written down - without it the wallet cannot be restored.',
      )
    ) {
      removeWallet(address)
    }
  }

  return (
    <div className="space-y-4">
      <section className="space-y-2">
        <h2 className="font-medium">Your wallets</h2>
        <p className="text-sm text-slate-500">
          Wallets live only in this browser, encrypted with your password. The Beehive server
          never sees your seed phrase or keys.
        </p>
        {wallets.length === 0 ? (
          <p className="text-sm text-slate-500">No wallets yet.</p>
        ) : (
          <ul className="divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white">
            {wallets.map((w) => (
              <li key={w.address} className="space-y-2 px-4 py-3">
                <div className="flex items-center gap-3">
                  <input
                    type="radio"
                    name="active"
                    checked={active?.address === w.address}
                    onChange={() => setActive(w.address)}
                    title="Active wallet"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium">{w.name}</div>
                    <div className="truncate font-mono text-xs text-slate-400">{w.address}</div>
                  </div>
                  <button
                    onClick={() => (revealFor === w.address ? closeReveal() : setRevealFor(w.address))}
                    className="text-xs text-amber-700 hover:underline"
                  >
                    {revealFor === w.address
                      ? 'Close'
                      : w.kind === 'privkey'
                        ? 'Show key'
                        : 'Show seed'}
                  </button>
                  <button onClick={() => remove(w.address)} className="text-xs text-red-600 hover:underline">
                    Remove
                  </button>
                </div>
                {revealFor === w.address && (
                  <div className="space-y-2 rounded-lg bg-slate-50 p-3">
                    {secret ? (
                      <>
                        <div className="flex items-center justify-between">
                          <p className="flex items-center gap-1.5 text-xs font-medium text-red-600">
                            <TriangleAlert className="h-3.5 w-3.5 shrink-0" />
                            Never share this. Anyone with it controls the wallet.
                          </p>
                          <CopyButton text={secret} label={w.kind === 'privkey' ? 'Copy key' : 'Copy seed'} />
                        </div>
                        <p className="break-all rounded bg-white p-2 font-mono text-sm">{secret}</p>
                      </>
                    ) : (
                      <div className="flex gap-2">
                        <input
                          type="password"
                          name="beehive-reveal-password"
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          placeholder="Wallet password"
                          autoComplete="new-password"
                          className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-amber-500 focus:outline-none"
                        />
                        <button
                          onClick={() => reveal(w.address)}
                          className="rounded-lg bg-amber-500 px-3 py-2 text-sm font-medium text-white hover:bg-amber-600"
                        >
                          Reveal
                        </button>
                      </div>
                    )}
                    {error && <p className="text-xs text-red-600">{error}</p>}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
      <div className="flex gap-2">
        <button
          onClick={onCreate}
          className="flex items-center gap-2 rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-white hover:bg-amber-600"
        >
          <Plus className="h-4 w-4" /> Create new wallet
        </button>
        <button
          onClick={onImport}
          className="flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm hover:border-amber-500"
        >
          <Import className="h-4 w-4" /> Import wallet
        </button>
      </div>
    </div>
  )
}

function PasswordFields({
  password,
  confirm,
  setPassword,
  setConfirm,
}: {
  password: string
  confirm: string
  setPassword: (v: string) => void
  setConfirm: (v: string) => void
}) {
  return (
    <>
      <input
        type="password"
        name="beehive-new-password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="Wallet password (10+ characters)"
        minLength={10}
        required
        autoComplete="new-password"
        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-amber-500 focus:outline-none"
      />
      <input
        type="password"
        name="beehive-confirm-password"
        value={confirm}
        onChange={(e) => setConfirm(e.target.value)}
        placeholder="Repeat password"
        required
        autoComplete="new-password"
        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-amber-500 focus:outline-none"
      />
    </>
  )
}

function CreateWallet({ onDone }: { onDone: () => void }) {
  const chain = DEFAULT_CHAIN
  const { addWallet } = useWallet()
  const [name, setName] = useState('')
  const [mnemonic, setMnemonic] = useState('')
  const [confirmedSaved, setConfirmedSaved] = useState(false)
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function start() {
    setMnemonic(await generateMnemonic(chain))
  }

  async function finish(e: React.FormEvent) {
    e.preventDefault()
    if (password !== confirm) {
      setError('Passwords do not match')
      return
    }
    setBusy(true)
    setError('')
    try {
      await addWallet(name, mnemonic, password, chain)
      onDone()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="max-w-lg space-y-4">
      <h2 className="font-medium">Create new wallet</h2>
      {!mnemonic ? (
        <>
          <p className="text-sm text-slate-500">
            A new 24-word seed phrase will be generated in your browser. You must write it down
            on paper and keep it safe - it is the only way to recover the wallet.
          </p>
          <button
            onClick={start}
            className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-white hover:bg-amber-600"
          >
            Generate seed phrase
          </button>
        </>
      ) : (
        <form onSubmit={finish} className="space-y-3">
          <div className="rounded-lg border border-amber-300 bg-amber-50 p-3">
            <div className="mb-2 flex items-start justify-between gap-2">
              <p className="flex items-start gap-1.5 text-xs font-medium text-red-600">
                <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                Write these 24 words down on paper, in order. Never store them digitally or share
                them. Anyone with these words controls your funds.
              </p>
              <CopyButton text={mnemonic} label="Copy" />
            </div>
            <p className="font-mono text-sm leading-relaxed">{mnemonic}</p>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={confirmedSaved}
              onChange={(e) => setConfirmedSaved(e.target.checked)}
              required
            />
            I wrote the seed phrase down on paper
          </label>
          <input
            name="beehive-create-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Wallet name (e.g. Main wallet)"
            autoComplete="off"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-amber-500 focus:outline-none"
          />
          <PasswordFields
            password={password}
            confirm={confirm}
            setPassword={setPassword}
            setConfirm={setConfirm}
          />
          {error && <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
          <div className="flex gap-2">
            <button
              disabled={busy || !confirmedSaved}
              className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-white hover:bg-amber-600 disabled:opacity-50"
            >
              {busy ? 'Encrypting...' : 'Save wallet'}
            </button>
            <button type="button" onClick={onDone} className="px-3 py-2 text-sm text-slate-500 hover:underline">
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  )
}

function ImportWallet({ onDone }: { onDone: () => void }) {
  const chain = DEFAULT_CHAIN
  const { addWallet } = useWallet()
  const [kind, setKind] = useState<'mnemonic' | 'privkey'>('mnemonic')
  const [name, setName] = useState('')
  const [secret, setSecret] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function finish(e: React.FormEvent) {
    e.preventDefault()
    let cleanSecret = secret.trim()
    if (kind === 'mnemonic') {
      const words = cleanSecret.split(/\s+/)
      if (words.length !== 12 && words.length !== 24) {
        setError('Seed phrase must be 12 or 24 words')
        return
      }
      cleanSecret = words.join(' ').toLowerCase()
    }
    if (password !== confirm) {
      setError('Passwords do not match')
      return
    }
    setBusy(true)
    setError('')
    try {
      await addWallet(name, cleanSecret, password, chain, kind)
      onDone()
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : kind === 'privkey'
            ? 'Invalid private key'
            : 'Invalid seed phrase',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={finish} className="max-w-lg space-y-3">
      <h2 className="font-medium">Import wallet</h2>
      <div className="flex gap-1">
        {(
          [
            ['mnemonic', 'Seed phrase'],
            ['privkey', 'Private key'],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            type="button"
            onClick={() => {
              setKind(k)
              setSecret('')
              setError('')
            }}
            className={`rounded-full px-4 py-1.5 text-sm ${
              kind === k ? 'bg-amber-500 font-medium text-white' : 'bg-slate-100 text-slate-600'
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      <p className="text-sm text-slate-500">
        {kind === 'mnemonic'
          ? 'Enter your 12 or 24 word seed phrase. It is encrypted with your password and stored only in this browser.'
          : 'Enter your private key as 64 hex characters (with or without 0x). It is encrypted with your password and stored only in this browser.'}
      </p>
      <textarea
        name="beehive-import-secret"
        value={secret}
        onChange={(e) => setSecret(e.target.value)}
        placeholder={kind === 'mnemonic' ? 'word1 word2 word3 ...' : '0x... or plain hex'}
        rows={kind === 'mnemonic' ? 3 : 2}
        required
        autoComplete="off"
        spellCheck={false}
        className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm focus:border-amber-500 focus:outline-none"
      />
      <input
        name="beehive-wallet-name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Wallet name (e.g. Main wallet)"
        autoComplete="off"
        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-amber-500 focus:outline-none"
      />
      <PasswordFields
        password={password}
        confirm={confirm}
        setPassword={setPassword}
        setConfirm={setConfirm}
      />
      {error && <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
      <div className="flex gap-2">
        <button
          disabled={busy}
          className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-white hover:bg-amber-600 disabled:opacity-50"
        >
          {busy ? 'Encrypting...' : 'Import wallet'}
        </button>
        <button type="button" onClick={onDone} className="px-3 py-2 text-sm text-slate-500 hover:underline">
          Cancel
        </button>
      </div>
    </form>
  )
}
