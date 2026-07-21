import { useState } from 'react'
import type { OfflineDirectSigner, EncodeObject } from '@cosmjs/proto-signing'
import type { ChainInfo } from '../chains'
import { simulateTx, broadcastTx, type FeeEstimate } from './tx'
import TxReview, { type ReviewRow } from '../components/TxReview'

export interface PlanInput {
  chain: ChainInfo
  signer: OfflineDirectSigner
  sender: string
  messages: EncodeObject[]
  memo: string
  buildRows: (est: FeeEstimate) => ReviewRow[]
  warning?: string
  confirmLabel: string
  onDone: (hash: string) => void
  onError: (msg: string) => void
}

/** Type of the `prepare` function returned by useTxReview (for passing as a prop). */
export type Prepare = (input: PlanInput) => Promise<void>

/**
 * Shared simulate -> review -> confirm -> broadcast flow. Call `prepare()` after
 * building the signer + messages: it simulates (real fee) and opens the review.
 * Render `modal` in the component. The signer is held only while the review is
 * open and dropped on confirm/cancel.
 */
export function useTxReview() {
  const [plan, setPlan] = useState<(PlanInput & { est: FeeEstimate }) | null>(null)
  const [confirming, setConfirming] = useState(false)

  async function prepare(input: PlanInput): Promise<void> {
    const est = await simulateTx(input.chain, input.signer, input.sender, input.messages, input.memo)
    setPlan({ ...input, est })
  }

  async function confirm(): Promise<void> {
    if (!plan) return
    setConfirming(true)
    try {
      const hash = await broadcastTx(
        plan.chain,
        plan.signer,
        plan.sender,
        plan.messages,
        plan.est.fee,
        plan.memo,
      )
      const done = plan.onDone
      setPlan(null)
      done(hash)
    } catch (e) {
      plan.onError(e instanceof Error ? e.message : 'Transaction failed')
      setPlan(null)
    } finally {
      setConfirming(false)
    }
  }

  const modal = plan ? (
    <TxReview
      rows={plan.buildRows(plan.est)}
      warning={plan.warning}
      confirmLabel={plan.confirmLabel}
      busy={confirming}
      onConfirm={confirm}
      onClose={() => (confirming ? undefined : setPlan(null))}
    />
  ) : null

  return { prepare, modal, reviewing: !!plan }
}
