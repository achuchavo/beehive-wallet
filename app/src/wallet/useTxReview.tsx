import { useState } from 'react'
import type { OfflineDirectSigner, EncodeObject } from '@cosmjs/proto-signing'
import type { ChainInfo } from '../chains'
import { simulateTx, broadcastTx, lookupTx, type FeeEstimate, type BroadcastOutcome } from './tx'
import TxReview, { type ReviewRow } from '../components/TxReview'
import TxUnresolved from '../components/TxUnresolved'

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
  // Set when a broadcast could neither be confirmed nor ruled out.
  const [unresolved, setUnresolved] = useState<{ chain: ChainInfo; hash: string } | null>(null)

  async function prepare(input: PlanInput): Promise<void> {
    const est = await simulateTx(input.chain, input.signer, input.sender, input.messages, input.memo)
    setPlan({ ...input, est })
  }

  async function confirm(): Promise<void> {
    if (!plan) return
    setConfirming(true)
    try {
      const outcome: BroadcastOutcome = await broadcastTx(
        plan.chain,
        plan.signer,
        plan.sender,
        plan.messages,
        plan.est.fee,
        plan.memo,
      )

      if (outcome.status === 'success') {
        const done = plan.onDone
        setPlan(null)
        done(outcome.hash)
        return
      }

      if (outcome.status === 'rejected') {
        // The chain saw it and refused. Nothing was committed, so this is a
        // plain error and retrying after a fix is safe.
        plan.onError(outcome.rawLog || `Transaction failed (code ${outcome.code})`)
        setPlan(null)
        return
      }

      // Unknown: the node may have accepted it. Never report this as a simple
      // failure - that is what put a one-click retry in front of a possible
      // duplicate. Resolve it by asking the chain about the hash we already
      // computed from the signed bytes.
      const lookup = await lookupTx(plan.chain, outcome.hash)
      if (lookup.status === 'success') {
        const done = plan.onDone
        setPlan(null)
        done(outcome.hash)
        return
      }
      if (lookup.status === 'rejected') {
        plan.onError(lookup.rawLog || `Transaction failed (code ${lookup.code})`)
        setPlan(null)
        return
      }
      // Still unresolved. Hold the review open in an explicit unknown state so
      // the user gets the hash and a re-check, and no retry button.
      setUnresolved({ chain: plan.chain, hash: outcome.hash })
    } catch (e) {
      // Pre-submission failure - nothing was sent.
      plan.onError(e instanceof Error ? e.message : 'Transaction failed')
      setPlan(null)
    } finally {
      setConfirming(false)
    }
  }

  async function recheck(): Promise<void> {
    if (!unresolved) return
    setConfirming(true)
    try {
      const lookup = await lookupTx(unresolved.chain, unresolved.hash)
      if (lookup.status === 'success') {
        const done = plan?.onDone
        setUnresolved(null)
        setPlan(null)
        done?.(unresolved.hash)
      } else if (lookup.status === 'rejected') {
        plan?.onError(lookup.rawLog || `Transaction failed (code ${lookup.code})`)
        setUnresolved(null)
        setPlan(null)
      }
      // 'missing'/'unavailable': stay put. Still not safe to retry.
    } finally {
      setConfirming(false)
    }
  }

  const modal = unresolved ? (
    <TxUnresolved
      chain={unresolved.chain}
      hash={unresolved.hash}
      busy={confirming}
      onRecheck={recheck}
      onDismiss={() => {
        // Dismiss reports it upward as unresolved, NOT as a failure, so the
        // page does not render a retry affordance.
        plan?.onError('')
        setUnresolved(null)
        setPlan(null)
      }}
    />
  ) : plan ? (
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
