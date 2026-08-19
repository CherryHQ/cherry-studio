import { toAttemptId } from '@shared/ai/attempt'
import { describe, expect, it } from 'vitest'

import {
  type ChunkArrival,
  type ClientArrival,
  createTopicStreamClientState,
  reduceTopicStreamClient,
  type TopicStreamClientState
} from '../topicStreamClientState'

const chunk = (overrides: Partial<ChunkArrival> = {}): ChunkArrival => ({
  kind: 'chunk',
  cycleId: 1,
  attemptId: toAttemptId(1),
  chunkSeq: 1,
  throughChunkSeq: 1,
  synthetic: false,
  live: true,
  ...overrides
})

const apply = (state: TopicStreamClientState, ...arrivals: ClientArrival[]): TopicStreamClientState =>
  arrivals.reduce((current, arrival) => reduceTopicStreamClient(current, arrival).state, state)

describe('reduceTopicStreamClient', () => {
  it('drops everything from a cycle Main has already moved past', () => {
    const state = apply(createTopicStreamClientState(), chunk({ cycleId: 2 }))

    const stale = reduceTopicStreamClient(state, chunk({ cycleId: 1, chunkSeq: 9, throughChunkSeq: 9 }))

    expect(stale.accepted).toBe(false)
    expect(stale.rejection).toBe('stale-cycle')
    expect(stale.state).toBe(state)
  })

  it('retires older-cycle branches and restarts cursors when a newer cycle opens', () => {
    const state = apply(createTopicStreamClientState(), chunk({ cycleId: 1, chunkSeq: 5, throughChunkSeq: 5 }))

    const advanced = reduceTopicStreamClient(state, chunk({ cycleId: 2, chunkSeq: 1, throughChunkSeq: 1 }))

    expect(advanced.accepted).toBe(true)
    expect(advanced.effects).toContainEqual({ type: 'retire-stale-branches', cycleId: 2 })
    // Sequence numbers restart per cycle, so a cursor carried across would swallow the new turn.
    expect(advanced.state.chunkCursors.get(toAttemptId(1))).toBe(1)
    expect(advanced.state.controlRevision).toBe(0)
  })

  it('ignores a replayed chunk range that is entirely consumed', () => {
    const state = apply(createTopicStreamClientState(), chunk({ chunkSeq: 1, throughChunkSeq: 4 }))

    const replay = reduceTopicStreamClient(state, chunk({ chunkSeq: 2, throughChunkSeq: 3 }))

    expect(replay.accepted).toBe(false)
    expect(replay.rejection).toBe('already-consumed')
  })

  it('drops a partially overlapping range rather than double-applying its overlap', () => {
    const state = apply(createTopicStreamClientState(), chunk({ chunkSeq: 1, throughChunkSeq: 4 }))

    const overlapping = reduceTopicStreamClient(state, chunk({ chunkSeq: 3, throughChunkSeq: 6 }))

    expect(overlapping.accepted).toBe(false)
    expect(overlapping.rejection).toBe('overlapping-range')
    expect(overlapping.state.chunkCursors.get(toAttemptId(1))).toBe(4)
  })

  it('keeps per-attempt cursors independent so a chatty model cannot mask a quiet one', () => {
    const state = apply(
      createTopicStreamClientState(),
      chunk({ attemptId: toAttemptId(1), chunkSeq: 1, throughChunkSeq: 9 })
    )

    const other = reduceTopicStreamClient(state, chunk({ attemptId: toAttemptId(2), chunkSeq: 1, throughChunkSeq: 1 }))

    expect(other.accepted).toBe(true)
    expect(other.state.chunkCursors.get(toAttemptId(2))).toBe(1)
  })

  it('reports the topic open exactly once, on the first live chunk', () => {
    const first = reduceTopicStreamClient(createTopicStreamClientState(), chunk())
    expect(first.effects).toContainEqual({ type: 'topic-state-changed', topicOpen: true })

    const second = reduceTopicStreamClient(first.state, chunk({ chunkSeq: 2, throughChunkSeq: 2 }))
    expect(second.accepted).toBe(true)
    expect(second.effects).not.toContainEqual({ type: 'topic-state-changed', topicOpen: true })
  })

  it('does not open the topic on replayed history', () => {
    const replayed = reduceTopicStreamClient(createTopicStreamClientState(), chunk({ live: false }))

    expect(replayed.accepted).toBe(true)
    expect(replayed.state.topicOpen).toBe(false)
  })

  it('lets a synthetic replay chunk through without touching the cursor', () => {
    const state = apply(createTopicStreamClientState(), chunk({ chunkSeq: 1, throughChunkSeq: 4 }))

    const synthetic = reduceTopicStreamClient(
      state,
      chunk({ synthetic: true, live: false, chunkSeq: 0, throughChunkSeq: 0 })
    )

    expect(synthetic.accepted).toBe(true)
    expect(synthetic.state.chunkCursors.get(toAttemptId(1))).toBe(4)
  })

  it('ignores a control event whose revision is not newer', () => {
    const state = reduceTopicStreamClient(createTopicStreamClientState(), {
      kind: 'control',
      cycleId: 1,
      controlRevision: 5
    }).state

    const replayed = reduceTopicStreamClient(state, { kind: 'control', cycleId: 1, controlRevision: 5 })

    expect(replayed.accepted).toBe(false)
    expect(replayed.rejection).toBe('stale-revision')
  })

  it('adopts a snapshot without rewinding a cursor the live stream already advanced', () => {
    const state = apply(createTopicStreamClientState(), chunk({ chunkSeq: 1, throughChunkSeq: 7 }))

    const snapshot = reduceTopicStreamClient(state, {
      kind: 'snapshot',
      cycleId: 1,
      controlRevision: 3,
      cursors: [{ attemptId: toAttemptId(1), throughChunkSeq: 2 }]
    })

    expect(snapshot.accepted).toBe(true)
    expect(snapshot.state.chunkCursors.get(toAttemptId(1))).toBe(7)
    expect(snapshot.state.controlRevision).toBe(3)
  })
})
