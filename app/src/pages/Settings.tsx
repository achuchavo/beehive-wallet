import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Plus, Import, TriangleAlert, Copy, Check } from 'lucide-react'
import { useWallet, generateMnemonic } from '../wallet/WalletContext'
import { useChains } from '../chainStore'
import { findChain, type ChainInfo } from '../chains'
import PasswordInput from '../components/PasswordInput'
import CopyAddress from '../components/CopyAddress'
import ChainPicker from '../components/ChainPicker'
import OptionPicker from '../components/OptionPicker'
import RemoveWalletDialog from '../components/RemoveWalletDialog'
import Checkbox from '../components/Checkbox'
import SecretShield from '../components/SecretShield'
import {
  copySecretTemporarily,
  cancelPendingSecretClear,
  SECRET_CLIPBOARD_SECONDS,
} from '../wallet/secretClipboard'
import { walletPasswordError, walletPasswordWeak } from '../wallet/password'
import { useT } from '../i18n/I18nContext'

/**
 * Copy control for SECRET material only.
 *
 * Two frictions the plain copy did not have: an explicit confirmation, because
 * putting a seed phrase on the clipboard is a decision with consequences the
 * user cannot see (cloud clipboard sync, clipboard history, the next paste
 * target); and an automatic wipe afterwards - conditional, so it never destroys
 * something the user copied in the meantime. See wallet/secretClipboard.ts.
 */
function CopyButton({ text, label }: { text: string; label: string }) {
  const { t } = useT()
  const [copied, setCopied] = useState(false)
  const [asking, setAsking] = useState(false)
  const [failed, setFailed] = useState(false)

  async function copy() {
    setAsking(false)
    const ok = await copySecretTemporarily(text)
    setFailed(!ok)
    if (!ok) return
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }
  if (asking) {
    return (
      <span className="flex flex-wrap items-center gap-2 text-xs">
        <span className="text-red-600">{t('settings.copyConfirm')}</span>
        <button type="button" onClick={copy} className="font-medium text-red-700 underline">
          {t('settings.copyAnyway')}
        </button>
        <button type="button" onClick={() => setAsking(false)} className="text-slate-500 underline">
          {t('common.cancel')}
        </button>
      </span>
    )
  }

  return (
    <span className="flex items-center gap-2">
      <button
        type="button"
        onClick={() => setAsking(true)}
        className="flex items-center gap-1 text-xs text-amber-700 hover:underline"
      >
        {copied ? <Check className="h-3.5 w-3.5 text-green-700" /> : <Copy className="h-3.5 w-3.5" />}
        {copied ? t('send.copied') : label}
      </button>
      {copied && (
        <span className="text-[11px] text-slate-500">
          {t('settings.clipboardClears', { seconds: SECRET_CLIPBOARD_SECONDS })}
        </span>
      )}
      {failed && <span className="text-[11px] text-red-600">{t('settings.copyFailed')}</span>}
    </span>
  )
}

type Mode = 'list' | 'create' | 'import'

export default function Settings() {
  const { t } = useT()
  const [params, setParams] = useSearchParams()

  // The URL is the single source of truth for which step is showing.
  //
  // This used to seed useState from the query string ONCE. Settings stays
  // mounted, so hitting "Create wallet" in the nav while already on Settings
  // changed the URL and nothing else - and browser Back/Forward moved the URL
  // without moving the UI. Deriving the mode on every render keeps the two in
  // step in both directions and makes history work for free.
  const action = params.get('action')
  const mode: Mode = action === 'create' ? 'create' : action === 'import' ? 'import' : 'list'

  function setMode(next: Mode) {
    const p = new URLSearchParams(params)
    if (next === 'list') p.delete('action')
    else p.set('action', next)
    // push, not replace: moving between steps is navigation the user can undo
    // with Back. goList() below replaces instead, so finishing does not leave
    // a Back button that returns to a completed flow.
    setParams(p)
  }

  function goList() {
    const p = new URLSearchParams(params)
    p.delete('action')
    setParams(p, { replace: true })
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
  // '' = every network.
  const [chainFilter, setChainFilter] = useState('')

  // Only the networks the user actually holds wallets on - offering a filter
  // for a chain with nothing on it would just produce an empty list.
  const walletChains = Array.from(new Set(wallets.map((w) => w.chainKey)))
    .map((k) => findChain(k))
    .filter((c): c is ChainInfo => c !== undefined)

  const shown = wallets.filter((w) => !chainFilter || w.chainKey === chainFilter)

  async function reveal(walletId: string) {
    setError('')
    try {
      const r = await revealSecret(walletId, password)
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

  // Accessible confirmation dialog instead of window.confirm (audit #27).
  const [removing, setRemoving] = useState<{ id: string; address: string; name: string } | null>(null)

  function confirmRemove() {
    if (!removing) return
    removeWallet(removing.id)
    // Drop any revealed secret still on screen for the wallet being removed.
    setSecret('')
    setRemoving(null)
  }

  return (
    <div className="space-y-4">
      <section className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-medium">{t('settings.yourWallets')}</h2>
          {/* Only worth offering once wallets actually span more than one
              network; with a single chain it filters nothing. */}
          {walletChains.length > 1 && (
            <OptionPicker
              label={t('dash.chainFilter')}
              value={chainFilter}
              onChange={setChainFilter}
              options={[
                { value: '', label: t('dash.allChains') },
                ...walletChains.map((c) => ({ value: c.key, label: c.chainName })),
              ]}
            />
          )}
        </div>
        <p className="text-sm text-slate-500">{t('settings.walletsDesc')}</p>
        {wallets.length === 0 ? (
          <p className="text-sm text-slate-500">{t('settings.noWallets')}</p>
        ) : shown.length === 0 ? (
          <p className="text-sm text-slate-500">{t('settings.noWalletsOnChain')}</p>
        ) : (
          <ul className="divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white">
            {shown.map((w) => (
              <li key={w.id} className="space-y-2 px-4 py-3">
                <div className="flex items-center gap-3">
                  <input
                    type="radio"
                    name="active"
                    checked={active?.id === w.id}
                    onChange={() => setActive(w.id)}
                    title={t('settings.activeWallet')}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 text-sm font-medium">
                      {w.name}
                      {/* The network was not shown at all before. With more
                          than one chain configured, two wallets can look
                          identical here while being entirely different
                          accounts on different networks. */}
                      <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs font-normal text-slate-600">
                        {findChain(w.chainKey)?.chainName ?? w.chainKey}
                      </span>
                    </div>
                    <CopyAddress address={w.address} className="max-w-full text-xs text-slate-500" />
                  </div>
                  <button
                    onClick={() => (revealFor === w.id ? closeReveal() : setRevealFor(w.id))}
                    className="text-xs text-amber-700 hover:underline"
                  >
                    {revealFor === w.id
                      ? t('common.close')
                      : w.kind === 'privkey'
                        ? t('settings.showKey')
                        : t('settings.showSeed')}
                  </button>
                  <button
                    onClick={() => setRemoving({ id: w.id, address: w.address, name: w.name })}
                    className="text-xs text-red-600 hover:underline"
                  >
                    {t('common.remove')}
                  </button>
                </div>
                {revealFor === w.id && (
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
                        <SecretShield>
                          <p className="break-all rounded bg-white p-2 font-mono text-sm">{secret}</p>
                        </SecretShield>
                        <p className="text-xs text-slate-500">{t('settings.autoHide')}</p>
                        <p className="text-xs text-amber-700">{t('settings.clipboardWarn')}</p>
                      </>
                    ) : (
                      <div className="flex gap-2">
                        <PasswordInput
                          name="beehive-reveal-password"
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          placeholder={t('settings.walletPassword')}
                          aria-label={t('settings.walletPassword')}
                          autoComplete="new-password"
                          className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-amber-500 focus:outline-none"
                        />
                        <button
                          onClick={() => reveal(w.id)}
                          className="rounded-lg bg-amber-500 px-3 py-2 text-sm font-medium text-slate-900 hover:bg-amber-600"
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
          className="flex items-center gap-2 rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-slate-900 hover:bg-amber-600"
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

      {removing && (
        <RemoveWalletDialog
          walletName={removing.name}
          address={removing.address}
          // Block removal while a secret is revealed for that wallet - a
          // wallet-sensitive operation is in progress.
          busy={revealFor === removing.id && secret !== ''}
          onConfirm={confirmRemove}
          onClose={() => setRemoving(null)}
        />
      )}
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
      <div>
        <label htmlFor="wallet-password" className="mb-1 block text-xs font-medium text-slate-600">
          {t('settings.walletPassword')}
        </label>
        <PasswordInput
          id="wallet-password"
          name="beehive-new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder={t('settings.newPassword')}
          minLength={10}
          required
          autoComplete="new-password"
          aria-describedby="wallet-password-hint"
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-amber-500 focus:outline-none"
        />
        <p id="wallet-password-hint" className="mt-1 text-xs text-slate-500">
          {t('settings.newPassword')}
        </p>
      </div>
      <div>
        <label htmlFor="wallet-password-confirm" className="mb-1 block text-xs font-medium text-slate-600">
          {t('settings.repeatPassword')}
        </label>
        <PasswordInput
          id="wallet-password-confirm"
          name="beehive-confirm-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          placeholder={t('settings.repeatPassword')}
          required
          autoComplete="new-password"
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-amber-500 focus:outline-none"
        />
      </div>
    </>
  )
}

function CreateWallet({ onDone }: { onDone: () => void }) {
  const { t } = useT()
  const { chains } = useChains()
  // Explicit network choice: it fixes the derivation path, address prefix and
  // denom for the life of the wallet, so it must not be an implicit default.
  const [chainKey, setChainKey] = useState(chains[0]?.key ?? '')
  const chain = chains.find((c) => c.key === chainKey) ?? chains[0]
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

  // Drop every secret when this step is left - navigating away, cancelling, or
  // finishing. Without this the phrase and password stayed in React state for
  // the life of the page. This cannot scrub the strings from memory (JS gives
  // no such guarantee), but it removes the only references the app holds.
  useEffect(() => {
    return () => {
      setMnemonic('')
      setPassword('')
      setConfirm('')
      cancelPendingSecretClear()
    }
  }, [])

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
          {/* Chosen BEFORE generating: the network fixes the derivation path
              and address prefix this wallet will use. */}
          <ChainPicker
            id="create-chain"
            label={t('settings.network')}
            value={chainKey}
            onChange={setChainKey}
          />
          {/* Step indicator: creating a wallet is a sequence with a point of
              no return (the phrase you must write down), so showing where you
              are - and that you can still leave - matters more than on an
              ordinary form. */}
          <p className="text-xs text-slate-500">{t('settings.stepOf', { step: 1, total: 4 })}</p>
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={start}
              disabled={!chain}
              className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-slate-900 hover:bg-amber-600 disabled:opacity-50"
            >
              {t('settings.generateSeed')}
            </button>
            {/* Exit BEFORE anything is generated. There was no way back from
                this step except browser navigation. */}
            <button
              type="button"
              onClick={onDone}
              className="rounded-lg px-4 py-2 text-sm text-slate-600 hover:text-slate-900"
            >
              {t('common.cancel')}
            </button>
          </div>
        </>
      ) : (
        <form onSubmit={finish} className="space-y-3">
          <p className="text-xs text-slate-500">
            {t('settings.stepOf', { step: confirmedSaved ? 3 : 2, total: 4 })}
          </p>
          <div className="rounded-lg border border-amber-300 bg-amber-50 p-3">
            <div className="mb-2 flex items-start justify-between gap-2">
              <p className="flex items-start gap-1.5 text-xs font-medium text-red-600">
                <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                {t('settings.seedWarning')}
              </p>
              {!confirmedSaved && <CopyButton text={mnemonic} label={t('settings.copy')} />}
            </div>
            {/* Hidden once the user confirms they have written it down: there
                is no reason for it to stay on screen through the verification
                step, and leaving it there lets the "verify" check be answered
                by reading rather than from the backup. */}
            {confirmedSaved ? (
              <p className="text-xs text-slate-500">{t('settings.seedHiddenAfterBackup')}</p>
            ) : (
              <SecretShield>
                <p className="font-mono text-sm leading-relaxed">{mnemonic}</p>
              </SecretShield>
            )}
          </div>
          <p className="rounded-lg bg-slate-50 p-2 text-xs text-slate-500">{t('settings.seedBackupNote')}</p>
          <Checkbox
            checked={confirmedSaved}
            onChange={setConfirmedSaved}
            label={t('settings.wroteDown')}
          />

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

          {/* Network is fixed once the seed is generated - show it, don't let
              it change underneath an already-derived wallet. */}
          <p className="text-xs text-slate-500">
            {t('settings.network')}: <span className="font-medium">{chain?.chainName}</span>{' '}
            <span className="font-mono text-slate-500">({chain?.chainId})</span>
          </p>
          <div>
            <label htmlFor="create-name" className="mb-1 block text-xs font-medium text-slate-600">
              {t('settings.walletName')}
            </label>
            <input
              id="create-name"
              name="beehive-create-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('settings.walletNamePlaceholder')}
              autoComplete="off"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-amber-500 focus:outline-none"
            />
          </div>
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
              className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-slate-900 hover:bg-amber-600 disabled:opacity-50"
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
  const { t } = useT()
  const { chains } = useChains()
  // Same as create: the network must be chosen, not inherited from a default.
  const [chainKey, setChainKey] = useState(chains[0]?.key ?? '')
  const chain = chains.find((c) => c.key === chainKey) ?? chains[0]
  const { addWallet } = useWallet()
  const [kind, setKind] = useState<'mnemonic' | 'privkey'>('mnemonic')
  const [name, setName] = useState('')
  const [secret, setSecret] = useState('')

  // Imported key material must not outlive this step - see CreateWallet.
  useEffect(() => {
    return () => {
      setSecret('')
      setPassword('')
      setConfirm('')
      cancelPendingSecretClear()
    }
  }, [])
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
              kind === k ? 'bg-amber-500 font-medium text-slate-900' : 'bg-slate-100 text-slate-600'
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      <p id="import-secret-desc" className="text-sm text-slate-500">
        {kind === 'mnemonic' ? t('settings.importMnemonicDesc') : t('settings.importPrivkeyDesc')}
      </p>
      <div>
        <label htmlFor="import-secret" className="mb-1 block text-xs font-medium text-slate-600">
          {kind === 'mnemonic' ? t('settings.seedPhrase') : t('settings.privateKey')}
        </label>
        <textarea
          id="import-secret"
          name="beehive-import-secret"
          value={secret}
          onChange={(e) => setSecret(e.target.value)}
          placeholder={kind === 'mnemonic' ? t('settings.mnemonicPlaceholder') : t('settings.privkeyPlaceholder')}
          rows={kind === 'mnemonic' ? 3 : 2}
          required
          // A secret must never reach a cloud spellchecker, a password manager,
          // or autofill history.
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          data-lpignore="true"
          data-1p-ignore="true"
          aria-describedby="import-secret-desc"
          className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm focus:border-amber-500 focus:outline-none"
        />
      </div>
      <ChainPicker
        id="import-chain"
        label={t('settings.network')}
        value={chainKey}
        onChange={setChainKey}
      />
      <div>
        <label htmlFor="import-name" className="mb-1 block text-xs font-medium text-slate-600">
          {t('settings.walletName')}
        </label>
        <input
          id="import-name"
          name="beehive-wallet-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t('settings.walletNamePlaceholder')}
          autoComplete="off"
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-amber-500 focus:outline-none"
        />
      </div>
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
          className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-slate-900 hover:bg-amber-600 disabled:opacity-50"
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
