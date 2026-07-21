import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Plus, Import, TriangleAlert, Copy, Check } from 'lucide-react'
import { DEFAULT_CHAIN } from '../chains'
import { useWallet, generateMnemonic } from '../wallet/WalletContext'
import PasswordInput from '../components/PasswordInput'
import CopyAddress from '../components/CopyAddress'
import { walletPasswordError, walletPasswordWeak } from '../wallet/password'
import { useT } from '../i18n/I18nContext'

function CopyButton({ text, label }: { text: string; label: string }) {
  const { t } = useT()
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
      {copied ? t('send.copied') : label}
    </button>
  )
}

type Mode = 'list' | 'create' | 'import'

export default function Settings() {
  const { t } = useT()
  const [params, setParams] = useSearchParams()
  const initialMode: Mode =
    params.get('action') === 'create'
      ? 'create'
      : params.get('action') === 'import'
        ? 'import'
        : 'list'
  const [mode, setMode] = useState<Mode>(initialMode)

  function goList() {
    setMode('list')
    if (params.has('action')) {
      params.delete('action')
      setParams(params, { replace: true })
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">{t('settings.title')}</h1>
      {mode === 'list' && <WalletList onCreate={() => setMode('create')} onImport={() => setMode('import')} />}
      {mode === 'create' && <CreateWallet onDone={goList} />}
      {mode === 'import' && <ImportWallet onDone={goList} />}
    </div>
  )
}

function WalletList({ onCreate, onImport }: { onCreate: () => void; onImport: () => void }) {
  const { t } = useT()
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
      setPassword('') // the password is no longer needed once decrypted
    } catch (e) {
      setError(e instanceof Error ? e.message : t('settings.errFailed'))
    }
  }

  function closeReveal() {
    setRevealFor(null)
    setPassword('')
    setSecret('')
    setError('')
  }

  // A revealed secret is auto-hidden after a short time, and immediately when the
  // tab is backgrounded (shoulder-surfing / screen-share / app-switch defence).
  // NOTE: JavaScript cannot guarantee the plaintext is scrubbed from memory; this
  // only removes it from the screen and React state.
  useEffect(() => {
    if (!secret) return
    const timer = setTimeout(() => setSecret(''), 45000)
    const onHide = () => {
      if (document.hidden) setSecret('')
    }
    document.addEventListener('visibilitychange', onHide)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', onHide)
    }
  }, [secret])

  function remove(address: string) {
    if (window.confirm(t('settings.removeConfirm'))) {
      removeWallet(address)
    }
  }

  return (
    <div className="space-y-4">
      <section className="space-y-2">
        <h2 className="font-medium">{t('settings.yourWallets')}</h2>
        <p className="text-sm text-slate-500">{t('settings.walletsDesc')}</p>
        {wallets.length === 0 ? (
          <p className="text-sm text-slate-500">{t('settings.noWallets')}</p>
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
                    title={t('settings.activeWallet')}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium">{w.name}</div>
                    <CopyAddress address={w.address} className="max-w-full text-xs text-slate-400" />
                  </div>
                  <button
                    onClick={() => (revealFor === w.address ? closeReveal() : setRevealFor(w.address))}
                    className="text-xs text-amber-700 hover:underline"
                  >
                    {revealFor === w.address
                      ? t('common.close')
                      : w.kind === 'privkey'
                        ? t('settings.showKey')
                        : t('settings.showSeed')}
                  </button>
                  <button onClick={() => remove(w.address)} className="text-xs text-red-600 hover:underline">
                    {t('common.remove')}
                  </button>
                </div>
                {revealFor === w.address && (
                  <div className="space-y-2 rounded-lg bg-slate-50 p-3">
                    {secret ? (
                      <>
                        <div className="flex items-center justify-between">
                          <p className="flex items-center gap-1.5 text-xs font-medium text-red-600">
                            <TriangleAlert className="h-3.5 w-3.5 shrink-0" />
                            {t('settings.neverShare')}
                          </p>
                          <div className="flex items-center gap-2">
                            <CopyButton text={secret} label={w.kind === 'privkey' ? t('settings.copyKey') : t('settings.copySeed')} />
                            <button onClick={() => setSecret('')} className="text-xs text-slate-500 hover:text-amber-700">
                              {t('common.close')}
                            </button>
                          </div>
                        </div>
                        <p className="break-all rounded bg-white p-2 font-mono text-sm">{secret}</p>
                        <p className="text-xs text-slate-400">{t('settings.autoHide')}</p>
                        <p className="text-xs text-amber-700">{t('settings.clipboardWarn')}</p>
                      </>
                    ) : (
                      <div className="flex gap-2">
                        <PasswordInput
                          name="beehive-reveal-password"
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          placeholder={t('settings.walletPassword')}
                          autoComplete="new-password"
                          className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-amber-500 focus:outline-none"
                        />
                        <button
                          onClick={() => reveal(w.address)}
                          className="rounded-lg bg-amber-500 px-3 py-2 text-sm font-medium text-white hover:bg-amber-600"
                        >
                          {t('settings.reveal')}
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
          <Plus className="h-4 w-4" /> {t('settings.createNew')}
        </button>
        <button
          onClick={onImport}
          className="flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm hover:border-amber-500"
        >
          <Import className="h-4 w-4" /> {t('settings.import')}
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
  const { t } = useT()
  return (
    <>
      <PasswordInput
        name="beehive-new-password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder={t('settings.newPassword')}
        minLength={10}
        required
        autoComplete="new-password"
        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-amber-500 focus:outline-none"
      />
      <PasswordInput
        name="beehive-confirm-password"
        value={confirm}
        onChange={(e) => setConfirm(e.target.value)}
        placeholder={t('settings.repeatPassword')}
        required
        autoComplete="new-password"
        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-amber-500 focus:outline-none"
      />
    </>
  )
}

function CreateWallet({ onDone }: { onDone: () => void }) {
  const chain = DEFAULT_CHAIN
  const { t } = useT()
  const { addWallet } = useWallet()
  const [name, setName] = useState('')
  const [mnemonic, setMnemonic] = useState('')
  const [confirmedSaved, setConfirmedSaved] = useState(false)
  const [positions, setPositions] = useState<number[]>([])
  const [answers, setAnswers] = useState<Record<number, string>>({})
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function start() {
    const m = await generateMnemonic(chain)
    const words = m.split(' ')
    // Three distinct random positions the user must reproduce from their backup.
    const pos: number[] = []
    while (pos.length < 3) {
      const i = Math.floor(Math.random() * words.length)
      if (!pos.includes(i)) pos.push(i)
    }
    pos.sort((a, b) => a - b)
    setMnemonic(m)
    setPositions(pos)
    setAnswers({})
    setConfirmedSaved(false)
  }

  const words = mnemonic ? mnemonic.split(' ') : []
  const verified =
    positions.length > 0 &&
    positions.every((p) => (answers[p] ?? '').trim().toLowerCase() === words[p])

  async function finish(e: React.FormEvent) {
    e.preventDefault()
    if (!verified) {
      setError(t('settings.verifyFail'))
      return
    }
    const pwErr = walletPasswordError(password)
    if (pwErr) {
      setError(t(pwErr))
      return
    }
    if (password !== confirm) {
      setError(t('alarms.passwordsNoMatch'))
      return
    }
    setBusy(true)
    setError('')
    try {
      await addWallet(name, mnemonic, password, chain)
      onDone()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('settings.errFailed'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="max-w-lg space-y-4">
      <h2 className="font-medium">{t('settings.createNew')}</h2>
      {!mnemonic ? (
        <>
          <p className="text-sm text-slate-500">{t('settings.createDesc')}</p>
          <button
            onClick={start}
            className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-white hover:bg-amber-600"
          >
            {t('settings.generateSeed')}
          </button>
        </>
      ) : (
        <form onSubmit={finish} className="space-y-3">
          <div className="rounded-lg border border-amber-300 bg-amber-50 p-3">
            <div className="mb-2 flex items-start justify-between gap-2">
              <p className="flex items-start gap-1.5 text-xs font-medium text-red-600">
                <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                {t('settings.seedWarning')}
              </p>
              <CopyButton text={mnemonic} label={t('settings.copy')} />
            </div>
            <p className="font-mono text-sm leading-relaxed">{mnemonic}</p>
          </div>
          <p className="rounded-lg bg-slate-50 p-2 text-xs text-slate-500">{t('settings.seedBackupNote')}</p>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={confirmedSaved}
              onChange={(e) => setConfirmedSaved(e.target.checked)}
            />
            {t('settings.wroteDown')}
          </label>

          {confirmedSaved && (
            <div className="space-y-2 rounded-lg border border-slate-200 p-3">
              <p className="text-xs font-medium text-slate-600">{t('settings.verifyPrompt')}</p>
              <div className="grid grid-cols-3 gap-2">
                {positions.map((p) => (
                  <label key={p} className="text-xs text-slate-500">
                    {t('settings.wordN', { n: p + 1 })}
                    <input
                      value={answers[p] ?? ''}
                      onChange={(e) => setAnswers((a) => ({ ...a, [p]: e.target.value }))}
                      autoComplete="off"
                      spellCheck={false}
                      className="mt-0.5 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm focus:border-amber-500 focus:outline-none"
                    />
                  </label>
                ))}
              </div>
              {verified && <p className="text-xs font-medium text-green-700">{t('settings.verifyOk')}</p>}
            </div>
          )}

          <input
            name="beehive-create-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('settings.walletNamePlaceholder')}
            autoComplete="off"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-amber-500 focus:outline-none"
          />
          <PasswordFields
            password={password}
            confirm={confirm}
            setPassword={setPassword}
            setConfirm={setConfirm}
          />
          {walletPasswordWeak(password) && (
            <p className="text-xs text-amber-700">{t('settings.pwWeak')}</p>
          )}
          {error && <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
          <div className="flex gap-2">
            <button
              disabled={busy || !verified}
              className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-white hover:bg-amber-600 disabled:opacity-50"
            >
              {busy ? t('settings.encrypting') : t('settings.saveWallet')}
            </button>
            <button type="button" onClick={onDone} className="px-3 py-2 text-sm text-slate-500 hover:underline">
              {t('common.cancel')}
            </button>
          </div>
        </form>
      )}
    </div>
  )
}

function ImportWallet({ onDone }: { onDone: () => void }) {
  const chain = DEFAULT_CHAIN
  const { t } = useT()
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
        setError(t('settings.errSeedWords'))
        return
      }
      cleanSecret = words.join(' ').toLowerCase()
    }
    const pwErr = walletPasswordError(password)
    if (pwErr) {
      setError(t(pwErr))
      return
    }
    if (password !== confirm) {
      setError(t('alarms.passwordsNoMatch'))
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
            ? t('settings.errInvalidKey')
            : t('settings.errInvalidSeed'),
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={finish} className="max-w-lg space-y-3">
      <h2 className="font-medium">{t('settings.import')}</h2>
      <div className="flex gap-1">
        {(
          [
            ['mnemonic', t('settings.seedPhrase')],
            ['privkey', t('settings.privateKey')],
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
        {kind === 'mnemonic' ? t('settings.importMnemonicDesc') : t('settings.importPrivkeyDesc')}
      </p>
      <textarea
        name="beehive-import-secret"
        value={secret}
        onChange={(e) => setSecret(e.target.value)}
        placeholder={kind === 'mnemonic' ? t('settings.mnemonicPlaceholder') : t('settings.privkeyPlaceholder')}
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
        placeholder={t('settings.walletNamePlaceholder')}
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
          {busy ? t('settings.encrypting') : t('settings.import')}
        </button>
        <button type="button" onClick={onDone} className="px-3 py-2 text-sm text-slate-500 hover:underline">
          {t('common.cancel')}
        </button>
      </div>
    </form>
  )
}
