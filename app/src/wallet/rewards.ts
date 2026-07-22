import { fromBech32, toBech32 } from '@cosmjs/encoding'
import type { ChainInfo } from '../chains'
import { floorBaseUnits, isPositiveBase, sumBase } from './amount'
import { fetchTxSearch } from './txsearch'

// An account address and its validator (valoper) address share the same key
// bytes, only the bech32 prefix differs.
export function accountToValoper(address: string, prefix: string): string {
  const { data } = fromBech32(address)
  return toBech32(`${prefix}valoper`, data)
}

export interface RewardByValidator {
  validator: string
  amount: string // base units (floored)
}

export interface WalletEarnings {
  address: string
  valoper: string
  rewards: string // claimable delegator rewards, base units (floored)
  rewardValidators: string[] // validators with rewards > 0
  rewardsByValidator: RewardByValidator[] // per-validator reward, for restaking
  isValidator: boolean
  commission: string // claimable commission, base units (floored)
}

function sumUmed(chain: ChainInfo, coins: { denom: string; amount: string }[] | undefined): string {
  const coin = (coins ?? []).find((c) => c.denom === chain.denom)
  return coin ? floorBaseUnits(coin.amount) : '0'
}

export async function fetchWalletEarnings(
  chain: ChainInfo,
  address: string,
): Promise<WalletEarnings> {
  const valoper = accountToValoper(address, chain.bech32Prefix)
  // The commission endpoint returns 200 (empty) for any well-formed valoper, so
  // it can't tell us if the address is a validator - the staking endpoint can.
  const [rewRes, valRes, comRes] = await Promise.all([
    fetch(`${chain.lcd}/cosmos/distribution/v1beta1/delegators/${address}/rewards`),
    fetch(`${chain.lcd}/cosmos/staking/v1beta1/validators/${valoper}`),
    fetch(`${chain.lcd}/cosmos/distribution/v1beta1/validators/${valoper}/commission`),
  ])

  let rewards = '0'
  const rewardValidators: string[] = []
  const rewardsByValidator: RewardByValidator[] = []
  if (rewRes.ok) {
    const d = await rewRes.json()
    rewards = sumUmed(chain, d.total)
    for (const r of d.rewards ?? []) {
      const amount = sumUmed(chain, r.reward)
      if (isPositiveBase(amount)) {
        rewardValidators.push(r.validator_address)
        rewardsByValidator.push({ validator: r.validator_address, amount })
      }
    }
  }

  const isValidator = valRes.ok
  let commission = '0'
  if (isValidator && comRes.ok) {
    const d = await comRes.json()
    commission = sumUmed(chain, d.commission?.commission)
  }

  return { address, valoper, rewards, rewardValidators, rewardsByValidator, isValidator, commission }
}

export interface ClaimRecord {
  hash: string
  time: string
  address: string
  /** Base units as an exact integer string - never a JS number. */
  rewards: string
  /** Base units as an exact integer string - never a JS number. */
  commission: string
  /** Denom these amounts are in, so callers cannot mix assets. */
  denom: string
  /** Chain these amounts came from, for per-chain grouping. */
  chainKey: string
}

/**
 * Sum the matching-denom parts of a Cosmos amount attribute such as
 * "80588760umed" or "12umed,34stake". Exact: parts are summed as BigInt, so a
 * value beyond Number.MAX_SAFE_INTEGER is not rounded. Parts in other denoms
 * are ignored rather than added into a different asset's total.
 */
export function parseDenomAmount(raw: string, denom: string): string {
  let total = 0n
  for (const part of raw.split(',')) {
    const m = part.trim().match(new RegExp(`^(\\d+)${denom}$`))
    if (m) total += BigInt(m[1])
  }
  return total.toString()
}

/** Only the fields this function reads off an LCD tx response. */
interface LcdClaimTx {
  txhash: string
  timestamp: string
  events?: { type: string; attributes?: { key: string; value?: unknown }[] }[]
}

export async function fetchClaimHistory(
  chain: ChainInfo,
  addresses: string[],
): Promise<ClaimRecord[]> {
  const records: ClaimRecord[] = []
  const perAddress = await Promise.all(
    addresses.map(async (address) => {
      try {
        // Parameter name differs by SDK version - see txsearch.ts.
        const data = await fetchTxSearch(
          chain,
          `message.sender='${address}'`,
          '&order_by=2&pagination.limit=50',
        )
        if (!data) return []
        const out: ClaimRecord[] = []
        for (const tx of (data.tx_responses ?? []) as LcdClaimTx[]) {
          // Exact BigInt accumulation: reward attributes can exceed 2^53.
          let rewards = 0n
          let commission = 0n
          for (const ev of tx.events ?? []) {
            if (ev.type !== 'withdraw_rewards' && ev.type !== 'withdraw_commission') continue
            const amtAttr = (ev.attributes ?? []).find(
              (a: { key: string }) => a.key === 'amount',
            )
            if (!amtAttr) continue
            const value = BigInt(parseDenomAmount(String(amtAttr.value ?? ''), chain.denom))
            if (ev.type === 'withdraw_rewards') rewards += value
            else commission += value
          }
          if (rewards > 0n || commission > 0n) {
            out.push({
              hash: tx.txhash,
              time: tx.timestamp,
              address,
              rewards: rewards.toString(),
              commission: commission.toString(),
              denom: chain.denom,
              chainKey: chain.key,
            })
          }
        }
        return out
      } catch {
        return []
      }
    }),
  )
  for (const list of perAddress) records.push(...list)
  records.sort((a, b) => (a.time < b.time ? 1 : -1))
  return records
}

export interface MonthTotal {
  month: string // YYYY-MM
  /** Base units, exact integer string. */
  rewards: string
  /** Base units, exact integer string. */
  commission: string
  denom: string
  chainKey: string
}

/**
 * Average claimed per month for ONE chain: everything claimed on that chain
 * divided by the calendar span it covers.
 *
 * Scoped to a single chainKey on purpose - averaging across chains would sum
 * different assets with different decimals. Returns base units as an exact
 * integer string, plus the span it was measured over (so the caller can say
 * "over the last N months" rather than implying a longer history than exists).
 *
 * Shared by the Rewards page and the Dashboard so the two cannot drift.
 */
export function averageMonthly(
  records: ClaimRecord[],
  chainKey: string,
): { amount: string; months: number } {
  const forChain = records.filter((r) => r.chainKey === chainKey)
  if (forChain.length === 0) return { amount: '0', months: 0 }

  // Exact: base units can exceed Number.MAX_SAFE_INTEGER.
  const total = sumBase(forChain.flatMap((r) => [r.rewards, r.commission]))

  // Records arrive newest-first.
  const [ly, lm] = forChain[0].time.slice(0, 7).split('-').map(Number)
  const [ey, em] = forChain[forChain.length - 1].time.slice(0, 7).split('-').map(Number)
  const months = (ly - ey) * 12 + (lm - em) + 1
  if (!Number.isFinite(months) || months <= 0) return { amount: '0', months: 0 }

  // Integer base-unit division; the quotient is still a base-unit string.
  return { amount: (BigInt(total) / BigInt(months)).toString(), months }
}

/**
 * Monthly claim totals, bucketed by (month, chainKey, denom). Amounts from
 * different chains or denoms are never added together - they are different
 * assets and may not even share a decimals value. Sums are exact (BigInt).
 */
export function monthlyTotals(records: ClaimRecord[]): MonthTotal[] {
  const byKey = new Map<string, { month: string; chainKey: string; denom: string; r: bigint; c: bigint }>()
  for (const rec of records) {
    const month = rec.time.slice(0, 7)
    const key = `${month}|${rec.chainKey}|${rec.denom}`
    const entry = byKey.get(key) ?? {
      month,
      chainKey: rec.chainKey,
      denom: rec.denom,
      r: 0n,
      c: 0n,
    }
    entry.r += BigInt(rec.rewards || '0')
    entry.c += BigInt(rec.commission || '0')
    byKey.set(key, entry)
  }
  return [...byKey.values()]
    .map((e) => ({
      month: e.month,
      chainKey: e.chainKey,
      denom: e.denom,
      rewards: e.r.toString(),
      commission: e.c.toString(),
    }))
    .sort((a, b) => (a.month < b.month ? 1 : a.month > b.month ? -1 : a.chainKey.localeCompare(b.chainKey)))
}
