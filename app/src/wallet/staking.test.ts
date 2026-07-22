import { describe, it, expect } from 'vitest'
import { buildDelegate, buildUndelegate, buildClaim, buildRestake } from './staking'
import type { ChainInfo } from '../chains'

// Minimal chain fixture - the builders only read denom/serviceFee/feeCollector/freeValidators.
const FREE = 'panaceavaloper1free'
const chain = {
  denom: 'umed',
  serviceFee: '1000000',
  feeCollector: 'panacea1feecollector',
  freeValidators: [FREE],
} as unknown as ChainInfo

const noFee = { ...chain, serviceFee: '0', feeCollector: '' } as ChainInfo

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
