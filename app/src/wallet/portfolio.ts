import { fromBech32, toBech32 } from '@cosmjs/encoding'
import type { ChainInfo } from '../chains'
import { floorBaseUnits, sumBase, compareBase } from './amount'

export interface DelegationDetail {
  validator: string
  moniker: string
  amount: string // base units
  reward: string // base units (floored)
}

export interface WalletPortfolio {
  address: string
  available: string
  delegations: DelegationDetail[]
  staked: string
  rewards: string
  commission: string
  isValidator: boolean
}

function accountToValoper(address: string, prefix: string): string {
  const { data } = fromBech32(address)
  return toBech32(`${prefix}valoper`, data)
}

function sumUmed(chain: ChainInfo, coins: { denom: string; amount: string }[] | undefined): string {
  const coin = (coins ?? []).find((c) => c.denom === chain.denom)
  return coin ? floorBaseUnits(coin.amount) : '0'
}

// operator_address -> moniker, for the bonded validator set.
export async function fetchValidatorMonikers(chain: ChainInfo): Promise<Record<string, string>> {
  const map: Record<string, string> = {}
  try {
    const res = await fetch(
      `${chain.lcd}/cosmos/staking/v1beta1/validators?status=BOND_STATUS_BONDED&pagination.limit=500`,
    )
    if (!res.ok) return map
    const data = await res.json()
    for (const v of data.validators ?? []) {
      map[v.operator_address] = v.description?.moniker ?? v.operator_address
    }
  } catch {
    // best effort - fall back to raw addresses
  }
  return map
}

export async function fetchWalletPortfolio(
  chain: ChainInfo,
  address: string,
  monikers: Record<string, string>,
): Promise<WalletPortfolio> {
  const valoper = accountToValoper(address, chain.bech32Prefix)
  const [balRes, delRes, rewRes, valRes] = await Promise.all([
    fetch(`${chain.lcd}/cosmos/bank/v1beta1/balances/${address}`),
    fetch(`${chain.lcd}/cosmos/staking/v1beta1/delegations/${address}`),
    fetch(`${chain.lcd}/cosmos/distribution/v1beta1/delegators/${address}/rewards`),
    fetch(`${chain.lcd}/cosmos/staking/v1beta1/validators/${valoper}`),
  ])

  const isValidator = valRes.ok

  // Only a validator has a commission pool, and this used to be fetched in the
  // batch above even though the result is discarded for everyone else. That is
  // not merely wasteful: chains whose LCD answers 5xx (rather than 404) for a
  // non-existent validator make lcd_proxy fail over across EVERY configured
  // endpoint before giving up - measured at 32s on Chihuahua against 1s for the
  // validator lookup beside it - and the dashboard blocked on it the whole
  // time. Medibloc answers fast, which is why this never showed with one chain.
  const comRes = isValidator
    ? await fetch(`${chain.lcd}/cosmos/distribution/v1beta1/validators/${valoper}/commission`)
    : null

  let available = '0'
  if (balRes.ok) available = sumUmed(chain, (await balRes.json()).balances)

  // Per-validator rewards, to annotate each delegation.
  const rewardByVal: Record<string, string> = {}
  let rewards = '0'
  if (rewRes.ok) {
    const rd = await rewRes.json()
    rewards = sumUmed(chain, rd.total)
    for (const r of rd.rewards ?? []) rewardByVal[r.validator_address] = sumUmed(chain, r.reward)
  }

  const delegations: DelegationDetail[] = []
  if (delRes.ok) {
    const dd = await delRes.json()
    for (const d of dd.delegation_responses ?? []) {
      const v = d.delegation.validator_address
      delegations.push({
        validator: v,
        moniker: monikers[v] ?? `${v.slice(0, 16)}...`,
        amount: String(d.balance.amount),
        reward: rewardByVal[v] ?? '0',
      })
    }
  }
  // Exact sum and sort over base-unit strings (delegations can exceed 2^53).
  const staked = sumBase(delegations.map((d) => d.amount))
  delegations.sort((a, b) => compareBase(b.amount, a.amount))

  let commission = '0'
  if (comRes?.ok) {
    commission = sumUmed(chain, (await comRes.json()).commission?.commission)
  }

  return { address, available, delegations, staked, rewards, commission, isValidator }
}
