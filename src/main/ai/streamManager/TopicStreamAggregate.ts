import type { AttemptId } from '@shared/ai/attempt'
import type { TopicStreamStatus } from '@shared/ai/transport'

import {
  type AttemptEvent,
  type AttemptState,
  reduceTopicStatus,
  type StreamLifecycleState,
  transition,
  type TransitionResult
} from './attemptMachine'

export interface TopicAttempt {
  readonly id: AttemptId
  state: AttemptState
  readonly pendingApprovalToolCallIds: Set<string>
}

export type ContinuationPhase = 'queued' | 'eligible' | 'dispatching' | 'consumed' | 'failed' | 'dropped'

interface TopicContinuation {
  readonly id: string
  phase: ContinuationPhase
}

/**
 * Synchronous state owner for one topic stream cycle. Runtime resources stay in
 * AiStreamManager; every attempt, approval, and lifecycle mutation goes through here.
 */
export class TopicStreamAggregate {
  readonly topicId: string
  readonly cycleId: number
  private readonly attempts = new Map<AttemptId, TopicAttempt>()
  private readonly continuations = new Map<string, TopicContinuation>()
  private lifecycle: StreamLifecycleState = 'active'
  private terminalOverride?: 'error' | 'aborted'
  private commandDepth = 0
  private revision = 0

  constructor(topicId: string, cycleId = 1) {
    this.topicId = topicId
    this.cycleId = cycleId
  }

  get controlRevision(): number {
    return this.revision
  }

  get lifecycleState(): StreamLifecycleState {
    return this.lifecycle
  }

  issueControlRevision(): number {
    this.touch()
    return this.revision
  }

  reserveAttempt(id: AttemptId): TopicAttempt {
    if (this.attempts.has(id)) throw new Error(`Attempt ${id} is already reserved for topic ${this.topicId}`)
    const attempt: TopicAttempt = { id, state: { phase: 'reserved' }, pendingApprovalToolCallIds: new Set() }
    this.attempts.set(id, attempt)
    this.terminalOverride = undefined
    this.touch()
    return attempt
  }

  transitionAttempt(id: AttemptId, event: AttemptEvent): TransitionResult {
    const attempt = this.attempts.get(id)
    if (!attempt) return { ok: false, kind: 'stale' }
    const result = transition(attempt.state, event)
    if (result.ok) {
      if (attempt.state !== result.state) {
        attempt.state = result.state
        this.touch()
      }
    }
    return result
  }

  attemptState(id: AttemptId): AttemptState | undefined {
    return this.attempts.get(id)?.state
  }

  attempt(id: AttemptId): TopicAttempt | undefined {
    return this.attempts.get(id)
  }

  hasUnsettledAttempts(): boolean {
    return [...this.attempts.values()].some((attempt) => attempt.state.phase !== 'settled')
  }

  forgetAttempt(id: AttemptId): void {
    if (this.attempts.delete(id)) this.touch()
  }

  setApprovalPending(id: AttemptId, toolCallId: string, pending: boolean): boolean {
    const attempt = this.attempts.get(id)
    if (!attempt) return false
    const hadPending = attempt.pendingApprovalToolCallIds.size > 0
    const size = attempt.pendingApprovalToolCallIds.size
    if (pending) attempt.pendingApprovalToolCallIds.add(toolCallId)
    else attempt.pendingApprovalToolCallIds.delete(toolCallId)
    if (attempt.pendingApprovalToolCallIds.size !== size) this.touch()
    return hadPending !== attempt.pendingApprovalToolCallIds.size > 0
  }

  clearApprovals(id: AttemptId): boolean {
    const attempt = this.attempts.get(id)
    if (!attempt?.pendingApprovalToolCallIds.size) return false
    attempt.pendingApprovalToolCallIds.clear()
    this.touch()
    return true
  }

  activate(): void {
    if (this.lifecycle === 'active') return
    this.lifecycle = 'active'
    this.touch()
  }

  beginGrace(): void {
    if (this.lifecycle === 'grace') return
    this.lifecycle = 'grace'
    this.touch()
  }

  evict(): void {
    this.lifecycle = 'evicted'
    this.attempts.clear()
    this.continuations.clear()
    this.touch()
  }

  status(): TopicStreamStatus {
    const status = reduceTopicStatus(
      [...this.attempts.values()].map((attempt) => ({
        state: attempt.state,
        pendingApprovals: attempt.pendingApprovalToolCallIds
      }))
    )
    if (status === 'pending' || status === 'streaming' || status === 'awaiting-approval') return status
    if (this.hasBlockingContinuation()) return 'streaming'
    return this.terminalOverride ?? status
  }

  isQuiescent(): boolean {
    return this.commandDepth === 0 && this.areAttemptsDurablySettled() && !this.hasBlockingContinuation()
  }

  runCommand<T>(command: () => T): T {
    this.commandDepth += 1
    try {
      return command()
    } finally {
      this.commandDepth -= 1
    }
  }

  areAttemptsDurablySettled(): boolean {
    if (this.attempts.size === 0) return false
    return [...this.attempts.values()].every(
      (attempt) => attempt.state.phase === 'settled' && attempt.pendingApprovalToolCallIds.size === 0
    )
  }

  runtimeOutcome(): Exclude<TopicStreamStatus, 'pending' | 'streaming'> | undefined {
    const attempts = [...this.attempts.values()]
    if (
      attempts.length === 0 ||
      attempts.some((attempt) => attempt.state.phase === 'reserved' || attempt.state.phase === 'running')
    ) {
      return undefined
    }
    if (attempts.some((attempt) => attempt.pendingApprovalToolCallIds.size > 0)) return 'awaiting-approval'
    if (this.terminalOverride) return this.terminalOverride

    const outcomes = attempts.map((attempt) => {
      if (
        attempt.state.phase === 'finalizing' ||
        attempt.state.phase === 'persistence-blocked' ||
        attempt.state.phase === 'settled'
      ) {
        return attempt.state.outcome
      }
      throw new Error(`Attempt ${attempt.id} has no runtime outcome`)
    })
    if (outcomes.some((outcome) => outcome.kind === 'error')) return 'error'
    if (outcomes.every((outcome) => outcome.kind === 'aborted')) return 'aborted'
    return 'done'
  }

  queueContinuation(id: string): void {
    if (this.continuations.has(id)) return
    this.continuations.set(id, { id, phase: 'queued' })
    this.touch()
  }

  makeContinuationEligible(id: string): boolean {
    return this.transitionContinuation(id, 'queued', 'eligible')
  }

  startContinuation(id: string): boolean {
    return this.transitionContinuation(id, 'eligible', 'dispatching')
  }

  finishContinuation(id: string, phase: Extract<ContinuationPhase, 'consumed' | 'failed' | 'dropped'>): boolean {
    if (!this.transitionContinuation(id, 'dispatching', phase)) return false
    if (phase === 'failed') this.terminalOverride = 'error'
    if (phase === 'dropped') this.terminalOverride = 'aborted'
    return true
  }

  terminateContinuation(id: string, outcome: 'error' | 'aborted'): boolean {
    const continuation = this.continuations.get(id)
    if (
      !continuation ||
      continuation.phase === 'consumed' ||
      continuation.phase === 'failed' ||
      continuation.phase === 'dropped'
    ) {
      return false
    }
    continuation.phase = outcome === 'error' ? 'failed' : 'dropped'
    this.terminalOverride = outcome
    this.touch()
    return true
  }

  hasBlockingContinuation(): boolean {
    return [...this.continuations.values()].some(
      (continuation) =>
        continuation.phase === 'queued' || continuation.phase === 'eligible' || continuation.phase === 'dispatching'
    )
  }

  dispatchingContinuationId(): string | undefined {
    return [...this.continuations.values()].find((continuation) => continuation.phase === 'dispatching')?.id
  }

  continuationPhase(id: string): ContinuationPhase | undefined {
    return this.continuations.get(id)?.phase
  }

  attemptWatermark(): number {
    let watermark = 0
    for (const attempt of this.attempts.values()) watermark = Math.max(watermark, attempt.id)
    return watermark
  }

  private transitionContinuation(id: string, from: ContinuationPhase, to: ContinuationPhase): boolean {
    const continuation = this.continuations.get(id)
    if (!continuation || continuation.phase !== from) return false
    continuation.phase = to
    this.touch()
    return true
  }

  private touch(): void {
    this.revision += 1
  }
}
