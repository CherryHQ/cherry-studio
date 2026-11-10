import { describe, expect, it } from 'vitest'

import type { AgentRuntimeConnection } from '../../runtime/types'
import {
  createAgentSessionRuntimeState,
  getAgentSessionRuntimeCurrentTurn,
  getAgentSessionRuntimeNativeTurn,
  getAgentSessionRuntimeReply,
  getAgentSessionRuntimeOccupancy,
  isAgentSessionRuntimeBusy,
  transitionAgentSessionRuntime,
  willAgentSessionRuntimeContinue,
  type AgentSessionRuntimeStateEvent
} from '../agentSessionRuntimeState'

type Turn = { id: string }
const first = { id: 'first' }
const second = { id: 'second' }
const connection: AgentRuntimeConnection = {
  events: { async *[Symbol.asyncIterator]() {} },
  reconcile: async () => 'current',
  send: async () => {},
  close: async () => {}
}

/** `admitted: false` keeps the initial turn pending, for tests that own the submission handshake. */
function machine(initial: Turn | undefined = first, { admitted = true }: { admitted?: boolean } = {}) {
  let state = createAgentSessionRuntimeState<Turn, Turn>(initial)
  if (admitted && initial) {
    state = transitionAgentSessionRuntime(state, { type: 'turn-submitting', turn: initial }).state
    state = transitionAgentSessionRuntime(state, { type: 'turn-admitted', turn: initial }).state
  }
  const send = (event: AgentSessionRuntimeStateEvent<Turn, Turn>) => {
    const next = transitionAgentSessionRuntime(state, event)
    state = next.state
    return next.effects
  }
  return {
    get state() {
      return state
    },
    send,
    open: (turn: Turn) => send({ type: 'turn-stream-opened', turn }),
    /** The host's submission handshake: admission is only earned by a confirmed send. */
    admit: (turn: Turn) => {
      send({ type: 'turn-submitting', turn })
      send({ type: 'turn-admitted', turn })
    },
    finish: (turn: Turn) => send({ type: 'runtime-terminal', turn, outcome: { status: 'success' } }),
    persist: (turn: Turn) => send({ type: 'turn-terminal', turn, status: 'success' }),
    connect: () => {
      send({ type: 'connection-started', attemptId: 'connection' })
      send({ type: 'connection-connected', attemptId: 'connection', connection })
    },
    completeLaunch: () => {
      if (state.launch.kind !== 'idle') send({ type: 'launch-finished', target: state.launch.target })
    }
  }
}

describe('reply ownership and delivery', () => {
  it('keeps the session busy until persistence, then schedules the queued input once', () => {
    const m = machine()
    m.open(first)
    m.send({ type: 'queue-turn', turn: second })
    expect(m.finish(first)).toEqual([{ type: 'settle-turn', turn: first, outcome: { status: 'success' } }])
    expect(isAgentSessionRuntimeBusy(m.state)).toBe(true)
    expect(m.state.launch.kind).toBe('idle')
    expect(m.persist(first)).toEqual([{ type: 'schedule-launch', target: { kind: 'queued-turn' } }])
    expect(m.persist(first)).toEqual([])
    expect(m.state.queue).toEqual([second])
  })

  it.each(['success', 'error', 'paused'] as const)(
    'retains early %s until the reply stream can receive it',
    (status) => {
      const m = machine()
      m.send({ type: 'runtime-terminal', turn: first, outcome: { status } })
      m.finish(first)
      expect(m.open(first)).toEqual([])
      expect(m.send({ type: 'flush-transition', turn: first })).toEqual([
        { type: 'settle-turn', turn: first, outcome: { status } }
      ])
      expect(m.send({ type: 'flush-transition', turn: first })).toEqual([])
    }
  )

  it.each([false, true])('holds background output in the same reply (wake: %s)', (wake) => {
    const m = machine()
    m.connect()
    m.open(first)
    m.send({ type: 'connection-occupancy', occupancy: 'background', active: true })
    m.send({ type: 'reply-results', turn: first, toolCallIds: ['spawn'] })
    expect(m.finish(first)).toEqual([])
    expect(
      m
        .send({ type: 'connection-occupancy', occupancy: 'background', active: false })
        .some((effect) => effect.type === 'settle-turn')
    ).toBe(false)
    expect(isAgentSessionRuntimeBusy(m.state)).toBe(true)
    if (wake) {
      m.send({ type: 'background-reply-resumed' })
      expect(getAgentSessionRuntimeNativeTurn(m.state)).toBe(first)
      expect(getAgentSessionRuntimeReply(m.state, first)?.terminal).toBeUndefined()
      m.finish(first)
    }
    expect(m.send({ type: 'reply-results', turn: first, toolCallIds: [] })).toContainEqual({
      type: 'settle-turn',
      turn: first,
      outcome: { status: 'success' }
    })
    m.persist(first)
    expect(isAgentSessionRuntimeBusy(m.state)).toBe(false)
  })

  it('finishes a reply while an unrelated resident command keeps its connection occupied', () => {
    const m = machine()
    m.connect()
    m.open(first)
    m.send({ type: 'connection-occupancy', occupancy: 'background', active: true })
    expect(m.finish(first)).toEqual([{ type: 'settle-turn', turn: first, outcome: { status: 'success' } }])
    m.persist(first)
    expect(isAgentSessionRuntimeBusy(m.state)).toBe(false)
    expect(getAgentSessionRuntimeOccupancy(m.state)?.background).toBeDefined()
  })

  it.each(['error', 'paused'] as const)('replaces held foreground success with %s before settlement', (status) => {
    const m = machine()
    m.connect()
    m.open(first)
    m.send({ type: 'reply-results', turn: first, toolCallIds: ['spawn'] })
    expect(m.finish(first)).toEqual([])
    expect(m.send({ type: 'runtime-terminal', turn: first, outcome: { status } })).toEqual([
      { type: 'settle-turn', turn: first, outcome: { status } }
    ])
    expect(m.send({ type: 'reply-results', turn: first, toolCallIds: [] })).toEqual([])
    expect(m.finish(first)).toEqual([])
  })

  it('does not treat unknown result attribution as success before the reply stream opens', () => {
    const m = machine()
    m.send({ type: 'reply-results', turn: first, toolCallIds: undefined })
    m.finish(first)
    m.open(first)
    expect(m.send({ type: 'flush-transition', turn: first })).toEqual([])
    expect(m.send({ type: 'reply-results', turn: first, toolCallIds: [] })).toEqual([
      { type: 'settle-turn', turn: first, outcome: { status: 'success' } }
    ])
  })

  it.each(['error', 'paused'] as const)('does not hold a %s result for background work', (status) => {
    const m = machine()
    m.connect()
    m.open(first)
    m.send({ type: 'connection-occupancy', occupancy: 'background', active: true })
    m.send({ type: 'reply-results', turn: first, toolCallIds: ['spawn'] })
    expect(m.send({ type: 'runtime-terminal', turn: first, outcome: { status } })).toEqual([
      { type: 'settle-turn', turn: first, outcome: { status } }
    ])
  })

  it.each([false, true])('accepts a steer after the native result (source persisted: %s)', (persisted) => {
    const m = machine()
    m.open(first)
    m.finish(first)
    if (persisted) m.persist(first)
    m.send({ type: 'steer-boundary', turn: second })
    expect(getAgentSessionRuntimeNativeTurn(m.state)).toBe(second)
    if (!persisted) {
      expect(m.state.launch.kind).toBe('idle')
      m.persist(first)
    }
    expect(m.state.launch).toEqual({ kind: 'scheduled', target: { kind: 'reply', turn: second } })
    expect(getAgentSessionRuntimeReply(m.state, second)?.admission).toBe('admitted')
  })

  it('gives steer facts to the reserved successor while the source is still persisting', () => {
    const m = machine()
    m.open(first)
    m.send({ type: 'reserve-steer', reservation: second })
    expect(getAgentSessionRuntimeNativeTurn(m.state)).toBe(first)
    m.send({ type: 'steer-boundary', turn: second })
    const chunk = { type: 'data-status', data: 'waiting' } as const
    m.send({ type: 'buffer-chunk', turn: second, chunk })
    m.finish(second)
    expect(m.state.launch.kind).toBe('idle')
    m.persist(first)
    m.send({ type: 'turn-prepared', turn: second })
    m.open(second)
    expect(m.send({ type: 'flush-transition', turn: second })).toEqual([
      { type: 'deliver-buffer', turn: second, chunks: [chunk] },
      { type: 'settle-turn', turn: second, outcome: { status: 'success' } }
    ])
    expect(m.send({ type: 'flush-transition', turn: second })).toEqual([])
  })

  it.each([false, true])('waits for both native release and reply persistence (release first: %s)', (releaseFirst) => {
    const m = machine()
    m.open(first)
    m.admit(first)
    m.send({ type: 'autonomous-turn-started', turn: second, deferCurrentTurn: true })
    expect(m.state.launch.kind).toBe('idle')
    m.send({ type: 'turn-suspended', turn: first })
    m.send({ type: 'turn-prepared', turn: second })
    m.open(second)
    m.completeLaunch()
    m.finish(second)
    if (releaseFirst) m.send({ type: 'autonomous-turn-finished' })
    else m.persist(second)
    expect(getAgentSessionRuntimeCurrentTurn(m.state)).toBe(second)
    if (releaseFirst) m.persist(second)
    else m.send({ type: 'autonomous-turn-finished' })
    expect(getAgentSessionRuntimeCurrentTurn(m.state)).toBe(first)
    expect(getAgentSessionRuntimeReply(m.state, first)?.admission).toBe('admitted')
    expect(m.state.launch).toEqual({ kind: 'scheduled', target: { kind: 'reply', turn: first } })
  })

  it('keeps a failed autonomous reply as fact owner until release and retries its own preparation', () => {
    const m = machine()
    m.send({ type: 'autonomous-turn-started', turn: second, deferCurrentTurn: true })
    m.send({ type: 'turn-suspended', turn: first })
    m.send({ type: 'reply-delivery-failed', turn: second, error: 'disk unavailable' })
    m.completeLaunch()
    m.finish(second)
    expect(getAgentSessionRuntimeNativeTurn(m.state)).toBe(second)
    expect(m.state.launch.kind).toBe('idle')
    const chunk = { type: 'data-status', data: 'last A fact' } as const
    m.send({ type: 'buffer-chunk', turn: second, chunk })
    m.send({ type: 'autonomous-turn-finished' })
    expect(m.state.launch).toEqual({ kind: 'scheduled', target: { kind: 'reply', turn: second } })
    expect(getAgentSessionRuntimeReply(m.state, second)?.buffer).toEqual([chunk])
    expect(getAgentSessionRuntimeReply(m.state, first)?.buffer).toEqual([])
  })

  it('retains a repeatedly failed reply without an automatic retry loop', () => {
    const m = machine()
    m.send({ type: 'autonomous-turn-started', turn: second, deferCurrentTurn: true })
    m.send({ type: 'turn-suspended', turn: first })
    m.send({ type: 'reply-delivery-failed', turn: second, error: 'disk unavailable' })
    m.completeLaunch()
    m.send({ type: 'autonomous-turn-finished' })
    m.send({ type: 'reply-delivery-failed', turn: second, error: 'still unavailable' })
    m.completeLaunch()
    expect(m.state.launch.kind).toBe('idle')
    expect(getAgentSessionRuntimeReply(m.state, second)).toMatchObject({
      delivery: { kind: 'failed' },
      deliveryFailure: { error: 'still unavailable' }
    })
    expect(isAgentSessionRuntimeBusy(m.state)).toBe(true)
  })

  it('routes an admitted deferred reply after native release before its stream reopens', () => {
    const m = machine()
    m.admit(first)
    m.send({ type: 'autonomous-turn-started', turn: second, deferCurrentTurn: true })
    m.send({ type: 'turn-suspended', turn: first })
    m.finish(second)
    m.send({ type: 'autonomous-turn-finished' })
    expect(getAgentSessionRuntimeNativeTurn(m.state)).toBe(first)
    const chunk = { type: 'data-status', data: 'B' } as const
    m.send({ type: 'buffer-chunk', turn: first, chunk })
    m.finish(first)
    m.persist(second)
    m.completeLaunch()
    m.open(first)
    expect(m.send({ type: 'flush-transition', turn: first })).toEqual([
      { type: 'deliver-buffer', turn: first, chunks: [chunk] },
      { type: 'settle-turn', turn: first, outcome: { status: 'success' } }
    ])
  })

  it('does not mistake preparation failure for native completion when release arrives first', () => {
    const m = machine()
    m.admit(first)
    m.send({ type: 'autonomous-turn-started', turn: second, deferCurrentTurn: true })
    m.send({ type: 'turn-suspended', turn: first })
    m.send({ type: 'reply-delivery-failed', turn: second, error: 'disk unavailable' })
    m.completeLaunch()
    m.send({ type: 'autonomous-turn-finished' })
    expect(getAgentSessionRuntimeNativeTurn(m.state)).toBe(second)
    m.finish(second)
    expect(getAgentSessionRuntimeNativeTurn(m.state)).toBe(first)
  })

  it('ignores stale preparation and terminal results after a new reply starts', () => {
    const m = machine()
    m.persist(first)
    m.send({ type: 'begin-turn', turn: second })
    m.send({ type: 'reply-delivery-failed', turn: first, error: 'late' })
    m.persist(first)
    m.finish(first)
    expect(getAgentSessionRuntimeCurrentTurn(m.state)).toBe(second)
    expect(getAgentSessionRuntimeReply(m.state, second)?.delivery.kind).toBe('attaching')
    expect(getAgentSessionRuntimeReply(m.state, second)?.terminal).toBeUndefined()
  })

  it('preserves a running launch until its own completion even when another reply becomes ready', () => {
    const m = machine()
    m.send({ type: 'autonomous-turn-started', turn: second, deferCurrentTurn: true })
    m.send({ type: 'turn-suspended', turn: first })
    const launch = m.state.launch
    if (launch.kind !== 'scheduled') throw new Error('Expected scheduled launch')
    m.send({ type: 'launch-started', target: launch.target })
    m.send({ type: 'autonomous-turn-finished' })
    m.persist(second)
    expect(m.state.launch).toEqual({ kind: 'running', target: launch.target })
    m.completeLaunch()
    expect(m.state.launch).toEqual({ kind: 'scheduled', target: { kind: 'reply', turn: first } })
  })

  it('keeps suppressed launches represented and resumes exactly the same target', () => {
    const m = machine()
    m.send({ type: 'queue-turn', turn: second })
    m.persist(first)
    const launch = m.state.launch
    if (launch.kind !== 'scheduled') throw new Error('Expected scheduled launch')
    m.send({ type: 'launch-suppressed', target: launch.target })
    expect(isAgentSessionRuntimeBusy(m.state)).toBe(true)
    expect(m.send({ type: 'launch-resumed' })).toEqual([{ type: 'schedule-launch', target: launch.target }])
    expect(m.send({ type: 'launch-resumed' })).toEqual([])
  })

  it('releases occupancy with its connection and ignores stale detach callbacks', () => {
    const m = machine(undefined)
    m.connect()
    m.send({ type: 'connection-occupancy', occupancy: 'background', active: true })
    m.send({ type: 'connection-occupancy', occupancy: 'compaction', active: true })
    const newer = { ...connection }
    m.send({ type: 'connection-disconnected', connection: newer })
    expect(getAgentSessionRuntimeOccupancy(m.state)?.compaction).toBe(true)
    expect(m.send({ type: 'connection-disconnected', connection })).toContainEqual({ type: 'compaction-interrupted' })
    expect(getAgentSessionRuntimeOccupancy(m.state)).toBeUndefined()
  })

  it('does not hold a topic for an autonomous reply without a successor once launch is complete', () => {
    const m = machine(undefined)
    m.send({ type: 'autonomous-turn-started', turn: second, deferCurrentTurn: false })
    m.send({ type: 'turn-prepared', turn: second })
    m.open(second)
    m.completeLaunch()
    expect(willAgentSessionRuntimeContinue(m.state)).toBe(false)
  })

  it('earns admission only from a confirmed submission', () => {
    const m = machine(first, { admitted: false })
    expect(m.send({ type: 'turn-admitted', turn: first })).toEqual([
      { type: 'log-invalid-transition', event: 'turn-admitted', state: 'turn' }
    ])
    expect(getAgentSessionRuntimeReply(m.state, first)?.admission).toBe('pending')
    expect(m.send({ type: 'turn-submitting', turn: first })).toEqual([])
    expect(getAgentSessionRuntimeReply(m.state, first)?.admission).toBe('submitting')
    expect(m.send({ type: 'turn-admitted', turn: first })).toEqual([])
    expect(getAgentSessionRuntimeReply(m.state, first)?.admission).toBe('admitted')
  })

  it('keeps a stop-discarded prompt submittable and bars it from a success terminal', () => {
    const m = machine(first, { admitted: false })
    m.open(first)
    m.send({ type: 'turn-submitting', turn: first })
    m.send({ type: 'turn-send-discarded', turn: first })
    expect(getAgentSessionRuntimeReply(m.state, first)?.admission).toBe('pending')

    // The stopped generation's result lands afterwards: the unconsumed prompt must not claim it.
    expect(m.send({ type: 'runtime-terminal', turn: first, outcome: { status: 'success' } })).toEqual([])
    expect(getAgentSessionRuntimeReply(m.state, first)).toMatchObject({
      delivery: { kind: 'open' },
      admission: 'pending'
    })
    expect(getAgentSessionRuntimeReply(m.state, first)?.terminal).toBeUndefined()

    // The turn stays eligible: a fresh submission earns admission and its own result settles it.
    m.admit(first)
    expect(m.send({ type: 'runtime-terminal', turn: first, outcome: { status: 'success' } })).toEqual([
      { type: 'settle-turn', turn: first, outcome: { status: 'success' } }
    ])
  })

  it('latches a completion that lands under an unconfirmed submission until admission confirms it', () => {
    const m = machine(first, { admitted: false })
    m.open(first)
    m.send({ type: 'turn-submitting', turn: first })
    // Pi's async send can finish the whole turn (manual /compact) before it returns.
    expect(m.send({ type: 'runtime-terminal', turn: first, outcome: { status: 'success' } })).toEqual([])
    expect(getAgentSessionRuntimeReply(m.state, first)?.terminal).toEqual({ status: 'success' })
    m.send({ type: 'turn-admitted', turn: first })
    expect(m.send({ type: 'flush-transition', turn: first })).toEqual([
      { type: 'settle-turn', turn: first, outcome: { status: 'success' } }
    ])
  })

  it('keeps a parked stop-discarded prompt unclaimed by the generation that settles first', () => {
    const m = machine(first, { admitted: false })
    m.open(first)
    m.send({ type: 'turn-submitting', turn: first })
    m.send({ type: 'autonomous-turn-started', turn: second, deferCurrentTurn: true })
    m.send({ type: 'turn-suspended', turn: first })
    expect(getAgentSessionRuntimeReply(m.state, first)?.admission).toBe('submitting')

    // The stop fences the in-flight send while the turn is parked behind the generation.
    m.send({ type: 'turn-send-discarded', turn: first })
    expect(getAgentSessionRuntimeReply(m.state, first)?.admission).toBe('pending')

    m.finish(second)
    m.send({ type: 'autonomous-turn-finished' })
    // The stopped generation's trailing success cannot settle the unconsumed parked prompt.
    expect(m.send({ type: 'runtime-terminal', turn: first, outcome: { status: 'success' } })).toEqual([])
    expect(getAgentSessionRuntimeReply(m.state, first)?.admission).toBe('pending')
    expect(getAgentSessionRuntimeReply(m.state, first)?.terminal).toBeUndefined()
  })
})
