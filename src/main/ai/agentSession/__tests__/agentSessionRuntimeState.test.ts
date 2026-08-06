import { describe, expect, it } from 'vitest'

import {
  createAgentSessionRuntimeState,
  getAgentSessionRuntimeConnection,
  getAgentSessionRuntimeCurrentTurn,
  getAgentSessionRuntimeOccupancy,
  isAgentSessionRuntimeAutonomous,
  isAgentSessionRuntimeBusy,
  transitionAgentSessionRuntime,
  willAgentSessionRuntimeContinue
} from '../agentSessionRuntimeState'

type Turn = { id: string; terminal?: boolean }
type PendingTurn = { id: string }
type Reservation = { id: string }

const turn = (id: string): Turn => ({ id })
const pending = (id: string): PendingTurn => ({ id })
const reservation = (id: string): Reservation => ({ id })
describe('agentSessionRuntimeState', () => {
  it('models a normal turn and queued follow-up without parallel execution flags', () => {
    let state = createAgentSessionRuntimeState<Turn, PendingTurn, Reservation>(turn('user-1'))

    state = transitionAgentSessionRuntime(state, { type: 'queue-turn', turn: pending('user-2') }).state

    expect(state.execution).toMatchObject({ kind: 'turn', turn: { id: 'user-1' } })
    expect(state.queue).toEqual([{ id: 'user-2' }])
    expect(isAgentSessionRuntimeBusy(state)).toBe(true)
    expect(willAgentSessionRuntimeContinue(state)).toBe(true)
  })

  it('tracks stream and admission phases inside the normal turn state', () => {
    const current = turn('user-1')
    let state = createAgentSessionRuntimeState<Turn, PendingTurn, Reservation>(current)

    expect(state.execution).toMatchObject({ kind: 'turn', stream: 'unopened', admission: 'pending' })
    state = transitionAgentSessionRuntime(state, { type: 'turn-stream-opened', turn: current }).state
    state = transitionAgentSessionRuntime(state, { type: 'turn-admitted', turn: current }).state

    expect(state.execution).toMatchObject({ kind: 'turn', stream: 'open', admission: 'admitted' })
  })

  it('waits for stream persistence before a completed normal turn becomes terminal', () => {
    const current = turn('user-1')
    let state = createAgentSessionRuntimeState<Turn, PendingTurn, Reservation>(current)
    state = transitionAgentSessionRuntime(state, { type: 'turn-stream-opened', turn: current }).state

    const runtimeCompleted = transitionAgentSessionRuntime(state, {
      type: 'runtime-terminal',
      outcome: { status: 'success' }
    })

    expect(runtimeCompleted.state.execution).toMatchObject({
      kind: 'turn',
      turn: current,
      stream: 'awaiting-persistence'
    })
    expect(runtimeCompleted.effects).toEqual([{ type: 'settle-turn', turn: current, outcome: { status: 'success' } }])
    expect(isAgentSessionRuntimeBusy(runtimeCompleted.state)).toBe(true)

    const persisted = transitionAgentSessionRuntime(runtimeCompleted.state, {
      type: 'turn-terminal',
      turn: current,
      status: 'success'
    })

    expect(persisted.state.execution).toEqual({ kind: 'idle', lastTurn: current })
    expect(persisted.effects).toEqual([])
    expect(persisted.state.lastTerminal).toBe('success')
  })

  it('latches a terminal event until an unopened normal stream has emitted its start chunk', () => {
    const current = turn('user-1')
    let state = createAgentSessionRuntimeState<Turn, PendingTurn, Reservation>(current)
    state = transitionAgentSessionRuntime(state, {
      type: 'runtime-terminal',
      outcome: { status: 'error', error: 'early failure' }
    }).state

    expect(state.execution).toMatchObject({
      kind: 'turn',
      stream: 'unopened',
      terminal: { status: 'error', error: 'early failure' }
    })

    state = transitionAgentSessionRuntime(state, { type: 'turn-stream-opened', turn: current }).state
    const flushed = transitionAgentSessionRuntime(state, { type: 'flush-transition' })

    expect(flushed.state.execution).toMatchObject({ kind: 'turn', stream: 'awaiting-persistence' })
    expect(flushed.effects).toEqual([
      {
        type: 'settle-turn',
        turn: current,
        outcome: { status: 'error', error: 'early failure' }
      }
    ])
  })

  it('keeps the first terminal outcome while an unopened stream is waiting to attach', () => {
    const current = turn('user-1')
    let state = createAgentSessionRuntimeState<Turn, PendingTurn, Reservation>(current)
    state = transitionAgentSessionRuntime(state, {
      type: 'runtime-terminal',
      outcome: { status: 'error', error: 'first failure' }
    }).state

    const duplicate = transitionAgentSessionRuntime(state, {
      type: 'runtime-terminal',
      outcome: { status: 'success' }
    })

    expect(duplicate.state.execution).toMatchObject({
      kind: 'turn',
      terminal: { status: 'error', error: 'first failure' }
    })
    expect(duplicate.effects).toEqual([])
  })

  it('moves a steer through one discriminated transition and replays its buffer once', () => {
    const original = turn('assistant-1')
    const continuation = turn('assistant-2')
    let state = createAgentSessionRuntimeState<Turn, PendingTurn, Reservation>(original)
    state = transitionAgentSessionRuntime(state, { type: 'turn-stream-opened', turn: original }).state
    state = transitionAgentSessionRuntime(state, {
      type: 'reserve-steer',
      reservation: reservation('reserved-2')
    }).state
    const boundary = transitionAgentSessionRuntime(state, {
      type: 'steer-boundary',
      inputs: [],
      headless: false
    })
    expect(boundary.state.execution).toMatchObject({
      kind: 'steer-transition',
      sourceStream: 'awaiting-persistence',
      stream: 'unopened'
    })
    expect(boundary.effects).toEqual([{ type: 'settle-turn', turn: original, outcome: { status: 'success' } }])
    const sourceSettled = transitionAgentSessionRuntime(boundary.state, {
      type: 'turn-terminal',
      turn: original,
      status: 'success'
    })
    state = sourceSettled.state
    state = transitionAgentSessionRuntime(state, {
      type: 'buffer-chunk',
      chunk: { type: 'text-delta', id: 'text-1', delta: 'continued' }
    }).state
    state = transitionAgentSessionRuntime(state, {
      type: 'continuation-turn-created',
      turn: continuation
    }).state
    state = transitionAgentSessionRuntime(state, { type: 'turn-stream-opened', turn: continuation }).state

    const result = transitionAgentSessionRuntime(state, { type: 'flush-transition' })

    expect(result.state.execution).toEqual({
      kind: 'turn',
      turn: continuation,
      stream: 'open',
      admission: 'admitted'
    })
    expect(result.effects).toEqual([
      {
        type: 'deliver-buffer',
        turn: continuation,
        chunks: [{ type: 'text-delta', id: 'text-1', delta: 'continued' }]
      }
    ])
  })

  it('latches a steer completion that arrives before the continuation stream opens', () => {
    const original = turn('assistant-1')
    const continuation = turn('assistant-2')
    let state = createAgentSessionRuntimeState<Turn, PendingTurn, Reservation>(original)
    state = transitionAgentSessionRuntime(state, { type: 'turn-stream-opened', turn: original }).state
    state = transitionAgentSessionRuntime(state, {
      type: 'steer-boundary',
      inputs: [],
      headless: false
    }).state
    state = transitionAgentSessionRuntime(state, {
      type: 'turn-terminal',
      turn: original,
      status: 'success'
    }).state
    state = transitionAgentSessionRuntime(state, {
      type: 'runtime-terminal',
      outcome: { status: 'success' }
    }).state
    state = transitionAgentSessionRuntime(state, {
      type: 'continuation-turn-created',
      turn: continuation
    }).state
    state = transitionAgentSessionRuntime(state, { type: 'turn-stream-opened', turn: continuation }).state

    const result = transitionAgentSessionRuntime(state, { type: 'flush-transition' })

    expect(result.state.execution).toMatchObject({ kind: 'turn', stream: 'awaiting-persistence' })
    expect(result.effects).toContainEqual({
      type: 'settle-turn',
      turn: continuation,
      outcome: { status: 'success' }
    })
  })

  it('latches an early autonomous completion until the receive-only stream opens', () => {
    const receiveOnly = turn('wake')
    let state = createAgentSessionRuntimeState<Turn, PendingTurn, Reservation>()
    state = transitionAgentSessionRuntime(state, {
      type: 'autonomous-turn-state',
      state: 'started'
    }).state
    state = transitionAgentSessionRuntime(state, { type: 'autonomous-turn-created', turn: receiveOnly }).state
    state = transitionAgentSessionRuntime(state, {
      type: 'buffer-chunk',
      chunk: { type: 'text-delta', id: 'wake-text', delta: 'done' }
    }).state
    state = transitionAgentSessionRuntime(state, {
      type: 'runtime-terminal',
      outcome: { status: 'success' }
    }).state
    state = transitionAgentSessionRuntime(state, { type: 'turn-stream-opened', turn: receiveOnly }).state

    const result = transitionAgentSessionRuntime(state, { type: 'flush-transition' })

    expect(result.effects).toEqual([
      {
        type: 'deliver-buffer',
        turn: receiveOnly,
        chunks: [{ type: 'text-delta', id: 'wake-text', delta: 'done' }]
      },
      { type: 'settle-turn', turn: receiveOnly, outcome: { status: 'success' } }
    ])
    expect(result.state.execution).toMatchObject({
      kind: 'autonomous-turn',
      ownership: 'active',
      buffer: [],
      stream: 'awaiting-persistence'
    })
  })

  it('restores a deferred user turn only after autonomous ownership and the wake turn both finish', () => {
    const deferred = turn('user')
    const receiveOnly = turn('wake')
    let state = createAgentSessionRuntimeState<Turn, PendingTurn, Reservation>(deferred)
    state = transitionAgentSessionRuntime(state, {
      type: 'autonomous-turn-state',
      state: 'started',
      deferCurrentTurn: true
    }).state
    state = transitionAgentSessionRuntime(state, { type: 'autonomous-turn-created', turn: receiveOnly }).state
    state = transitionAgentSessionRuntime(state, {
      type: 'turn-terminal',
      turn: receiveOnly,
      status: 'success'
    }).state

    expect(state.execution).toMatchObject({ kind: 'autonomous-turn', ownership: 'active' })

    const result = transitionAgentSessionRuntime(state, {
      type: 'autonomous-turn-state',
      state: 'finished'
    })

    expect(result.state.execution).toEqual({
      kind: 'turn',
      turn: deferred,
      stream: 'unopened',
      admission: 'pending'
    })
    expect(result.state.launch).toEqual({ kind: 'scheduled', target: 'deferred-turn' })
    expect(result.effects).toContainEqual({ type: 'schedule-launch', target: 'deferred-turn' })
  })

  it('does not replace a running receive-only launch while restoring its deferred turn', () => {
    const deferred = turn('user')
    const receiveOnly = turn('wake')
    let state = createAgentSessionRuntimeState<Turn, PendingTurn, Reservation>(deferred)
    state = transitionAgentSessionRuntime(state, {
      type: 'autonomous-turn-state',
      state: 'started',
      deferCurrentTurn: true
    }).state
    state = transitionAgentSessionRuntime(state, { type: 'autonomous-turn-created', turn: receiveOnly }).state
    state = transitionAgentSessionRuntime(state, {
      type: 'launch-requested',
      target: 'receive-only'
    }).state
    state = transitionAgentSessionRuntime(state, {
      type: 'launch-started',
      target: 'receive-only'
    }).state
    state = transitionAgentSessionRuntime(state, {
      type: 'turn-terminal',
      turn: receiveOnly,
      status: 'success'
    }).state

    const result = transitionAgentSessionRuntime(state, {
      type: 'autonomous-turn-state',
      state: 'finished'
    })

    expect(result.state.execution).toMatchObject({ kind: 'turn', turn: deferred })
    expect(result.state.launch).toEqual({ kind: 'running', target: 'receive-only' })
    expect(result.effects).not.toContainEqual({ type: 'schedule-launch', target: 'deferred-turn' })
  })

  it('drops a chunk with an explicit invalid-transition effect when no buffer owns it', () => {
    const state = createAgentSessionRuntimeState<Turn, PendingTurn, Reservation>(turn('user-1'))

    const result = transitionAgentSessionRuntime(state, {
      type: 'buffer-chunk',
      chunk: { type: 'text-delta', id: 'text-1', delta: 'orphan' }
    })

    expect(result.state).toBe(state)
    expect(result.effects).toEqual([{ type: 'log-invalid-transition', event: 'buffer-chunk', state: 'turn' }])
  })

  it('keeps duplicate autonomous and background occupancy events idempotent', () => {
    const connection = { events: [], close: () => undefined } as never
    let state = createAgentSessionRuntimeState<Turn, PendingTurn, Reservation>()
    state = transitionAgentSessionRuntime(state, { type: 'connection-started', attemptId: 'connect-1' }).state
    state = transitionAgentSessionRuntime(state, {
      type: 'connection-connected',
      attemptId: 'connect-1',
      connection
    }).state
    state = transitionAgentSessionRuntime(state, {
      type: 'autonomous-turn-state',
      state: 'started'
    }).state
    const duplicateAutonomous = transitionAgentSessionRuntime(state, {
      type: 'autonomous-turn-state',
      state: 'started'
    })
    state = transitionAgentSessionRuntime(state, {
      type: 'connection-occupancy',
      occupancy: 'background',
      active: true,
      responder: 'interactive'
    }).state
    const duplicateBackground = transitionAgentSessionRuntime(state, {
      type: 'connection-occupancy',
      occupancy: 'background',
      active: true,
      responder: 'headless'
    })

    expect(duplicateAutonomous).toEqual({ state: duplicateAutonomous.state, effects: [] })
    expect(getAgentSessionRuntimeOccupancy(duplicateBackground.state)).toEqual({
      background: { responder: 'interactive' }
    })
    expect(duplicateBackground.effects).toEqual([])
  })

  it('scopes occupancy to the connection: a disconnect erases it structurally', () => {
    const connection = { events: [], close: () => undefined } as never
    let state = createAgentSessionRuntimeState<Turn, PendingTurn, Reservation>()
    state = transitionAgentSessionRuntime(state, { type: 'connection-started', attemptId: 'connect-1' }).state
    state = transitionAgentSessionRuntime(state, {
      type: 'connection-connected',
      attemptId: 'connect-1',
      connection
    }).state
    state = transitionAgentSessionRuntime(state, {
      type: 'connection-occupancy',
      occupancy: 'background',
      active: true,
      responder: 'interactive'
    }).state
    state = transitionAgentSessionRuntime(state, {
      type: 'connection-occupancy',
      occupancy: 'compaction',
      active: true
    }).state
    expect(isAgentSessionRuntimeBusy(state)).toBe(true)

    const disconnected = transitionAgentSessionRuntime(state, { type: 'connection-disconnected', connection })

    expect(getAgentSessionRuntimeOccupancy(disconnected.state)).toBeUndefined()
    expect(isAgentSessionRuntimeBusy(disconnected.state)).toBe(false)
    expect(disconnected.effects).toEqual([
      { type: 'release-background-waiter', connection },
      { type: 'compaction-interrupted' }
    ])
  })

  it('defers a rebuild behind background occupancy and releases it when the work drains', () => {
    const connection = { events: [], close: () => undefined } as never
    let state = createAgentSessionRuntimeState<Turn, PendingTurn, Reservation>()
    state = transitionAgentSessionRuntime(state, { type: 'connection-started', attemptId: 'connect-1' }).state
    state = transitionAgentSessionRuntime(state, {
      type: 'connection-connected',
      attemptId: 'connect-1',
      connection
    }).state
    state = transitionAgentSessionRuntime(state, {
      type: 'connection-occupancy',
      occupancy: 'background',
      active: true,
      responder: 'interactive'
    }).state
    state = transitionAgentSessionRuntime(state, {
      type: 'connection-rebuild-deferred',
      connection,
      target: { modelId: 'model-2', reasoningEffort: 'default', knowledgeBaseIds: ['kb-1'] }
    }).state
    expect(state.connection).toMatchObject({ kind: 'connected', pendingRebuild: { modelId: 'model-2' } })

    const result = transitionAgentSessionRuntime(state, {
      type: 'connection-occupancy',
      occupancy: 'background',
      active: false
    })

    expect(getAgentSessionRuntimeConnection(result.state)).toBe(connection)
    expect(result.state.connection).toEqual({ kind: 'connected', connection, occupancy: {} })
    expect(result.effects).toContainEqual({ type: 'release-background-waiter', connection })
  })

  it.each(['queued-turn', 'steer-continuation', 'receive-only', 'deferred-turn'] as const)(
    'represents a suppressed %s launch and resumes it exactly once',
    (target) => {
      let state = createAgentSessionRuntimeState<Turn, PendingTurn, Reservation>()
      state = transitionAgentSessionRuntime(state, { type: 'launch-requested', target }).state
      state = transitionAgentSessionRuntime(state, { type: 'launch-suppressed', target }).state

      const resumed = transitionAgentSessionRuntime(state, { type: 'launch-resumed' })
      const duplicate = transitionAgentSessionRuntime(resumed.state, { type: 'launch-resumed' })

      expect(resumed.state.launch).toEqual({ kind: 'scheduled', target })
      expect(resumed.effects).toEqual([{ type: 'schedule-launch', target }])
      expect(duplicate.effects).toEqual([{ type: 'log-invalid-transition', event: 'launch-resumed', state: 'idle' }])
    }
  )

  it('ignores a stale connection detach without changing the current connection', () => {
    const current = { events: [], close: () => undefined } as never
    const stale = { events: [], close: () => undefined } as never
    let state = createAgentSessionRuntimeState<Turn, PendingTurn, Reservation>()
    state = transitionAgentSessionRuntime(state, { type: 'connection-started', attemptId: 'connect-1' }).state
    state = transitionAgentSessionRuntime(state, {
      type: 'connection-connected',
      attemptId: 'connect-1',
      connection: current
    }).state

    const result = transitionAgentSessionRuntime(state, {
      type: 'connection-disconnected',
      connection: stale
    })

    expect(getAgentSessionRuntimeConnection(result.state)).toBe(current)
    expect(result.effects[0]).toMatchObject({ type: 'log-invalid-transition' })
  })

  it('derives current turn and autonomous ownership from the execution union', () => {
    const receiveOnly = turn('wake')
    let state = createAgentSessionRuntimeState<Turn, PendingTurn, Reservation>()
    state = transitionAgentSessionRuntime(state, {
      type: 'autonomous-turn-state',
      state: 'started'
    }).state
    state = transitionAgentSessionRuntime(state, { type: 'autonomous-turn-created', turn: receiveOnly }).state

    expect(getAgentSessionRuntimeCurrentTurn(state)).toBe(receiveOnly)
    expect(isAgentSessionRuntimeAutonomous(state)).toBe(true)
  })

  it('does not treat the current receive-only turn as a future continuation', () => {
    const receiveOnly = turn('wake')
    let state = createAgentSessionRuntimeState<Turn, PendingTurn, Reservation>()
    state = transitionAgentSessionRuntime(state, {
      type: 'autonomous-turn-state',
      state: 'started'
    }).state
    state = transitionAgentSessionRuntime(state, { type: 'autonomous-turn-created', turn: receiveOnly }).state
    state = transitionAgentSessionRuntime(state, { type: 'turn-stream-opened', turn: receiveOnly }).state
    state = transitionAgentSessionRuntime(state, {
      type: 'autonomous-turn-state',
      state: 'finished'
    }).state
    state = transitionAgentSessionRuntime(state, {
      type: 'runtime-terminal',
      outcome: { status: 'success' }
    }).state

    expect(state.execution).toMatchObject({
      kind: 'autonomous-turn',
      ownership: 'released',
      stream: 'awaiting-persistence'
    })
    expect(willAgentSessionRuntimeContinue(state)).toBe(false)
  })

  it('keeps a deferred user turn as a continuation after a receive-only turn', () => {
    const deferred = turn('user')
    const receiveOnly = turn('wake')
    let state = createAgentSessionRuntimeState<Turn, PendingTurn, Reservation>(deferred)
    state = transitionAgentSessionRuntime(state, {
      type: 'autonomous-turn-state',
      state: 'started',
      deferCurrentTurn: true
    }).state
    state = transitionAgentSessionRuntime(state, { type: 'autonomous-turn-created', turn: receiveOnly }).state
    state = transitionAgentSessionRuntime(state, { type: 'turn-stream-opened', turn: receiveOnly }).state
    state = transitionAgentSessionRuntime(state, {
      type: 'autonomous-turn-state',
      state: 'finished'
    }).state
    state = transitionAgentSessionRuntime(state, {
      type: 'runtime-terminal',
      outcome: { status: 'success' }
    }).state

    expect(state.execution).toMatchObject({
      kind: 'autonomous-turn',
      deferredTurn: deferred,
      stream: 'awaiting-persistence'
    })
    expect(willAgentSessionRuntimeContinue(state)).toBe(true)
  })
})
