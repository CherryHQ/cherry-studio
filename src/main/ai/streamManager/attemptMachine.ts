import type { TopicStreamStatus } from '@shared/ai/transport'
import type { SerializedError } from '@shared/types/error'

export type AttemptOutcome =
  | { kind: 'done' }
  | { kind: 'error'; error: SerializedError }
  | { kind: 'aborted'; reason: string }

export type AttemptState =
  | { phase: 'reserved' }
  | { phase: 'running'; firstChunkAt: number | null }
  | { phase: 'finalizing'; firstChunkAt: number | null; outcome: AttemptOutcome }
  | { phase: 'settled'; firstChunkAt: number | null; outcome: AttemptOutcome }

export type AttemptEvent =
  | { type: 'launch' }
  | { type: 'chunk'; at: number }
  | { type: 'complete' }
  | { type: 'fail'; error: SerializedError }
  | { type: 'abort'; reason: string }
  | { type: 'persisted' }
  | { type: 'persist-failed'; error: SerializedError }
  | { type: 'approval-changed'; pending: boolean }

export type TransitionResult = { ok: true; state: AttemptState } | { ok: false; kind: 'illegal' | 'stale' }

export type StreamLifecycleState = 'active' | 'held' | 'grace' | 'evicted'

export interface AttemptStatusInput {
  state: AttemptState
  pendingApprovals: ReadonlySet<string>
}

export type ExecutionStatus = 'streaming' | 'done' | 'error' | 'aborted'

const illegal = (): TransitionResult => ({ ok: false, kind: 'illegal' })
const stale = (): TransitionResult => ({ ok: false, kind: 'stale' })

export function transition(state: AttemptState, event: AttemptEvent): TransitionResult {
  switch (state.phase) {
    case 'reserved':
      if (event.type === 'launch') return { ok: true, state: { phase: 'running', firstChunkAt: null } }
      return illegal()
    case 'running':
      switch (event.type) {
        case 'chunk':
          return {
            ok: true,
            state: { phase: 'running', firstChunkAt: state.firstChunkAt ?? event.at }
          }
        case 'complete':
          return {
            ok: true,
            state: { phase: 'finalizing', firstChunkAt: state.firstChunkAt, outcome: { kind: 'done' } }
          }
        case 'fail':
          return {
            ok: true,
            state: {
              phase: 'finalizing',
              firstChunkAt: state.firstChunkAt,
              outcome: { kind: 'error', error: event.error }
            }
          }
        case 'abort':
          return {
            ok: true,
            state: {
              phase: 'finalizing',
              firstChunkAt: state.firstChunkAt,
              outcome: { kind: 'aborted', reason: event.reason }
            }
          }
        case 'approval-changed':
          return { ok: true, state }
        case 'launch':
        case 'persisted':
        case 'persist-failed':
          return illegal()
      }
      return illegal()
    case 'finalizing':
      switch (event.type) {
        case 'persisted':
          return { ok: true, state: { phase: 'settled', firstChunkAt: state.firstChunkAt, outcome: state.outcome } }
        case 'persist-failed':
          return {
            ok: true,
            state: {
              phase: 'settled',
              firstChunkAt: state.firstChunkAt,
              outcome: { kind: 'error', error: event.error }
            }
          }
        case 'approval-changed':
          return { ok: true, state }
        case 'launch':
        case 'chunk':
        case 'complete':
        case 'fail':
        case 'abort':
          return stale()
      }
      return illegal()
    case 'settled':
      return stale()
  }
}

export function executionStatus(state: AttemptState): ExecutionStatus {
  if (state.phase === 'reserved' || state.phase === 'running') return 'streaming'
  if (state.outcome.kind === 'done') return 'done'
  if (state.outcome.kind === 'error') return 'error'
  return 'aborted'
}

export function isAttemptRunning(state: AttemptState): boolean {
  return state.phase === 'running'
}

export function isAttemptSettled(state: AttemptState): boolean {
  return state.phase === 'settled'
}

export function reduceTopicStatus(
  attempts: ReadonlyArray<AttemptStatusInput>,
  lifecycle: Exclude<StreamLifecycleState, 'evicted'>
): TopicStreamStatus {
  if (attempts.some(({ state }) => state.phase === 'reserved')) return 'pending'

  const running = attempts.filter(({ state }) => state.phase === 'running')
  if (running.length > 0) {
    const hasFirstChunk = attempts.some(({ state }) => state.phase !== 'reserved' && state.firstChunkAt !== null)
    return hasFirstChunk ? 'streaming' : 'pending'
  }

  if (attempts.some(({ pendingApprovals }) => pendingApprovals.size > 0)) return 'awaiting-approval'
  if (lifecycle === 'held') return 'streaming'

  const outcomes = attempts.flatMap(({ state }) =>
    state.phase === 'finalizing' || state.phase === 'settled' ? [state.outcome] : []
  )
  if (outcomes.length === 0) return 'error'
  if (outcomes.some((outcome) => outcome.kind === 'error')) return 'error'
  if (outcomes.every((outcome) => outcome.kind === 'aborted')) return 'aborted'
  return 'done'
}
