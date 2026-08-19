import type { AttemptId } from '@shared/ai/attempt'
import type { TopicStreamStatus } from '@shared/ai/transport'

import {
  type AttemptEvent,
  type AttemptState,
  type StreamLifecycleState,
  transition,
  type TransitionResult
} from './attemptMachine'
import {
  areAttemptsDurablySettled,
  attemptWatermark,
  type ContinuationLeaseId,
  type ContinuationReleaseReason,
  createTopicStreamState,
  hasOpenLease,
  hasPendingApprovals,
  hasPersistenceBlockedAttempts,
  hasUnsettledAttempts,
  isQuiescent,
  reduceTopicStream,
  runtimeOutcome,
  type TopicAttemptState,
  type TopicCommandRejection,
  type TopicContinuationLease,
  topicStatus,
  type TopicStreamCommand,
  type TopicStreamEvent,
  type TopicStreamFlagEffect,
  type TopicStreamState
} from './topicStreamState'

declare const preparedTopicCommitBrand: unique symbol

/** Opaque outside this module. Must be committed before the current synchronous section returns. */
export interface PreparedTopicCommit {
  readonly [preparedTopicCommitBrand]: true
  readonly topicId: string
  readonly cycleId: number
  readonly expectedRevision: number
  readonly nextState: TopicStreamState
  readonly events: readonly TopicStreamEvent[]
  readonly effects: readonly TopicStreamFlagEffect[]
  readonly changed: boolean
  readonly rejection?: TopicCommandRejection
}

export interface TopicCommitReceipt {
  readonly topicId: string
  readonly cycleId: number
  readonly previousRevision: number
  readonly revision: number
  readonly events: readonly TopicStreamEvent[]
}

/** Applies a resource-flag effect. MUST be synchronous — see T8 in the runtime-rework plan. */
export type TopicFlagEffectSink = (effect: TopicStreamFlagEffect) => void

export class StaleTopicCommitError extends Error {
  constructor(topicId: string, expected: number, actual: number) {
    super(`Prepared commit for topic ${topicId} expected revision ${expected} but found ${actual}`)
    this.name = 'StaleTopicCommitError'
  }
}

/**
 * Synchronous state owner for one topic stream cycle. Runtime resources stay in AiStreamManager;
 * every attempt, approval, lease, and lifecycle change goes through `reduceTopicStream`.
 */
export class TopicStreamAggregate {
  readonly topicId: string
  readonly cycleId: number
  private current: TopicStreamState
  private effectSink?: TopicFlagEffectSink

  constructor(topicId: string, cycleId = 1) {
    this.topicId = topicId
    this.cycleId = cycleId
    this.current = createTopicStreamState(topicId, cycleId)
  }

  /** Installed once by the owning manager. Flag effects are applied before `commit` returns. */
  setFlagEffectSink(sink: TopicFlagEffectSink): void {
    this.effectSink = sink
  }

  snapshot(): TopicStreamState {
    return this.current
  }

  get controlRevision(): number {
    return this.current.revision
  }

  get lifecycleState(): StreamLifecycleState {
    return this.current.lifecycle
  }

  // ── Prepare / validate / commit ─────────────────────────────────────

  /** Pure. Returns a prepared commit pinned to the revision observed here (T3). */
  prepare(command: TopicStreamCommand): PreparedTopicCommit {
    const result = reduceTopicStream(this.current, command)
    return {
      topicId: this.topicId,
      cycleId: this.cycleId,
      expectedRevision: this.current.revision,
      nextState: result.state,
      events: result.events,
      effects: result.effects,
      changed: result.changed,
      rejection: result.rejection
    } as PreparedTopicCommit
  }

  /** Package-private: throws if the prepared commit no longer matches this aggregate. */
  validate(prepared: PreparedTopicCommit): void {
    if (prepared.topicId !== this.topicId || prepared.cycleId !== this.cycleId) {
      throw new StaleTopicCommitError(prepared.topicId, prepared.expectedRevision, this.current.revision)
    }
    if (prepared.expectedRevision !== this.current.revision) {
      throw new StaleTopicCommitError(this.topicId, prepared.expectedRevision, this.current.revision)
    }
  }

  /** Package-private: single-use revision CAS followed by synchronous flag-effect application. */
  commit(prepared: PreparedTopicCommit): TopicCommitReceipt {
    this.validate(prepared)
    const previousRevision = this.current.revision
    this.current = prepared.nextState
    // T8: flag effects land in the same synchronous turn as the commit that produced them.
    for (const effect of prepared.effects) this.effectSink?.(effect)
    return {
      topicId: this.topicId,
      cycleId: this.cycleId,
      previousRevision,
      revision: this.current.revision,
      events: prepared.events
    }
  }

  /** Prepare and commit one command with no observation gap. */
  private apply(command: TopicStreamCommand): TopicCommitReceipt {
    return this.commit(this.prepare(command))
  }

  // ── Attempts ────────────────────────────────────────────────────────

  issueControlRevision(): number {
    this.apply({ type: 'touch' })
    return this.current.revision
  }

  reserveAttempt(id: AttemptId): TopicAttemptState {
    const prepared = this.prepare({ type: 'reserve-attempt', attemptId: id })
    if (prepared.rejection === 'duplicate-attempt') {
      throw new Error(`Attempt ${id} is already reserved for topic ${this.topicId}`)
    }
    this.commit(prepared)
    const attempt = this.current.attempts.get(id)
    if (!attempt) throw new Error(`Attempt ${id} vanished during reservation for topic ${this.topicId}`)
    return attempt
  }

  transitionAttempt(id: AttemptId, event: AttemptEvent): TransitionResult {
    const prepared = this.prepare({ type: 'attempt-event', attemptId: id, event })
    if (prepared.rejection === 'unknown-attempt') return { ok: false, kind: 'stale' }
    if (prepared.rejection === 'invalid-attempt-state') return transition(this.current.attempts.get(id)!.state, event)
    this.commit(prepared)
    return { ok: true, state: this.current.attempts.get(id)!.state }
  }

  attemptState(id: AttemptId): AttemptState | undefined {
    return this.current.attempts.get(id)?.state
  }

  attempt(id: AttemptId): TopicAttemptState | undefined {
    return this.current.attempts.get(id)
  }

  forgetAttempt(id: AttemptId): void {
    this.apply({ type: 'forget-attempt', attemptId: id })
  }

  hasUnsettledAttempts(): boolean {
    return hasUnsettledAttempts(this.current)
  }

  hasPersistenceBlockedAttempts(): boolean {
    return hasPersistenceBlockedAttempts(this.current)
  }

  hasPendingApprovals(): boolean {
    return hasPendingApprovals(this.current)
  }

  areAttemptsDurablySettled(): boolean {
    return areAttemptsDurablySettled(this.current)
  }

  attemptWatermark(): number {
    return attemptWatermark(this.current)
  }

  // ── Approvals ───────────────────────────────────────────────────────

  setApprovalPending(id: AttemptId, toolCallId: string, pending: boolean): boolean {
    const receipt = this.apply({ type: 'approval-changed', attemptId: id, toolCallId, pending })
    return receipt.events.some((event) => event.type === 'approval-changed')
  }

  clearApprovals(id: AttemptId): boolean {
    const receipt = this.apply({ type: 'approvals-cleared', attemptId: id })
    return receipt.events.some((event) => event.type === 'approval-changed')
  }

  // ── Lifecycle ───────────────────────────────────────────────────────

  activate(): void {
    this.apply({ type: 'activate' })
  }

  beginGrace(): void {
    this.apply({ type: 'begin-grace' })
  }

  evict(): void {
    this.apply({ type: 'evict' })
  }

  status(): TopicStreamStatus {
    return topicStatus(this.current)
  }

  isQuiescent(): boolean {
    return isQuiescent(this.current)
  }

  runtimeOutcome(): Exclude<TopicStreamStatus, 'pending' | 'streaming'> | undefined {
    return runtimeOutcome(this.current)
  }

  // ── Continuation leases ─────────────────────────────────────────────

  openContinuationLease(
    id: ContinuationLeaseId,
    diagnosticOwner: 'agent-runtime' | 'chat-steer',
    voidOnAttemptError = false
  ): boolean {
    return (
      this.apply({ type: 'continuation-opened', leaseId: id, diagnosticOwner, voidOnAttemptError }).events.length > 0
    )
  }

  consumeContinuationLease(id: ContinuationLeaseId, attemptId: AttemptId): boolean {
    return this.apply({ type: 'continuation-consumed', leaseId: id, attemptId }).events.length > 0
  }

  releaseContinuationLease(id: ContinuationLeaseId, reason: ContinuationReleaseReason): boolean {
    return this.apply({ type: 'continuation-released', leaseId: id, reason }).events.length > 0
  }

  continuationLease(id: ContinuationLeaseId): TopicContinuationLease | undefined {
    return this.current.continuationLeases.get(id)
  }

  hasOpenContinuationLease(): boolean {
    return hasOpenLease(this.current)
  }

  openContinuationLeaseIds(): ContinuationLeaseId[] {
    return [...this.current.continuationLeases.values()]
      .filter((lease) => lease.state === 'open')
      .map((lease) => lease.id)
  }
}
