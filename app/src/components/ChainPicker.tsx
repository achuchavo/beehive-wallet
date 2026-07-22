import Select from './Select'
import { useChains } from '../chainStore'
import type { ChainInfo } from '../chains'

/**
 * Explicit network selection for wallet create/import (audit #13).
 *
 * A wallet's chain determines its derivation path, address prefix and denom, so
 * it must be a deliberate choice rather than an implicit DEFAULT_CHAIN. The
 * identifying details are shown alongside the name so the user can confirm they
 * are on the network they think they are.
 */
export default function ChainPicker({
  value,
  onChange,
  label,
  id = 'chain-picker',
  disabled = false,
}: {
  value: string
  onChange: (chainKey: string) => void
  label: string
  id?: string
  disabled?: boolean
}) {
  const { chains, status } = useChains()
  const selected: ChainInfo | undefined = chains.find((c) => c.key === value)

  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-xs font-medium text-slate-600">
        {label}
      </label>
      <Select
        id={id}
        full
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled || status === 'loading'}
        className="py-2"
        aria-describedby={`${id}-detail`}
      >
        {chains.map((c) => (
          <option key={c.key} value={c.key}>
            {c.chainName}
          </option>
        ))}
      </Select>
      {selected && (
        <p id={`${id}-detail`} className="mt-1 font-mono text-xs text-slate-400">
          {selected.chainId} · {selected.bech32Prefix}1… · {selected.displayDenom} ·{' '}
          {selected.decimals} decimals
        </p>
      )}
    </div>
  )
}
