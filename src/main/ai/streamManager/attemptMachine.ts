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
  /** Terminal write not yet durable. Keeps the ORIGINAL outcome so recovery can replay the
   *  real terminal (a transient DB failure must not demote a successful reply to error);
   *  the persistence failure itself lives in `persistError`. */
  | {
      phase: 'persistence-blocked'
      firstChunkAt: number | null
      outcome: AttemptOutcome
      persistError: SerializedError
    }
  | { phase: 'settled'; firstChunkAt: number | null; outcome: AttemptOutcome }
  /** Stop gave up on a blocked write. Retains the ORIGINAL outcome (P1); `persistError` is what
   *  gets published, so renderer and boot-reconcile converge on the same terminal. */
  | {
      phase: 'abandoned'
      firstChunkAt: number | null
      outcome: AttemptOutcome
      persistError: SerializedError
    }

export type AttemptEvent =
  | { type: 'launch' }
  | { type: 'reservation-failed'; error: SerializedError; durableErrorWritten: boolean }
  | { type: 'chunk'; at: number }
  | { type: 'complete' }
  | { type: 'fail'; error: SerializedError }
  | { type: 'abort'; reason: string }
  | { type: 'persisted' }
  | { type: 'persist-failed'; error: SerializedError; durableErrorWritten: boolean }
  /** Explicit user give-up on a blocked terminal write (Stop). Settles as error(persistError). */
  | { type: 'abandon' }
  | { type: 'approval-changed'; pending: boolean }

export type TransitionResult = { ok: true; state: AttemptState } | { ok: false; kind: 'illegal' | 'stale' }

export type StreamLifecycleState = 'active' | 'grace' | 'evicted'

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
      if (event.type === 'abort') {
        return {
          ok: true,
          state: { phase: 'finalizing', firstChunkAt: null, outcome: { kind: 'aborted', reason: event.reason } }
        }
      }
      if (event.type === 'reservation-failed') {
        const outcome = { kind: 'error' as const, error: event.error }
        return {
          ok: true,
          state: event.durableErrorWritten
            ? { phase: 'settled', firstChunkAt: null, outcome }
            : { phase: 'persistence-blocked', firstChunkAt: null, outcome, persistError: event.error }
        }
      }
      return illegal()
    case 'running':
      switch (event.type) {
        case 'chunk':
          if (state.firstChunkAt !== null) return { ok: true, state }
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
        case 'reservation-failed':
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
          // Durable error marker written → the DB already says error, runtime must match.
          // Not durable → keep the original outcome; only the write is blocked, not the turn.
          return {
            ok: true,
            state: event.durableErrorWritten
              ? {
                  phase: 'settled',
                  firstChunkAt: state.firstChunkAt,
                  outcome: { kind: 'error', error: event.error }
                }
              : {
                  phase: 'persistence-blocked',
                  firstChunkAt: state.firstChunkAt,
                  outcome: state.outcome,
                  persistError: event.error
                }
          }
        case 'approval-changed':
          return { ok: true, state }
        case 'launch':
        case 'reservation-failed':
        case 'chunk':
        case 'complete':
        case 'fail':
        case 'abort':
          return stale()
        case 'abandon':
          return illegal()
      }
      return illegal()
    case 'persistence-blocked':
      switch (event.type) {
        case 'persisted':
          return { ok: true, state: { phase: 'settled', firstChunkAt: state.firstChunkAt, outcome: state.outcome } }
        case 'persist-failed':
          return {
            ok: true,
            state: event.durableErrorWritten
              ? {
                  phase: 'settled',
                  firstChunkAt: state.firstChunkAt,
                  outcome: { kind: 'error', error: event.error }
                }
              : {
                  phase: 'persistence-blocked',
                  firstChunkAt: state.firstChunkAt,
                  outcome: state.outcome,
                  persistError: event.error
                }
          }
        case 'abandon':
          return {
            ok: true,
            state: {
              phase: 'abandoned',
              firstChunkAt: state.firstChunkAt,
              outcome: state.outcome,
              persistError: state.persistError
            }
          }
        case 'approval-changed':
          return { ok: true, state }
        case 'launch':
        case 'reservation-failed':
        case 'chunk':
        case 'complete':
        case 'fail':
        case 'abort':
          return stale()
      }
      return illegal()
    case 'settled':
    case 'abandoned':
      return stale()
  }
}

/**
 * What consumers publish for an attempt. An abandoned attempt publishes its persistence error
 * rather than its retained runtime outcome, because boot reconcile will durably write that error
 * for the row Stop left `pending`.
 */
export function publishedOutcome(state: Exclude<AttemptState, { phase: 'reserved' | 'running' }>): AttemptOutcome {
  return state.phase === 'abandoned' ? { kind: 'error', error: state.persistError } : state.outcome
}

export function executionStatus(state: AttemptState): ExecutionStatus {
  if (state.phase === 'reserved' || state.phase === 'running') return 'streaming'
  const outcome = publishedOutcome(state)
  if (outcome.kind === 'done') return 'done'
  if (outcome.kind === 'error') return 'error'
  return 'aborted'
}

export function isAttemptRunning(state: AttemptState): boolean {
  return state.phase === 'running'
}

/** Both durability terminals. An abandoned attempt holds no in-flight work, so it lets a topic quiesce. */
export function isAttemptSettled(
  state: AttemptState
): state is Extract<AttemptState, { phase: 'settled' | 'abandoned' }> {
  return state.phase === 'settled' || state.phase === 'abandoned'
}

export function reduceTopicStatus(attempts: ReadonlyArray<AttemptStatusInput>): TopicStreamStatus {
  const unsettled = attempts.filter(({ state }) => !isAttemptSettled(state))
  if (unsettled.length > 0) {
    const hasFirstChunk = attempts.some(({ state }) => state.phase !== 'reserved' && state.firstChunkAt !== null)
    return hasFirstChunk ? 'streaming' : 'pending'
  }

  if (attempts.some(({ pendingApprovals }) => pendingApprovals.size > 0)) return 'awaiting-approval'
  const outcomes = attempts.flatMap(({ state }) =>
    state.phase === 'reserved' || state.phase === 'running' ? [] : [publishedOutcome(state)]
  )
  if (outcomes.length === 0) return 'error'
  if (outcomes.some((outcome) => outcome.kind === 'error')) return 'error'
  if (outcomes.every((outcome) => outcome.kind === 'aborted')) return 'aborted'
  return 'done'
}
