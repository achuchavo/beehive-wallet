import { SigningStargateClient, GasPrice, calculateFee } from '@cosmjs/stargate'
import { sha256 } from '@cosmjs/crypto'
import { toHex } from '@cosmjs/encoding'
import { TxRaw } from 'cosmjs-types/cosmos/tx/v1beta1/tx'
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

/**
 * What actually happened to a broadcast.
 *
 * The third case is the point of this type. signAndBroadcast() throws on a
 * timeout exactly as it throws on a malformed transaction, so the UI treated
 * "the node may well have accepted this" as a plain failure and offered a
 * retry button - one click from a duplicate send, delegation or claim.
 *
 * A transaction hash is deterministic over the SIGNED BYTES, so it is known
 * before the request leaves the browser. That is what makes an unknown outcome
 * actionable: we can always tell the user which transaction to go and look up.
 */
export type BroadcastOutcome =
  | { status: 'success'; hash: string; height: number }
  | { status: 'rejected'; hash: string; code: number; rawLog: string }
  | { status: 'unknown'; hash: string; message: string }

/** SHA-256 of the signed tx bytes, uppercase hex - the Tendermint tx hash. */
async function txHash(txBytes: Uint8Array): Promise<string> {
  return toHex(sha256(txBytes)).toUpperCase()
}

/**
 * Sign, then broadcast, reporting the outcome instead of throwing on ambiguity.
 *
 * Signing and broadcasting are separated so the hash exists before anything is
 * sent. Only genuinely pre-submission failures (wrong network, signing refused)
 * throw; once bytes are on the wire the result is always one of the three
 * outcomes above.
 */
export async function broadcastTx(
  chain: ChainInfo,
  signer: OfflineDirectSigner,
  sender: string,
  messages: EncodeObject[],
  fee: StdFee,
  memo = '',
): Promise<BroadcastOutcome> {
  assertChainConfigReady()
  const client = await connect(chain, signer)
  try {
    // Pre-submission. A failure here means nothing was sent, so throwing (and
    // letting the caller retry freely) is correct.
    await verifyNetwork(client, chain)
    const txRaw = await client.sign(sender, messages, fee, memo)
    const txBytes = TxRaw.encode(txRaw).finish()
    const hash = await txHash(txBytes)

    // Past this line the transaction may exist on chain no matter what we see.
    try {
      const res = await client.broadcastTx(txBytes)
      if (res.code === 0) {
        return { status: 'success', hash: res.transactionHash || hash, height: res.height ?? 0 }
      }
      // The chain answered and refused it. Nothing was committed, so a retry
      // after fixing the cause is safe.
      return {
        status: 'rejected',
        hash: res.transactionHash || hash,
        code: res.code,
        rawLog: res.rawLog ?? '',
      }
    } catch (e) {
      // Timeout, dropped connection, proxy 5xx. The node may have accepted it.
      return {
        status: 'unknown',
        hash,
        message: e instanceof Error ? e.message : 'Broadcast result unknown',
      }
    }
  } finally {
    client.disconnect()
  }
}

/**
 * Look up a transaction by hash. Used to resolve an unknown outcome before any
 * retry is offered.
 *
 * 'missing' means the chain has no such transaction *yet* - it is deliberately
 * distinct from 'rejected', because an unindexed or still-pending transaction
 * looks identical to one that never arrived, and treating those the same is
 * how a duplicate gets sent.
 */
export type TxLookup =
  | { status: 'success'; height: number }
  | { status: 'rejected'; code: number; rawLog: string }
  | { status: 'missing' }
  | { status: 'unavailable' }

export async function lookupTx(chain: ChainInfo, hash: string): Promise<TxLookup> {
  try {
    const res = await fetch(`${chain.lcd}/cosmos/tx/v1beta1/txs/${hash}`)
    if (res.status === 404) return { status: 'missing' }
    if (!res.ok) return { status: 'unavailable' }
    const data = await res.json()
    const r = data?.tx_response
    if (!r) return { status: 'missing' }
    const code = Number(r.code ?? 0)
    if (code === 0) return { status: 'success', height: Number(r.height ?? 0) }
    return { status: 'rejected', code, rawLog: String(r.raw_log ?? '') }
  } catch {
    return { status: 'unavailable' }
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
