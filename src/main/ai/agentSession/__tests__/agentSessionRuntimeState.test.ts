import { describe, expect, it } from 'vitest'

import type { AgentRuntimeConnection } from '../../runtime/types'
import {
  AgentAutonomousGenerationState,
  AgentAutonomousResourceOwnership,
  AgentConnectionDeliveryPhase,
  AgentConnectionOccupancyKind,
  AgentConnectionResourceEventType,
  AgentConnectionResourceKind,
  AgentDriverOutcomeKind,
  AgentStreamResourcePhase,
  createAgentConnectionResourceState,
  getAgentConnectionOccupancy,
  getAgentConnectionResource,
  getAgentCurrentStreamResource,
  hasAgentConnectionResources,
  isAgentAutonomousResourceActive,
  transitionAgentConnectionResource
} from '../agentConnectionResourceState'

type Turn = { id: string }
type Reservation = { id: string }

const turn = (id: string): Turn => ({ id })
const reservation = (id: string): Reservation => ({ id })
const chunk = (text: string) => ({ type: 'text-delta' as const, id: 'text-1', delta: text })

enum RemovedLaunchTarget {
  QueuedTurn = 'queued-turn',
  SteerContinuation = 'steer-continuation',
  ReceiveOnly = 'receive-only',
  DeferredTurn = 'deferred-turn'
}

describe('agentSessionRuntimeState owner migration', () => {
  it('is false with no entry and true while a turn is live', () => {
    const idle = createAgentConnectionResourceState<Turn, Reservation>()
    const live = createAgentConnectionResourceState<Turn, Reservation>(turn('user-1'))

    expect(hasAgentConnectionResources(idle)).toBe(false)
    expect(hasAgentConnectionResources(live)).toBe(true)
  })

  it('is false once a turn settles with no queued follow-ups', () => {
    const current = turn('user-1')
    let state = createAgentConnectionResourceState<Turn, Reservation>(current)
    state = transitionAgentConnectionResource(state, {
      type: AgentConnectionResourceEventType.TurnStreamOpened,
      turn: current
    }).state
    state = transitionAgentConnectionResource(state, {
      type: AgentConnectionResourceEventType.DriverTerminal,
      outcome: { status: AgentDriverOutcomeKind.Success }
    }).state
    state = transitionAgentConnectionResource(state, {
      type: AgentConnectionResourceEventType.TurnReleased,
      turnId: current.id,
      turn: current,
      status: AgentDriverOutcomeKind.Success
    }).state

    expect(hasAgentConnectionResources(state)).toBe(false)
  })

  it('is false with no entry, true while a turn streams, false once it settles', () => {
    const current = turn('user-1')
    let state = createAgentConnectionResourceState<Turn, Reservation>()
    expect(hasAgentConnectionResources(state)).toBe(false)

    state = transitionAgentConnectionResource(state, {
      type: AgentConnectionResourceEventType.BeginTurn,
      turn: current
    }).state
    state = transitionAgentConnectionResource(state, {
      type: AgentConnectionResourceEventType.TurnStreamOpened,
      turn: current
    }).state
    expect(getAgentCurrentStreamResource(state)).toBe(current)

    state = transitionAgentConnectionResource(state, {
      type: AgentConnectionResourceEventType.DriverTerminal,
      outcome: { status: AgentDriverOutcomeKind.Success }
    }).state
    state = transitionAgentConnectionResource(state, {
      type: AgentConnectionResourceEventType.TurnReleased,
      turnId: current.id,
      turn: current,
      status: AgentDriverOutcomeKind.Success
    }).state
    expect(hasAgentConnectionResources(state)).toBe(false)
  })

  it('stays true mid-roll, when chunks are buffered for the continuation turn', () => {
    const current = turn('user-1')
    let state = createAgentConnectionResourceState<Turn, Reservation>(current)
    state = transitionAgentConnectionResource(state, {
      type: AgentConnectionResourceEventType.TurnStreamOpened,
      turn: current
    }).state
    state = transitionAgentConnectionResource(state, {
      type: AgentConnectionResourceEventType.SteerBoundary,
      inputs: [],
      headless: false
    }).state
    state = transitionAgentConnectionResource(state, {
      type: AgentConnectionResourceEventType.BufferChunk,
      chunk: chunk('continued')
    }).state

    expect(hasAgentConnectionResources(state)).toBe(true)
    expect(state.generation).toMatchObject({
      kind: AgentConnectionResourceKind.SteerTransition,
      buffer: [chunk('continued')]
    })
  })

  it('models a normal turn without retaining the Conversation-owned follow-up queue', () => {
    const state = createAgentConnectionResourceState<Turn, Reservation>(turn('user-1'))

    expect(state.generation).toMatchObject({ kind: AgentConnectionResourceKind.Turn, turn: { id: 'user-1' } })
    expect('queue' in state).toBe(false)
    expect(hasAgentConnectionResources(state)).toBe(true)
  })

  it('tracks stream and delivery phases inside the normal turn resource', () => {
    const current = turn('user-1')
    let state = createAgentConnectionResourceState<Turn, Reservation>(current)

    expect(state.generation).toMatchObject({
      kind: AgentConnectionResourceKind.Turn,
      stream: AgentStreamResourcePhase.Unopened,
      delivery: AgentConnectionDeliveryPhase.Pending
    })
    state = transitionAgentConnectionResource(state, {
      type: AgentConnectionResourceEventType.TurnStreamOpened,
      turn: current
    }).state
    state = transitionAgentConnectionResource(state, {
      type: AgentConnectionResourceEventType.TurnSentToConnection,
      turn: current
    }).state

    expect(state.generation).toMatchObject({
      kind: AgentConnectionResourceKind.Turn,
      stream: AgentStreamResourcePhase.Open,
      delivery: AgentConnectionDeliveryPhase.Sent
    })
    expect('admission' in state.generation).toBe(false)
  })

  it('waits for Conversation terminal persistence before a completed turn resource becomes idle', () => {
    const current = turn('user-1')
    let state = createAgentConnectionResourceState<Turn, Reservation>(current)
    state = transitionAgentConnectionResource(state, {
      type: AgentConnectionResourceEventType.TurnStreamOpened,
      turn: current
    }).state

    const runtimeCompleted = transitionAgentConnectionResource(state, {
      type: AgentConnectionResourceEventType.DriverTerminal,
      outcome: { status: AgentDriverOutcomeKind.Success }
    })
    expect(runtimeCompleted.state.generation).toMatchObject({
      kind: AgentConnectionResourceKind.Turn,
      stream: AgentStreamResourcePhase.AwaitingRelease
    })
    expect(runtimeCompleted.effects).toEqual([
      {
        type: AgentConnectionResourceEventType.CloseTurnStream,
        turn: current,
        outcome: { status: AgentDriverOutcomeKind.Success }
      }
    ])
    expect(hasAgentConnectionResources(runtimeCompleted.state)).toBe(true)

    const persisted = transitionAgentConnectionResource(runtimeCompleted.state, {
      type: AgentConnectionResourceEventType.TurnReleased,
      turnId: current.id,
      turn: current,
      status: AgentDriverOutcomeKind.Success
    })
    expect(persisted.state.generation).toEqual({ kind: AgentConnectionResourceKind.Idle, lastTurn: current })
  })

  it('latches a terminal event until an unopened normal stream can receive it', () => {
    const current = turn('user-1')
    let state = createAgentConnectionResourceState<Turn, Reservation>(current)
    state = transitionAgentConnectionResource(state, {
      type: AgentConnectionResourceEventType.DriverTerminal,
      outcome: { status: AgentDriverOutcomeKind.Error, error: 'early failure' }
    }).state

    expect(state.generation).toMatchObject({
      stream: AgentStreamResourcePhase.Unopened,
      driverOutcome: { status: AgentDriverOutcomeKind.Error, error: 'early failure' }
    })
    state = transitionAgentConnectionResource(state, {
      type: AgentConnectionResourceEventType.TurnStreamOpened,
      turn: current
    }).state
    const flushed = transitionAgentConnectionResource(state, {
      type: AgentConnectionResourceEventType.FlushTransition
    })

    expect(flushed.state.generation).toMatchObject({ stream: AgentStreamResourcePhase.AwaitingRelease })
    expect(flushed.effects).toEqual([
      {
        type: AgentConnectionResourceEventType.CloseTurnStream,
        turn: current,
        outcome: { status: AgentDriverOutcomeKind.Error, error: 'early failure' }
      }
    ])
  })

  it('keeps the first terminal outcome while an unopened stream is waiting to attach', () => {
    const current = turn('user-1')
    let state = createAgentConnectionResourceState<Turn, Reservation>(current)
    state = transitionAgentConnectionResource(state, {
      type: AgentConnectionResourceEventType.DriverTerminal,
      outcome: { status: AgentDriverOutcomeKind.Error, error: 'first failure' }
    }).state

    const duplicate = transitionAgentConnectionResource(state, {
      type: AgentConnectionResourceEventType.DriverTerminal,
      outcome: { status: AgentDriverOutcomeKind.Success }
    })

    expect(duplicate.state.generation).toMatchObject({
      driverOutcome: { status: AgentDriverOutcomeKind.Error, error: 'first failure' }
    })
    expect(duplicate.effects).toEqual([])
  })

  it('reserves the gateway continuation before ingress and reuses it when A2 opens', () => {
    const original = turn('assistant-1')
    const continuation = turn('assistant-2')
    let state = createAgentConnectionResourceState<Turn, Reservation>(original)
    state = transitionAgentConnectionResource(state, {
      type: AgentConnectionResourceEventType.TurnStreamOpened,
      turn: original
    }).state
    state = transitionAgentConnectionResource(state, {
      type: AgentConnectionResourceEventType.ReserveSteer,
      reservation: reservation('reserved-2')
    }).state
    state = transitionAgentConnectionResource(state, {
      type: AgentConnectionResourceEventType.SteerBoundary,
      inputs: [],
      headless: false
    }).state
    state = transitionAgentConnectionResource(state, {
      type: AgentConnectionResourceEventType.BufferChunk,
      chunk: chunk('continued')
    }).state
    state = transitionAgentConnectionResource(state, {
      type: AgentConnectionResourceEventType.ContinuationTurnCreated,
      turn: continuation
    }).state
    state = transitionAgentConnectionResource(state, {
      type: AgentConnectionResourceEventType.TurnStreamOpened,
      turn: continuation
    }).state
    state = transitionAgentConnectionResource(state, {
      type: AgentConnectionResourceEventType.TurnReleased,
      turnId: original.id,
      turn: original,
      status: AgentDriverOutcomeKind.Success
    }).state

    const result = transitionAgentConnectionResource(state, {
      type: AgentConnectionResourceEventType.FlushTransition
    })
    expect(result.state.generation).toMatchObject({
      kind: AgentConnectionResourceKind.Turn,
      turn: continuation,
      stream: AgentStreamResourcePhase.Open
    })
    expect(result.effects).toEqual([
      {
        type: AgentConnectionResourceEventType.DeliverBuffer,
        turn: continuation,
        chunks: [chunk('continued')]
      }
    ])
  })

  it('latches a steer completion that arrives before the continuation stream opens', () => {
    const original = turn('assistant-1')
    const continuation = turn('assistant-2')
    let state = createAgentConnectionResourceState<Turn, Reservation>(original)
    state = transitionAgentConnectionResource(state, {
      type: AgentConnectionResourceEventType.TurnStreamOpened,
      turn: original
    }).state
    state = transitionAgentConnectionResource(state, {
      type: AgentConnectionResourceEventType.SteerBoundary,
      inputs: [],
      headless: false
    }).state
    state = transitionAgentConnectionResource(state, {
      type: AgentConnectionResourceEventType.DriverTerminal,
      outcome: { status: AgentDriverOutcomeKind.Success }
    }).state
    state = transitionAgentConnectionResource(state, {
      type: AgentConnectionResourceEventType.ContinuationTurnCreated,
      turn: continuation
    }).state
    state = transitionAgentConnectionResource(state, {
      type: AgentConnectionResourceEventType.TurnStreamOpened,
      turn: continuation
    }).state
    state = transitionAgentConnectionResource(state, {
      type: AgentConnectionResourceEventType.TurnReleased,
      turnId: original.id,
      turn: original,
      status: AgentDriverOutcomeKind.Success
    }).state

    const result = transitionAgentConnectionResource(state, {
      type: AgentConnectionResourceEventType.FlushTransition
    })
    expect(result.state.generation).toMatchObject({ stream: AgentStreamResourcePhase.AwaitingRelease })
    expect(result.effects).toContainEqual({
      type: AgentConnectionResourceEventType.CloseTurnStream,
      turn: continuation,
      outcome: { status: AgentDriverOutcomeKind.Success }
    })
  })

  it('latches completion after the receive-only turn exists but before its controller is installed', () => {
    const receiveOnly = turn('wake')
    let state = createAgentConnectionResourceState<Turn, Reservation>()
    state = transitionAgentConnectionResource(state, {
      type: AgentConnectionResourceEventType.AutonomousTurnState,
      state: AgentAutonomousGenerationState.Started
    }).state
    state = transitionAgentConnectionResource(state, {
      type: AgentConnectionResourceEventType.AutonomousTurnCreated,
      turn: receiveOnly
    }).state
    state = transitionAgentConnectionResource(state, {
      type: AgentConnectionResourceEventType.BufferChunk,
      chunk: chunk('done')
    }).state
    state = transitionAgentConnectionResource(state, {
      type: AgentConnectionResourceEventType.DriverTerminal,
      outcome: { status: AgentDriverOutcomeKind.Success }
    }).state
    state = transitionAgentConnectionResource(state, {
      type: AgentConnectionResourceEventType.TurnStreamOpened,
      turn: receiveOnly
    }).state

    const result = transitionAgentConnectionResource(state, {
      type: AgentConnectionResourceEventType.FlushTransition
    })
    expect(result.effects).toEqual([
      { type: AgentConnectionResourceEventType.DeliverBuffer, turn: receiveOnly, chunks: [chunk('done')] },
      {
        type: AgentConnectionResourceEventType.CloseTurnStream,
        turn: receiveOnly,
        outcome: { status: AgentDriverOutcomeKind.Success }
      }
    ])
  })

  it('keeps deferred foreground ownership out of the connection resource', () => {
    const foreground = turn('foreground')
    let state = createAgentConnectionResourceState<Turn, Reservation>(foreground)
    state = transitionAgentConnectionResource(state, {
      type: AgentConnectionResourceEventType.AutonomousTurnState,
      state: AgentAutonomousGenerationState.Started,
      contextTurn: foreground
    }).state
    state = transitionAgentConnectionResource(state, {
      type: AgentConnectionResourceEventType.AutonomousTurnState,
      state: AgentAutonomousGenerationState.Finished
    }).state

    expect(state.generation).toMatchObject({
      kind: AgentConnectionResourceKind.AutonomousTurn,
      contextTurn: foreground,
      ownership: AgentAutonomousResourceOwnership.Released
    })
    expect('deferredTurn' in state.generation).toBe(false)
    expect('launch' in state).toBe(false)
  })

  it('does not replace a running receive-only resource while Conversation restores foreground', () => {
    const foreground = turn('foreground')
    const receiveOnly = turn('wake')
    let state = createAgentConnectionResourceState<Turn, Reservation>(foreground)
    state = transitionAgentConnectionResource(state, {
      type: AgentConnectionResourceEventType.AutonomousTurnState,
      state: AgentAutonomousGenerationState.Started,
      contextTurn: foreground
    }).state
    state = transitionAgentConnectionResource(state, {
      type: AgentConnectionResourceEventType.AutonomousTurnCreated,
      turn: receiveOnly
    }).state
    state = transitionAgentConnectionResource(state, {
      type: AgentConnectionResourceEventType.TurnStreamOpened,
      turn: receiveOnly
    }).state

    const invalid = transitionAgentConnectionResource(state, {
      type: AgentConnectionResourceEventType.BeginTurn,
      turn: foreground
    })
    expect(invalid.state).toBe(state)
    expect(invalid.effects).toEqual([
      expect.objectContaining({ type: AgentConnectionResourceEventType.LogInvalidTransition })
    ])
  })

  it('drops a chunk with an explicit invalid-transition effect when no buffer owns it', () => {
    const state = createAgentConnectionResourceState<Turn, Reservation>(turn('user-1'))
    const result = transitionAgentConnectionResource(state, {
      type: AgentConnectionResourceEventType.BufferChunk,
      chunk: chunk('orphan')
    })

    expect(result.state).toBe(state)
    expect(result.effects).toEqual([
      {
        type: AgentConnectionResourceEventType.LogInvalidTransition,
        event: AgentConnectionResourceEventType.BufferChunk,
        state: AgentConnectionResourceKind.Turn
      }
    ])
  })

  it('keeps duplicate autonomous and background occupancy events idempotent', () => {
    const connection = {} as AgentRuntimeConnection
    let state = createAgentConnectionResourceState<Turn, Reservation>()
    state = transitionAgentConnectionResource(state, {
      type: AgentConnectionResourceEventType.ConnectionStarted,
      connectionAttemptId: 'connect-1'
    }).state
    state = transitionAgentConnectionResource(state, {
      type: AgentConnectionResourceEventType.ConnectionConnected,
      connectionAttemptId: 'connect-1',
      connection
    }).state
    state = transitionAgentConnectionResource(state, {
      type: AgentConnectionResourceEventType.AutonomousTurnState,
      state: AgentAutonomousGenerationState.Started
    }).state
    const duplicateAutonomous = transitionAgentConnectionResource(state, {
      type: AgentConnectionResourceEventType.AutonomousTurnState,
      state: AgentAutonomousGenerationState.Started
    })
    state = transitionAgentConnectionResource(state, {
      type: AgentConnectionResourceEventType.ConnectionOccupancy,
      occupancy: AgentConnectionOccupancyKind.Background,
      active: true
    }).state
    const duplicateBackground = transitionAgentConnectionResource(state, {
      type: AgentConnectionResourceEventType.ConnectionOccupancy,
      occupancy: AgentConnectionOccupancyKind.Background,
      active: true
    })

    expect(duplicateAutonomous.effects).toEqual([])
    expect(getAgentConnectionOccupancy(duplicateBackground.state)).toEqual({ background: true })
    expect(duplicateBackground.effects).toEqual([])
  })

  it('scopes occupancy to the connection so disconnect erases it structurally', () => {
    const connection = {} as AgentRuntimeConnection
    let state = createAgentConnectionResourceState<Turn, Reservation>()
    state = transitionAgentConnectionResource(state, {
      type: AgentConnectionResourceEventType.ConnectionStarted,
      connectionAttemptId: 'connect-1'
    }).state
    state = transitionAgentConnectionResource(state, {
      type: AgentConnectionResourceEventType.ConnectionConnected,
      connectionAttemptId: 'connect-1',
      connection
    }).state
    for (const occupancy of [AgentConnectionOccupancyKind.Background, AgentConnectionOccupancyKind.Compaction]) {
      state = transitionAgentConnectionResource(state, {
        type: AgentConnectionResourceEventType.ConnectionOccupancy,
        occupancy,
        active: true
      }).state
    }

    const disconnected = transitionAgentConnectionResource(state, {
      type: AgentConnectionResourceEventType.ConnectionDisconnected,
      connection
    })
    expect(getAgentConnectionOccupancy(disconnected.state)).toBeUndefined()
    expect(disconnected.effects).toEqual([
      { type: AgentConnectionResourceEventType.ReleaseBackgroundWaiter, connection },
      { type: AgentConnectionResourceEventType.CompactionInterrupted }
    ])
  })

  it('defers a rebuild behind background occupancy and releases it when the work drains', () => {
    const connection = {} as AgentRuntimeConnection
    let state = createAgentConnectionResourceState<Turn, Reservation>()
    state = transitionAgentConnectionResource(state, {
      type: AgentConnectionResourceEventType.ConnectionStarted,
      connectionAttemptId: 'connect-1'
    }).state
    state = transitionAgentConnectionResource(state, {
      type: AgentConnectionResourceEventType.ConnectionConnected,
      connectionAttemptId: 'connect-1',
      connection
    }).state
    state = transitionAgentConnectionResource(state, {
      type: AgentConnectionResourceEventType.ConnectionOccupancy,
      occupancy: AgentConnectionOccupancyKind.Background,
      active: true
    }).state
    state = transitionAgentConnectionResource(state, {
      type: AgentConnectionResourceEventType.ConnectionRebuildDeferred,
      connection,
      target: { modelId: 'model-2', reasoningEffort: 'default', knowledgeBaseIds: ['kb-1'] }
    }).state

    const result = transitionAgentConnectionResource(state, {
      type: AgentConnectionResourceEventType.ConnectionOccupancy,
      occupancy: AgentConnectionOccupancyKind.Background,
      active: false
    })
    expect(getAgentConnectionResource(result.state)).toBe(connection)
    expect(result.state.connection).toEqual({ kind: AgentConnectionResourceKind.Connected, connection, occupancy: {} })
    expect(result.effects).toEqual([{ type: AgentConnectionResourceEventType.ReleaseBackgroundWaiter, connection }])
  })

  it.each(Object.values(RemovedLaunchTarget))(
    'does not retain the removed %s scheduler state in the resource reducer',
    () => {
      const state = createAgentConnectionResourceState<Turn, Reservation>()
      expect('launch' in state).toBe(false)
      expect('queue' in state).toBe(false)
    }
  )

  it('ignores a stale connection detach without changing the current connection', () => {
    const current = {} as AgentRuntimeConnection
    const stale = {} as AgentRuntimeConnection
    let state = createAgentConnectionResourceState<Turn, Reservation>()
    state = transitionAgentConnectionResource(state, {
      type: AgentConnectionResourceEventType.ConnectionStarted,
      connectionAttemptId: 'connect-1'
    }).state
    state = transitionAgentConnectionResource(state, {
      type: AgentConnectionResourceEventType.ConnectionConnected,
      connectionAttemptId: 'connect-1',
      connection: current
    }).state

    const result = transitionAgentConnectionResource(state, {
      type: AgentConnectionResourceEventType.ConnectionDisconnected,
      connection: stale
    })
    expect(getAgentConnectionResource(result.state)).toBe(current)
    expect(result.effects).toEqual([
      expect.objectContaining({ type: AgentConnectionResourceEventType.LogInvalidTransition })
    ])
  })

  it('derives current turn and autonomous ownership from the generation union', () => {
    const receiveOnly = turn('wake')
    let state = createAgentConnectionResourceState<Turn, Reservation>()
    state = transitionAgentConnectionResource(state, {
      type: AgentConnectionResourceEventType.AutonomousTurnState,
      state: AgentAutonomousGenerationState.Started
    }).state
    state = transitionAgentConnectionResource(state, {
      type: AgentConnectionResourceEventType.AutonomousTurnCreated,
      turn: receiveOnly
    }).state

    expect(getAgentCurrentStreamResource(state)).toBe(receiveOnly)
    expect(isAgentAutonomousResourceActive(state)).toBe(true)
  })

  it('does not treat the current receive-only turn as a future continuation', () => {
    const receiveOnly = turn('wake')
    let state = createAgentConnectionResourceState<Turn, Reservation>()
    state = transitionAgentConnectionResource(state, {
      type: AgentConnectionResourceEventType.AutonomousTurnState,
      state: AgentAutonomousGenerationState.Started
    }).state
    state = transitionAgentConnectionResource(state, {
      type: AgentConnectionResourceEventType.AutonomousTurnCreated,
      turn: receiveOnly
    }).state
    state = transitionAgentConnectionResource(state, {
      type: AgentConnectionResourceEventType.AutonomousTurnState,
      state: AgentAutonomousGenerationState.Finished
    }).state

    expect(state.generation).toMatchObject({
      kind: AgentConnectionResourceKind.AutonomousTurn,
      turn: receiveOnly,
      ownership: AgentAutonomousResourceOwnership.Released
    })
    expect('continuation' in state.generation).toBe(false)
  })

  it('keeps a deferred user turn in Conversation state, never in the receive-only resource', () => {
    const foreground = turn('user')
    const receiveOnly = turn('wake')
    let state = createAgentConnectionResourceState<Turn, Reservation>(foreground)
    state = transitionAgentConnectionResource(state, {
      type: AgentConnectionResourceEventType.AutonomousTurnState,
      state: AgentAutonomousGenerationState.Started,
      contextTurn: foreground
    }).state
    state = transitionAgentConnectionResource(state, {
      type: AgentConnectionResourceEventType.AutonomousTurnCreated,
      turn: receiveOnly
    }).state

    expect(state.generation).toMatchObject({
      kind: AgentConnectionResourceKind.AutonomousTurn,
      turn: receiveOnly,
      contextTurn: foreground
    })
    expect('deferredTurn' in state.generation).toBe(false)
  })
})
