import { SigningStargateClient, GasPrice, calculateFee } from '@cosmjs/stargate'
import type { StdFee } from '@cosmjs/amino'
import type { OfflineDirectSigner, EncodeObject } from '@cosmjs/proto-signing'
import type { ChainInfo } from '../chains'
import { chainsUsable } from '../chainStore'

// Two-phase signing: simulate (to show a real fee in the review) then broadcast
// with that exact fee, so what the user confirms is what gets charged. Both
// phases verify the connected node is the expected network before doing anything.

const GAS_MULTIPLIER = 1.4

async function connect(chain: ChainInfo, signer: OfflineDirectSigner) {
  return SigningStargateClient.connectWithSigner(chain.rpc, signer, {
    gasPrice: GasPrice.fromString(chain.gasPrice),
  })
}

async function verifyNetwork(client: SigningStargateClient, chain: ChainInfo): Promise<void> {
  const nodeChainId = await client.getChainId()
  if (nodeChainId !== chain.chainId) {
    throw new Error(
      `Connected to the wrong network (${nodeChainId}, expected ${chain.chainId}). Transaction aborted.`,
    )
  }
}

/**
 * Refuse to build or broadcast anything while the chain registry is still
 * loading or failed to load. Signing against the unverified bootstrap config
 * could use a stale gas price, fee collector or RPC endpoint.
 */
function assertChainConfigReady(): void {
  if (!chainsUsable()) {
    throw new Error(
      'Chain configuration is not loaded yet. Please wait a moment and try again.',
    )
  }
}

export interface FeeEstimate {
  gas: string
  fee: StdFee
  /** Fee amount in the chain's base denom (base units). */
  amount: string
  denom: string
}

/** Estimate the network fee by simulating the messages. Never broadcasts. */
export async function simulateTx(
  chain: ChainInfo,
  signer: OfflineDirectSigner,
  sender: string,
  messages: EncodeObject[],
  memo = '',
  // Gas price to price the fee at. Defaults to the chain minimum; the Send page
  // passes a scaled price for its Low/Medium/High speed options.
  gasPrice: string = chain.gasPrice,
): Promise<FeeEstimate> {
  assertChainConfigReady()
  const client = await connect(chain, signer)
  try {
    await verifyNetwork(client, chain)
    const gasEstimate = await client.simulate(sender, messages, memo)
    const gasLimit = Math.ceil(gasEstimate * GAS_MULTIPLIER)
    const fee = calculateFee(gasLimit, GasPrice.fromString(gasPrice))
    const coin = fee.amount.find((c) => c.denom === chain.denom) ?? fee.amount[0]
    return { gas: String(gasLimit), fee, amount: coin?.amount ?? '0', denom: coin?.denom ?? chain.denom }
  } finally {
    client.disconnect()
  }
}

/** Sign and broadcast with a fixed fee (the one shown in the review). */
export async function broadcastTx(
  chain: ChainInfo,
  signer: OfflineDirectSigner,
  sender: string,
  messages: EncodeObject[],
  fee: StdFee,
  memo = '',
): Promise<string> {
  assertChainConfigReady()
  const client = await connect(chain, signer)
  try {
    await verifyNetwork(client, chain)
    const res = await client.signAndBroadcast(sender, messages, fee, memo)
    if (res.code !== 0) {
      throw new Error(res.rawLog || `Transaction failed (code ${res.code})`)
    }
    return res.transactionHash
  } finally {
    client.disconnect()
  }
}

/** Bank MsgSend encode object. */
export function sendMsg(sender: string, recipient: string, amount: string, denom: string): EncodeObject {
  return {
    typeUrl: '/cosmos.bank.v1beta1.MsgSend',
    value: {
      fromAddress: sender,
      toAddress: recipient,
      amount: [{ denom, amount }],
    },
  }
}
