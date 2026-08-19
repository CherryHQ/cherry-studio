import type { AttemptId } from '@shared/ai/attempt'

/**
 * The renderer's view of one topic's protocol stream: which cycle it is following, how far each
 * attempt's chunks have been consumed, and whether the topic is live.
 *
 * Pure. Branches, stream controllers, and listeners stay in the subscription — this decides
 * *whether* an event counts, never what to do with its payload.
 */
export interface TopicStreamClientState {
  readonly cycleId?: number
  readonly controlRevision: number
  readonly chunkCursors: ReadonlyMap<AttemptId, number>
  readonly topicOpen: boolean
}

export interface ChunkArrival {
  readonly kind: 'chunk'
  readonly cycleId: number
  readonly attemptId: AttemptId
  readonly chunkSeq: number
  readonly throughChunkSeq: number
  /** Snapshot replay of a synthesized chunk bypasses cursor accounting entirely. */
  readonly synthetic: boolean
  readonly live: boolean
}

export interface ControlArrival {
  readonly kind: 'control'
  readonly cycleId: number
  readonly controlRevision: number
}

export interface SnapshotArrival {
  readonly kind: 'snapshot'
  readonly cycleId: number
  readonly controlRevision: number
  readonly cursors: ReadonlyArray<{ attemptId: AttemptId; throughChunkSeq: number }>
}

export type ClientArrival = ChunkArrival | ControlArrival | SnapshotArrival

export type ClientRejection = 'stale-cycle' | 'already-consumed' | 'overlapping-range' | 'stale-revision'

/**
 * `retire-stale-branches` fires on a cycle advance: branches classified to an older cycle are dead
 * authority. Unclassified branches are this cycle's own not-yet-evidenced registrations and survive.
 */
export type ClientEffect =
  | { type: 'retire-stale-branches'; cycleId: number }
  | { type: 'reset-quiescence' }
  | { type: 'topic-state-changed'; topicOpen: boolean }

export interface ClientTransition {
  readonly state: TopicStreamClientState
  readonly effects: readonly ClientEffect[]
  readonly accepted: boolean
  readonly rejection?: ClientRejection
}

export function createTopicStreamClientState(): TopicStreamClientState {
  return { controlRevision: 0, chunkCursors: new Map(), topicOpen: false }
}

const reject = (state: TopicStreamClientState, rejection: ClientRejection): ClientTransition => ({
  state,
  effects: [],
  accepted: false,
  rejection
})

/**
 * Fold a cycle advance into the state, or report that the arrival belongs to a dead cycle.
 * Returns `undefined` when the arrival is stale and must be dropped whole.
 */
function advanceCycle(
  state: TopicStreamClientState,
  cycleId: number
): { state: TopicStreamClientState; effects: ClientEffect[] } | undefined {
  if (state.cycleId !== undefined && cycleId < state.cycleId) return undefined
  if (state.cycleId !== undefined && cycleId === state.cycleId) return { state, effects: [] }
  return {
    // A newer cycle resets every per-cycle cursor: revisions and chunk sequences restart at Main.
    state: { ...state, cycleId, controlRevision: 0, chunkCursors: new Map() },
    effects: [{ type: 'retire-stale-branches', cycleId }, { type: 'reset-quiescence' }]
  }
}

export function reduceTopicStreamClient(state: TopicStreamClientState, arrival: ClientArrival): ClientTransition {
  const advanced = advanceCycle(state, arrival.cycleId)
  if (!advanced) return reject(state, 'stale-cycle')
  let next = advanced.state
  const effects = [...advanced.effects]

  if (arrival.kind === 'snapshot') {
    const chunkCursors = new Map(next.chunkCursors)
    for (const { attemptId, throughChunkSeq } of arrival.cursors) {
      chunkCursors.set(attemptId, Math.max(chunkCursors.get(attemptId) ?? 0, throughChunkSeq))
    }
    return {
      state: { ...next, controlRevision: arrival.controlRevision, chunkCursors },
      effects,
      accepted: true
    }
  }

  if (arrival.kind === 'control') {
    // Control revisions are monotonic within a cycle; a replayed or reordered one is not news.
    if (arrival.controlRevision <= next.controlRevision) return reject(next, 'stale-revision')
    return { state: { ...next, controlRevision: arrival.controlRevision }, effects, accepted: true }
  }

  if (arrival.synthetic) return { state: next, effects, accepted: true }

  const cursor = next.chunkCursors.get(arrival.attemptId) ?? 0
  if (arrival.throughChunkSeq <= cursor) return reject(next, 'already-consumed')
  // A range that starts at or before the cursor but ends after it would double-apply its overlap.
  if (arrival.chunkSeq <= cursor) return reject(next, 'overlapping-range')

  const chunkCursors = new Map(next.chunkCursors)
  chunkCursors.set(arrival.attemptId, arrival.throughChunkSeq)
  next = { ...next, chunkCursors }

  if (arrival.live) {
    if (!next.topicOpen) {
      next = { ...next, topicOpen: true }
      effects.push({ type: 'topic-state-changed', topicOpen: true })
    }
    effects.push({ type: 'reset-quiescence' })
  }
  return { state: next, effects, accepted: true }
}
