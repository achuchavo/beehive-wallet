import type { EncodeObject } from '@cosmjs/proto-signing'
import type { ChainInfo } from '../chains'
import { isPositiveBase } from './amount'

// Message builders only. Simulation and broadcast (with a chain-id preflight and
// a fixed, reviewed fee) live in ./tx.ts, so every staking action can flow through
// the same simulate -> review -> confirm -> broadcast path as Send.

export interface TxMessages {
  messages: EncodeObject[]
  memo: string
}

// Whether a non-Beehive delegation carries a configured service fee.
export function serviceFeeActive(chain: ChainInfo): boolean {
  return chain.serviceFee !== '0' && chain.feeCollector !== ''
}

export function isBeehive(chain: ChainInfo, validator: string): boolean {
  return validator === chain.beehiveValidator
}

/**
 * On the admin-managed list for this chain.
 *
 * What being on it MEANS depends on the chain's staking policy:
 *   all             nothing - every validator is free and offered
 *   allowlist       these are the only validators offered at all
 *   allowlist_paid  these are free; others are offered but cost the fee
 */
export function isFree(chain: ChainInfo, validator: string): boolean {
  return chain.freeValidators.includes(validator)
}

/**
 * Whether this app offers delegation to this validator.
 *
 * SCOPE, worth being honest about: this governs what BEEHIVE offers. A
 * delegation is a transaction the user signs and broadcasts themselves, so
 * nothing here prevents staking elsewhere from another wallet or an explorer.
 * It is a product policy, not a chain rule - and the admin screen says so.
 */
export function isValidatorAllowed(chain: ChainInfo, validator: string): boolean {
  if (chain.stakingPolicy !== 'allowlist') return true
  return isFree(chain, validator)
}

/** Whether a delegation to this validator bundles a service-fee bank send. */
export function delegationHasServiceFee(chain: ChainInfo, validator: string): boolean {
  // Only the paid policy charges. Under 'all' nothing is chargeable, and under
  // 'allowlist' anything chargeable is simply not offered - so reading the fee
  // in either case would bundle a payment for something that is already free or
  // already refused.
  if (chain.stakingPolicy !== 'allowlist_paid') return false
  return !isFree(chain, validator) && serviceFeeActive(chain)
}

export function buildDelegate(
  chain: ChainInfo,
  delegator: string,
  validator: string,
  amount: string,
): TxMessages {
  const messages: EncodeObject[] = [
    {
      typeUrl: '/cosmos.staking.v1beta1.MsgDelegate',
      value: {
        delegatorAddress: delegator,
        validatorAddress: validator,
        amount: { denom: chain.denom, amount },
      },
    },
  ]
  // Free to the free-validator set; a bundled service fee elsewhere when set.
  if (delegationHasServiceFee(chain, validator)) {
    messages.push({
      typeUrl: '/cosmos.bank.v1beta1.MsgSend',
      value: {
        fromAddress: delegator,
        toAddress: chain.feeCollector,
        amount: [{ denom: chain.denom, amount: chain.serviceFee }],
      },
    })
  }
  return { messages, memo: 'Beehive Wallet: delegate' }
}

export function buildUndelegate(
  chain: ChainInfo,
  delegator: string,
  validator: string,
  amount: string,
): TxMessages {
  return {
    messages: [
      {
        typeUrl: '/cosmos.staking.v1beta1.MsgUndelegate',
        value: {
          delegatorAddress: delegator,
          validatorAddress: validator,
          amount: { denom: chain.denom, amount },
        },
      },
    ],
    memo: 'Beehive Wallet: undelegate',
  }
}

// Claims delegator rewards (per validator) and, if commissionValoper is given,
// validator commission - all in one signed transaction for this address.
export function buildClaim(
  address: string,
  rewardValidators: string[],
  commissionValoper: string | null,
): TxMessages {
  const messages: EncodeObject[] = rewardValidators.map((validatorAddress) => ({
    typeUrl: '/cosmos.distribution.v1beta1.MsgWithdrawDelegatorReward',
    value: { delegatorAddress: address, validatorAddress },
  }))
  if (commissionValoper) {
    messages.push({
      typeUrl: '/cosmos.distribution.v1beta1.MsgWithdrawValidatorCommission',
      value: { validatorAddress: commissionValoper },
    })
  }
  if (messages.length === 0) throw new Error('Nothing to claim')
  return { messages, memo: 'Beehive Wallet: claim' }
}

// Compound: withdraw each validator's rewards and delegate that amount straight
// back to the same validator, in one signed transaction. The network fee comes
// from the wallet's available balance.
export function buildRestake(
  chain: ChainInfo,
  address: string,
  rewardsByValidator: { validator: string; amount: string }[],
): TxMessages {
  const messages: EncodeObject[] = []
  for (const { validator, amount } of rewardsByValidator) {
    if (!isPositiveBase(amount)) continue
    messages.push({
      typeUrl: '/cosmos.distribution.v1beta1.MsgWithdrawDelegatorReward',
      value: { delegatorAddress: address, validatorAddress: validator },
    })
    messages.push({
      typeUrl: '/cosmos.staking.v1beta1.MsgDelegate',
      value: {
        delegatorAddress: address,
        validatorAddress: validator,
        amount: { denom: chain.denom, amount },
      },
    })
  }
  if (messages.length === 0) throw new Error('No rewards to restake')
  return { messages, memo: 'Beehive Wallet: restake' }
}
