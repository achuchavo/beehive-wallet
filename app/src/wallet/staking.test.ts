import { describe, it, expect } from 'vitest'
import {
  buildDelegate,
  buildUndelegate,
  buildClaim,
  buildRestake,
  isValidatorAllowed,
  delegationHasServiceFee,
} from './staking'
import type { ChainInfo } from '../chains'

// Minimal chain fixture - the builders read denom, serviceFee, feeCollector,
// freeValidators and stakingPolicy.
const FREE = 'panaceavaloper1free'
const chain = {
  denom: 'umed',
  serviceFee: '1000000',
  feeCollector: 'panacea1feecollector',
  freeValidators: [FREE],
  // The policy under which a fee is charged at all. Without it the fixture
  // describes a chain that charges nothing, which is what the app now does for
  // every policy except this one.
  stakingPolicy: 'allowlist_paid',
} as unknown as ChainInfo

const noFee = { ...chain, serviceFee: '0', feeCollector: '' } as ChainInfo
const openChain = { ...chain, stakingPolicy: 'all' } as ChainInfo
const restricted = { ...chain, stakingPolicy: 'allowlist' } as ChainInfo

const DEL = 'panacea1delegator'
const VAL = 'panaceavaloper1other'

describe('buildDelegate', () => {
  it('free validator: single MsgDelegate, no service-fee send', () => {
    const { messages } = buildDelegate(chain, DEL, FREE, '5000000')
    expect(messages).toHaveLength(1)
    expect(messages[0].typeUrl).toBe('/cosmos.staking.v1beta1.MsgDelegate')
    expect(messages[0].value.amount).toEqual({ denom: 'umed', amount: '5000000' })
  })

  it('paid validator with active service fee: bundles a MsgSend to the collector', () => {
    const { messages } = buildDelegate(chain, DEL, VAL, '5000000')
    expect(messages).toHaveLength(2)
    expect(messages[1].typeUrl).toBe('/cosmos.bank.v1beta1.MsgSend')
    expect(messages[1].value.toAddress).toBe('panacea1feecollector')
    expect(messages[1].value.amount).toEqual([{ denom: 'umed', amount: '1000000' }])
  })

  it('paid validator but no fee configured: no bundled send', () => {
    const { messages } = buildDelegate(noFee, DEL, VAL, '5000000')
    expect(messages).toHaveLength(1)
  })

  it('policy "all": nothing is chargeable even with a fee still configured', () => {
    // An admin who switches back to "any validator" without clearing the fee
    // must not keep charging for it - "every validator, no fee" is the whole
    // meaning of that policy.
    const { messages } = buildDelegate(openChain, DEL, VAL, '5000000')
    expect(messages).toHaveLength(1)
  })

  it('policy "allowlist": nothing is chargeable, because nothing outside the list is offered', () => {
    const { messages } = buildDelegate(restricted, DEL, VAL, '5000000')
    expect(messages).toHaveLength(1)
  })
})

describe('staking policy', () => {
  it('allows every validator under "all"', () => {
    expect(isValidatorAllowed(openChain, VAL)).toBe(true)
    expect(isValidatorAllowed(openChain, FREE)).toBe(true)
  })

  it('allows only the listed validators under "allowlist"', () => {
    expect(isValidatorAllowed(restricted, FREE)).toBe(true)
    expect(isValidatorAllowed(restricted, VAL)).toBe(false)
  })

  it('still offers everything under "allowlist_paid" - the list only sets the price', () => {
    expect(isValidatorAllowed(chain, FREE)).toBe(true)
    expect(isValidatorAllowed(chain, VAL)).toBe(true)
  })

  it('charges only outside the list, and only under the paid policy', () => {
    expect(delegationHasServiceFee(chain, VAL)).toBe(true)
    expect(delegationHasServiceFee(chain, FREE)).toBe(false)
    expect(delegationHasServiceFee(openChain, VAL)).toBe(false)
    expect(delegationHasServiceFee(restricted, VAL)).toBe(false)
  })

  it('does not charge when the policy is missing entirely', () => {
    // Fails towards NOT charging. An unreadable policy costing a user money is
    // strictly worse than one that costs us a fee, so the ambiguous case sides
    // with the user.
    const noPolicy = { ...chain, stakingPolicy: undefined } as unknown as ChainInfo
    expect(delegationHasServiceFee(noPolicy, VAL)).toBe(false)
  })
})

describe('buildUndelegate', () => {
  it('single MsgUndelegate with the exact amount', () => {
    const { messages } = buildUndelegate(chain, DEL, VAL, '250000')
    expect(messages).toHaveLength(1)
    expect(messages[0].typeUrl).toBe('/cosmos.staking.v1beta1.MsgUndelegate')
    expect(messages[0].value.amount).toEqual({ denom: 'umed', amount: '250000' })
  })
})

describe('buildClaim', () => {
  it('one withdraw per reward validator', () => {
    const { messages } = buildClaim(DEL, ['v1', 'v2', 'v3'], null)
    expect(messages).toHaveLength(3)
    expect(messages.every((m) => m.typeUrl.endsWith('MsgWithdrawDelegatorReward'))).toBe(true)
  })

  it('adds a commission withdrawal when a valoper is given', () => {
    const { messages } = buildClaim(DEL, ['v1'], 'panaceavaloper1self')
    expect(messages).toHaveLength(2)
    expect(messages[1].typeUrl).toBe('/cosmos.distribution.v1beta1.MsgWithdrawValidatorCommission')
  })

  it('throws when there is nothing to claim', () => {
    expect(() => buildClaim(DEL, [], null)).toThrow(/nothing to claim/i)
  })
})

describe('buildRestake', () => {
  it('emits a withdraw+delegate pair per positive reward and skips zeros', () => {
    const { messages } = buildRestake(chain, DEL, [
      { validator: 'v1', amount: '1000' },
      { validator: 'v2', amount: '0' },
      { validator: 'v3', amount: '2000' },
    ])
    // v1 and v3 only: 2 pairs = 4 messages
    expect(messages).toHaveLength(4)
    expect(messages[0].typeUrl).toBe('/cosmos.distribution.v1beta1.MsgWithdrawDelegatorReward')
    expect(messages[1].typeUrl).toBe('/cosmos.staking.v1beta1.MsgDelegate')
    expect(messages[1].value.amount).toEqual({ denom: 'umed', amount: '1000' })
  })

  it('throws when nothing is restakeable', () => {
    expect(() => buildRestake(chain, DEL, [{ validator: 'v1', amount: '0' }])).toThrow(/no rewards/i)
  })
})
