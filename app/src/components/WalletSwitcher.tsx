import OptionPicker from './OptionPicker'
import { useWallet } from '../wallet/WalletContext'
import { findChain } from '../chains'

/**
 * Switches the app's ACTIVE wallet in place, from any page that acts on it.
 *
 * Options are keyed by wallet id, never by address: the same address can be a
 * different account on another chain (see storage.ts), and setActive() takes an
 * id. The chain name rides along in the hint because changing sender can also
 * change network - that has to be visible at the moment of choosing.
 *
 * Renders nothing with fewer than two wallets; callers show the plain name.
 */
export default function WalletSwitcher({
  label,
  className = '',
  id,
}: {
  /** Accessible name for the trigger and the dialog title. */
  label: string
  className?: string
  id?: string
}) {
  const { wallets, active, setActive } = useWallet()
  if (!active || wallets.length < 2) return null

  return (
    <OptionPicker
      id={id}
      label={label}
      value={active.id}
      onChange={setActive}
      className={className}
      layout="list"
      options={wallets.map((w) => {
        const chain = findChain(w.chainKey)
        return {
          value: w.id,
          label: w.name,
          hint: `${chain?.chainName ?? w.chainKey} · ${w.address.slice(0, 12)}...${w.address.slice(-6)}`,
        }
      })}
    />
  )
}
