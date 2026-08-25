import { describe, expect, it } from 'vitest'

import { toAgentRuntimeSegmentId } from '../../runtime/types'
import {
  AgentAutonomousGenerationState,
  AgentConnectionOccupancyKind,
  AgentConnectionResourceEventType,
  AgentConnectionResourceKind,
  AgentDriverOutcomeKind,
  createAgentConnectionResourceState,
  transitionAgentConnectionResource
} from '../agentConnectionResourceState'

type Turn = { id: string }

describe('subagent settlement wake (incident replay)', () => {
  it('delivers every wake-turn chunk into the receive-only stream under background occupancy', () => {
    const foreground = { id: 'foreground' }
    const wake = { id: 'wake' }
    const chunks = [
      { type: 'text-start', id: 'wake-text' },
      { type: 'text-delta', id: 'wake-text', delta: 'wake report part 1' },
      { type: 'text-delta', id: 'wake-text', delta: ' part 2' },
      { type: 'text-delta', id: 'wake-text', delta: ' part 3' },
      { type: 'text-end', id: 'wake-text' }
    ] as const
    const foregroundSegmentId = toAgentRuntimeSegmentId('segment-foreground')
    const wakeSegmentId = toAgentRuntimeSegmentId('segment-wake')

    let state = createAgentConnectionResourceState<Turn, never>()
    const effects: unknown[] = []
    const apply = (event: Parameters<typeof transitionAgentConnectionResource<Turn, never>>[1]) => {
      const result = transitionAgentConnectionResource(state, event)
      state = result.state
      effects.push(...result.effects)
    }
    const connection = {} as never
    apply({
      type: AgentConnectionResourceEventType.BeginTurn,
      turn: foreground,
      segmentId: foregroundSegmentId
    })
    apply({
      type: AgentConnectionResourceEventType.ConnectionStarted,
      connectionAttemptId: 'connect-1'
    })
    apply({
      type: AgentConnectionResourceEventType.ConnectionConnected,
      connectionAttemptId: 'connect-1',
      connection
    })
    apply({
      type: AgentConnectionResourceEventType.ConnectionOccupancy,
      occupancy: AgentConnectionOccupancyKind.Background,
      active: true
    })
    apply({
      type: AgentConnectionResourceEventType.AutonomousTurnState,
      state: AgentAutonomousGenerationState.Started,
      segmentId: wakeSegmentId,
      contextTurn: foreground
    })
    for (const chunk of chunks) {
      apply({
        type: AgentConnectionResourceEventType.RuntimeChunk,
        segmentId: wakeSegmentId,
        chunk
      })
    }
    apply({
      type: AgentConnectionResourceEventType.AutonomousTurnCreated,
      turn: wake
    })
    apply({
      type: AgentConnectionResourceEventType.TurnStreamOpened,
      turn: wake
    })
    apply({
      type: AgentConnectionResourceEventType.FlushTransition
    })
    apply({
      type: AgentConnectionResourceEventType.ConnectionOccupancy,
      occupancy: AgentConnectionOccupancyKind.Background,
      active: false
    })
    apply({
      type: AgentConnectionResourceEventType.DriverTerminal,
      segmentId: wakeSegmentId,
      outcome: { status: AgentDriverOutcomeKind.Success }
    })
    apply({
      type: AgentConnectionResourceEventType.AutonomousTurnState,
      state: AgentAutonomousGenerationState.Finished,
      segmentId: wakeSegmentId
    })
    expect(state.generation).toMatchObject({
      kind: AgentConnectionResourceKind.AutonomousTurn,
      turn: wake
    })
    const streamEffects = effects.filter(
      (effect) =>
        (effect as { type?: string }).type === AgentConnectionResourceEventType.DeliverBuffer ||
        (effect as { type?: string }).type === AgentConnectionResourceEventType.CloseTurnStream
    )
    expect(streamEffects).toEqual([
      { type: AgentConnectionResourceEventType.DeliverBuffer, turn: wake, chunks },
      {
        type: AgentConnectionResourceEventType.CloseTurnStream,
        turn: wake,
        outcome: { status: AgentDriverOutcomeKind.Success }
      }
    ])
  })
})
