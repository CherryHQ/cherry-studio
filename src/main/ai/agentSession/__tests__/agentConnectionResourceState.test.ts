import type { AgentSessionMessageEntity } from '@shared/data/api/schemas/agentSessionMessages'
import { describe, expect, it } from 'vitest'

import {
  type AgentRuntimeConnection,
  type AgentRuntimeRedirectInput,
  toAgentRuntimeRedirectId,
  toAgentRuntimeSegmentId
} from '../../runtime/types'
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
  transitionAgentConnectionResource
} from '../agentConnectionResourceState'

interface Turn {
  id: string
}

const chunk = { type: 'text-delta', id: 'text-1', delta: 'hello' } as const
const sourceSegmentId = toAgentRuntimeSegmentId('segment-source')
const successorSegmentId = toAgentRuntimeSegmentId('segment-successor')
const autonomousSegmentId = toAgentRuntimeSegmentId('segment-autonomous')

function message(id: string): AgentSessionMessageEntity {
  return {
    id,
    sessionId: 'session-1',
    role: 'user',
    data: { parts: [{ type: 'text', text: id }] },
    status: 'success',
    modelId: null,
    messageSnapshot: null,
    stats: null,
    searchableText: id,
    runtimeResumeToken: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z'
  }
}

function redirect(id: string): AgentRuntimeRedirectInput {
  return {
    redirectId: toAgentRuntimeRedirectId(id),
    segmentId: sourceSegmentId,
    message: message(`message-${id}`)
  }
}

describe('Agent connection resource state', () => {
  it('tracks a connection turn without Topic leases or reservation identity', () => {
    const turn = { id: 'turn-1' }
    let state = createAgentConnectionResourceState<Turn, never>()
    state = transitionAgentConnectionResource(state, {
      type: AgentConnectionResourceEventType.BeginTurn,
      turn,
      segmentId: sourceSegmentId
    }).state
    state = transitionAgentConnectionResource(state, {
      type: AgentConnectionResourceEventType.TurnStreamOpened,
      turn
    }).state
    state = transitionAgentConnectionResource(state, {
      type: AgentConnectionResourceEventType.TurnSentToConnection,
      turn
    }).state

    expect(state.generation).toMatchObject({
      kind: AgentConnectionResourceKind.Turn,
      stream: AgentStreamResourcePhase.Open,
      delivery: AgentConnectionDeliveryPhase.Sent
    })

    state = transitionAgentConnectionResource(state, {
      type: AgentConnectionResourceEventType.DriverTerminal,
      segmentId: sourceSegmentId,
      outcome: { status: AgentDriverOutcomeKind.Success }
    }).state
    state = transitionAgentConnectionResource(state, {
      type: AgentConnectionResourceEventType.TurnReleased,
      turnId: turn.id,
      turn,
      status: AgentDriverOutcomeKind.Success
    }).state

    expect(state.generation.kind).toBe(AgentConnectionResourceKind.Idle)
    expect('turnOwnerships' in state).toBe(false)
    expect('continuationLease' in state).toBe(false)
  })

  it('releases a steer source before replaying buffered continuation output and terminal', () => {
    const source = { id: 'turn-1' }
    const continuation = { id: 'turn-2' }
    const queuedRedirect = redirect('redirect-1')
    let state = createAgentConnectionResourceState<Turn, string>()
    state = transitionAgentConnectionResource(state, {
      type: AgentConnectionResourceEventType.BeginTurn,
      turn: source,
      segmentId: sourceSegmentId
    }).state
    state = transitionAgentConnectionResource(state, {
      type: AgentConnectionResourceEventType.TurnStreamOpened,
      turn: source
    }).state
    state = transitionAgentConnectionResource(state, {
      type: AgentConnectionResourceEventType.RedirectQueued,
      redirect: queuedRedirect
    }).state
    state = transitionAgentConnectionResource(state, {
      type: AgentConnectionResourceEventType.ReserveSteer,
      reservation: 'steer-1'
    }).state

    const boundary = transitionAgentConnectionResource(state, {
      type: AgentConnectionResourceEventType.SteerBoundary,
      redirectIds: [queuedRedirect.redirectId],
      sourceSegmentId,
      successorSegmentId,
      headless: false
    })
    expect(boundary.effects).toEqual([
      {
        type: AgentConnectionResourceEventType.CloseTurnStream,
        turn: source,
        outcome: { status: AgentDriverOutcomeKind.Success }
      }
    ])
    state = boundary.state
    state = transitionAgentConnectionResource(state, {
      type: AgentConnectionResourceEventType.RuntimeChunk,
      segmentId: successorSegmentId,
      chunk
    }).state
    state = transitionAgentConnectionResource(state, {
      type: AgentConnectionResourceEventType.DriverTerminal,
      segmentId: successorSegmentId,
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
      turnId: source.id,
      turn: source,
      status: AgentDriverOutcomeKind.Success
    }).state

    const flushed = transitionAgentConnectionResource(state, {
      type: AgentConnectionResourceEventType.FlushTransition
    })
    expect(flushed.state.generation).toMatchObject({
      kind: AgentConnectionResourceKind.Turn,
      turn: continuation,
      stream: AgentStreamResourcePhase.AwaitingRelease
    })
    expect(flushed.effects).toEqual([
      { type: AgentConnectionResourceEventType.DeliverBuffer, turn: continuation, chunks: [chunk] },
      {
        type: AgentConnectionResourceEventType.CloseTurnStream,
        turn: continuation,
        outcome: { status: AgentDriverOutcomeKind.Success }
      }
    ])
  })

  it('carries redirects not delivered at the boundary into the successor segment', () => {
    const source = { id: 'turn-1' }
    const continuation = { id: 'turn-2' }
    const first = redirect('redirect-1')
    const second = redirect('redirect-2')
    let state = createAgentConnectionResourceState<Turn, never>()
    state = transitionAgentConnectionResource(state, {
      type: AgentConnectionResourceEventType.BeginTurn,
      turn: source,
      segmentId: sourceSegmentId
    }).state
    state = transitionAgentConnectionResource(state, {
      type: AgentConnectionResourceEventType.TurnStreamOpened,
      turn: source
    }).state
    for (const queued of [first, second]) {
      state = transitionAgentConnectionResource(state, {
        type: AgentConnectionResourceEventType.RedirectQueued,
        redirect: queued
      }).state
    }
    state = transitionAgentConnectionResource(state, {
      type: AgentConnectionResourceEventType.SteerBoundary,
      redirectIds: [first.redirectId],
      sourceSegmentId,
      successorSegmentId,
      headless: false
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
      turnId: source.id,
      turn: source,
      status: AgentDriverOutcomeKind.Success
    }).state

    const flushed = transitionAgentConnectionResource(state, {
      type: AgentConnectionResourceEventType.FlushTransition
    })

    expect(flushed.state.generation).toMatchObject({
      kind: AgentConnectionResourceKind.Turn,
      segmentId: successorSegmentId,
      redirects: [{ redirectId: second.redirectId, segmentId: successorSegmentId }]
    })
  })

  it('buffers autonomous output without owning the suspended foreground turn or its resume decision', () => {
    const deferred = { id: 'turn-user' }
    const autonomous = { id: 'turn-autonomous' }
    let state = createAgentConnectionResourceState<Turn, never>()
    state = transitionAgentConnectionResource(state, {
      type: AgentConnectionResourceEventType.AutonomousTurnState,
      state: AgentAutonomousGenerationState.Started,
      segmentId: autonomousSegmentId,
      contextTurn: deferred
    }).state
    state = transitionAgentConnectionResource(state, {
      type: AgentConnectionResourceEventType.RuntimeChunk,
      segmentId: autonomousSegmentId,
      chunk
    }).state
    state = transitionAgentConnectionResource(state, {
      type: AgentConnectionResourceEventType.DriverTerminal,
      segmentId: autonomousSegmentId,
      outcome: { status: AgentDriverOutcomeKind.Success }
    }).state
    state = transitionAgentConnectionResource(state, {
      type: AgentConnectionResourceEventType.AutonomousTurnState,
      state: AgentAutonomousGenerationState.Finished,
      segmentId: autonomousSegmentId
    }).state

    expect(state.generation).toMatchObject({
      kind: AgentConnectionResourceKind.AutonomousTurn,
      ownership: AgentAutonomousResourceOwnership.Released,
      driverOutcome: { status: AgentDriverOutcomeKind.Success }
    })

    state = transitionAgentConnectionResource(state, {
      type: AgentConnectionResourceEventType.AutonomousTurnCreated,
      turn: autonomous
    }).state
    state = transitionAgentConnectionResource(state, {
      type: AgentConnectionResourceEventType.TurnStreamOpened,
      turn: autonomous
    }).state
    const flushed = transitionAgentConnectionResource(state, {
      type: AgentConnectionResourceEventType.FlushTransition
    })
    expect(flushed.effects).toEqual([
      { type: AgentConnectionResourceEventType.DeliverBuffer, turn: autonomous, chunks: [chunk] },
      {
        type: AgentConnectionResourceEventType.CloseTurnStream,
        turn: autonomous,
        outcome: { status: AgentDriverOutcomeKind.Success }
      }
    ])

    const released = transitionAgentConnectionResource(flushed.state, {
      type: AgentConnectionResourceEventType.TurnReleased,
      turnId: autonomous.id,
      turn: autonomous,
      status: AgentDriverOutcomeKind.Success
    })
    expect(released.state.generation).toMatchObject({
      kind: AgentConnectionResourceKind.AutonomousTurn,
      ownership: AgentAutonomousResourceOwnership.Released,
      releaseOutcome: AgentDriverOutcomeKind.Success
    })
    expect('deferredTurn' in released.state.generation).toBe(false)
  })

  it('fences stale connection attempts and tears down background and compaction occupancy together', () => {
    const connection = {} as AgentRuntimeConnection
    const replacement = {} as AgentRuntimeConnection
    const target = {
      modelId: 'provider::model',
      reasoningEffort: 'medium',
      serviceTier: 'standard',
      knowledgeBaseIds: []
    }
    let state = createAgentConnectionResourceState<Turn, never>()
    state = transitionAgentConnectionResource(state, {
      type: AgentConnectionResourceEventType.ConnectionStarted,
      connectionAttemptId: 'connect-1'
    }).state

    const staleConnect = transitionAgentConnectionResource(state, {
      type: AgentConnectionResourceEventType.ConnectionConnected,
      connectionAttemptId: 'connect-2',
      connection: replacement
    })
    expect(staleConnect.state.connection).toMatchObject({
      kind: AgentConnectionResourceKind.Connecting,
      connectionAttemptId: 'connect-1'
    })
    expect(staleConnect.effects).toEqual([
      expect.objectContaining({ type: AgentConnectionResourceEventType.LogInvalidTransition })
    ])

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
      type: AgentConnectionResourceEventType.ConnectionOccupancy,
      occupancy: AgentConnectionOccupancyKind.Compaction,
      active: true
    }).state
    state = transitionAgentConnectionResource(state, {
      type: AgentConnectionResourceEventType.ConnectionRebuildDeferred,
      connection,
      target
    }).state

    const staleDisconnect = transitionAgentConnectionResource(state, {
      type: AgentConnectionResourceEventType.ConnectionDisconnected,
      connection: replacement
    })
    expect(staleDisconnect.state).toBe(state)

    const disconnected = transitionAgentConnectionResource(state, {
      type: AgentConnectionResourceEventType.ConnectionDisconnected,
      connection
    })
    expect(disconnected.state.connection.kind).toBe(AgentConnectionResourceKind.Disconnected)
    expect(disconnected.effects).toEqual([
      { type: AgentConnectionResourceEventType.ReleaseBackgroundWaiter, connection },
      { type: AgentConnectionResourceEventType.CompactionInterrupted }
    ])
  })

  it('ignores a release for another turn without evicting the live resource', () => {
    const live = { id: 'turn-live' }
    const stale = { id: 'turn-stale' }
    let state = createAgentConnectionResourceState<Turn, never>()
    state = transitionAgentConnectionResource(state, {
      type: AgentConnectionResourceEventType.BeginTurn,
      turn: live,
      segmentId: sourceSegmentId
    }).state
    const result = transitionAgentConnectionResource(state, {
      type: AgentConnectionResourceEventType.TurnReleased,
      turnId: stale.id,
      turn: stale,
      status: AgentDriverOutcomeKind.Paused
    })

    expect(result.state).toBe(state)
    expect(result.effects).toEqual([
      expect.objectContaining({ type: AgentConnectionResourceEventType.LogInvalidTransition })
    ])
  })
})
