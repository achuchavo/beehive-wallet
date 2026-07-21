import { SigningStargateClient, GasPrice } from '@cosmjs/stargate'
import type { OfflineDirectSigner, EncodeObject } from '@cosmjs/proto-signing'
import type { ChainInfo } from '../chains'

async function connect(chain: ChainInfo, signer: OfflineDirectSigner) {
  return SigningStargateClient.connectWithSigner(chain.rpc, signer, {
    gasPrice: GasPrice.fromString(chain.gasPrice),
  })
}

async function broadcast(
  chain: ChainInfo,
  signer: OfflineDirectSigner,
  sender: string,
  messages: EncodeObject[],
  memo = '',
): Promise<string> {
  const client = await connect(chain, signer)
  try {
    const res = await client.signAndBroadcast(sender, messages, 'auto', memo)
    if (res.code !== 0) {
      throw new Error(res.rawLog || `Transaction failed (code ${res.code})`)
    }
    return res.transactionHash
  } finally {
    client.disconnect()
  }
}

// Whether a non-Beehive delegation carries a configured service fee.
export function serviceFeeActive(chain: ChainInfo): boolean {
  return chain.serviceFee !== '0' && chain.feeCollector !== ''
}

export function isBeehive(chain: ChainInfo, validator: string): boolean {
  return validator === chain.beehiveValidator
}

export async function delegate(
  chain: ChainInfo,
  signer: OfflineDirectSigner,
  delegator: string,
  validator: string,
  amount: string,
): Promise<string> {
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

  // Free to Beehive; a bundled service fee to other validators when configured.
  if (!isBeehive(chain, validator) && serviceFeeActive(chain)) {
    messages.push({
      typeUrl: '/cosmos.bank.v1beta1.MsgSend',
      value: {
        fromAddress: delegator,
        toAddress: chain.feeCollector,
        amount: [{ denom: chain.denom, amount: chain.serviceFee }],
      },
    })
  }

  return broadcast(chain, signer, delegator, messages, 'Beehive Wallet: delegate')
}

export async function undelegate(
  chain: ChainInfo,
  signer: OfflineDirectSigner,
  delegator: string,
  validator: string,
  amount: string,
): Promise<string> {
  const messages: EncodeObject[] = [
    {
      typeUrl: '/cosmos.staking.v1beta1.MsgUndelegate',
      value: {
        delegatorAddress: delegator,
        validatorAddress: validator,
        amount: { denom: chain.denom, amount },
      },
    },
  ]
  return broadcast(chain, signer, delegator, messages, 'Beehive Wallet: undelegate')
}

export async function claimRewards(
  chain: ChainInfo,
  signer: OfflineDirectSigner,
  delegator: string,
  validators: string[],
): Promise<string> {
  const messages: EncodeObject[] = validators.map((validatorAddress) => ({
    typeUrl: '/cosmos.distribution.v1beta1.MsgWithdrawDelegatorReward',
    value: { delegatorAddress: delegator, validatorAddress },
  }))
  return broadcast(chain, signer, delegator, messages, 'Beehive Wallet: claim rewards')
}

// Claims delegator rewards (per validator) and, if commissionValoper is given,
// validator commission - all in one signed transaction for this address.
export async function claimEarnings(
  chain: ChainInfo,
  signer: OfflineDirectSigner,
  address: string,
  rewardValidators: string[],
  commissionValoper: string | null,
): Promise<string> {
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
  return broadcast(chain, signer, address, messages, 'Beehive Wallet: claim')
}

// Compound: withdraw each validator's rewards and delegate that amount straight
// back to the same validator, in one signed transaction. The network fee comes
// from the wallet's available balance.
export async function restakeEarnings(
  chain: ChainInfo,
  signer: OfflineDirectSigner,
  address: string,
  rewardsByValidator: { validator: string; amount: string }[],
): Promise<string> {
  const messages: EncodeObject[] = []
  for (const { validator, amount } of rewardsByValidator) {
    if (Number(amount) <= 0) continue
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
  return broadcast(chain, signer, address, messages, 'Beehive Wallet: restake')
}
