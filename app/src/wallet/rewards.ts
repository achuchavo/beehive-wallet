import { fromBech32, toBech32 } from '@cosmjs/encoding'
import type { ChainInfo } from '../chains'
import { floorBaseUnits, isPositiveBase } from './amount'

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
  rewards: number // base units
  commission: number // base units
}

function parseUmedAmount(raw: string, denom: string): number {
  // Attribute like "80588760umed" or "12umed,34stake".
  return raw.split(',').reduce((sum, part) => {
    const m = part.match(new RegExp(`^(\\d+)${denom}$`))
    return sum + (m ? Number(m[1]) : 0)
  }, 0)
}

export async function fetchClaimHistory(
  chain: ChainInfo,
  addresses: string[],
): Promise<ClaimRecord[]> {
  const records: ClaimRecord[] = []
  const perAddress = await Promise.all(
    addresses.map(async (address) => {
      const url = `${chain.lcd}/cosmos/tx/v1beta1/txs?events=${encodeURIComponent(
        `message.sender='${address}'`,
      )}&order_by=2&pagination.limit=50`
      try {
        const res = await fetch(url)
        if (!res.ok) return []
        const data = await res.json()
        const out: ClaimRecord[] = []
        for (const tx of data.tx_responses ?? []) {
          let rewards = 0
          let commission = 0
          for (const ev of tx.events ?? []) {
            if (ev.type !== 'withdraw_rewards' && ev.type !== 'withdraw_commission') continue
            const amtAttr = (ev.attributes ?? []).find(
              (a: { key: string }) => a.key === 'amount',
            )
            if (!amtAttr) continue
            const value = parseUmedAmount(String(amtAttr.value ?? ''), chain.denom)
            if (ev.type === 'withdraw_rewards') rewards += value
            else commission += value
          }
          if (rewards > 0 || commission > 0) {
            out.push({ hash: tx.txhash, time: tx.timestamp, address, rewards, commission })
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
  rewards: number
  commission: number
}

export function monthlyTotals(records: ClaimRecord[]): MonthTotal[] {
  const byMonth = new Map<string, MonthTotal>()
  for (const r of records) {
    const month = r.time.slice(0, 7)
    const entry = byMonth.get(month) ?? { month, rewards: 0, commission: 0 }
    entry.rewards += r.rewards
    entry.commission += r.commission
    byMonth.set(month, entry)
  }
  return [...byMonth.values()].sort((a, b) => (a.month < b.month ? 1 : -1))
}
