import { BaseService } from '@main/core/lifecycle/BaseService'
import {
  ConversationKind,
  toConversationEffectId,
  toConversationExecutionId,
  toConversationTurnId
} from '@shared/ai/conversation'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ConversationEffectType } from '../../conversation'
import { toAgentRuntimeSegmentId } from '../../runtime/types'
import { AgentConnectionManager } from '../AgentConnectionManager'
import {
  AgentAutonomousGenerationState,
  AgentConnectionResourceEventType,
  AgentConnectionResourceKind,
  createAgentConnectionResourceState,
  transitionAgentConnectionResource
} from '../agentConnectionResourceState'
import { AgentConversationResourceEffectResultKind } from '../agentConversationResourceResult'

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((settle) => {
    resolve = settle
  })
  return { promise, resolve }
}

describe('AgentConnectionManager backup quiescence', () => {
  beforeEach(() => BaseService.resetInstances())

  it('closes idle warm connections when the first pause barrier opens', () => {
    const manager = new AgentConnectionManager()
    const internals = manager as unknown as {
      entries: Map<string, { resources: ReturnType<typeof createAgentConnectionResourceState> }>
    }
    internals.entries.set('session-1', { resources: createAgentConnectionResourceState() })
    const close = vi.spyOn(manager, 'closeSession').mockResolvedValue()

    const hold = manager.pause('backup')

    expect(close).toHaveBeenCalledWith('session-1')
    hold.dispose()
  })

  it('drains connection descendants to a fixed point with stable operation ids', async () => {
    const manager = new AgentConnectionManager()
    const start = deferred<boolean>()
    const close = deferred<void>()
    const internals = manager as unknown as {
      connectionStarts: Map<string, { id: string; promise: Promise<boolean> }>
      sessionTeardowns: Map<string, { id: string; promise: Promise<void>; phase: 'closing' }>
    }
    internals.connectionStarts.set('session-1', { id: 'start-1', promise: start.promise })
    const hold = manager.pause('backup')
    const draining = manager.drainInFlight({ timeoutMs: 5_000 })
    let drained = false
    void draining.then(() => {
      drained = true
    })

    internals.sessionTeardowns.set('session-1', { id: 'close-1', promise: close.promise, phase: 'closing' })
    start.resolve(true)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(drained).toBe(false)

    close.resolve()
    await expect(draining).resolves.toEqual({ stragglerIds: [] })
    hold.dispose()
  })

  it('projects every connection operation awaited by drain as busy', () => {
    const manager = new AgentConnectionManager()
    const start = deferred<boolean>()
    const close = deferred<void>()
    const internals = manager as unknown as {
      connectionStarts: Map<string, { id: string; promise: Promise<boolean> }>
      sessionTeardowns: Map<string, { id: string; promise: Promise<void>; phase: 'closing' }>
    }

    internals.connectionStarts.set('session-1', { id: 'start-1', promise: start.promise })
    expect(manager.hasBusySessions()).toBe(true)
    internals.connectionStarts.clear()
    internals.sessionTeardowns.set('session-1', { id: 'close-1', promise: close.promise, phase: 'closing' })
    expect(manager.hasBusySessions()).toBe(true)
    internals.sessionTeardowns.clear()
    expect(manager.hasBusySessions()).toBe(false)

    start.resolve(false)
    close.resolve()
  })

  it('reports the exact connection operation when drain times out', async () => {
    const manager = new AgentConnectionManager()
    const close = deferred<void>()
    const internals = manager as unknown as {
      sessionTeardowns: Map<string, { id: string; promise: Promise<void>; phase: 'closing' }>
    }
    internals.sessionTeardowns.set('session-1', { id: 'close-1', promise: close.promise, phase: 'closing' })
    const hold = manager.pause('backup')

    await expect(manager.drainInFlight({ timeoutMs: 0 })).resolves.toEqual({
      stragglerIds: ['connection-close:session-1:close-1']
    })

    close.resolve()
    hold.dispose()
  })

  it('discards the exact preempted autonomous resource on Stop', () => {
    const manager = new AgentConnectionManager()
    const foreground = { turnId: 'foreground-turn' }
    const autonomous = { turnId: 'autonomous-turn' }
    const foregroundSegmentId = toAgentRuntimeSegmentId('segment-foreground')
    const autonomousSegmentId = toAgentRuntimeSegmentId('segment-autonomous')
    let resources = createAgentConnectionResourceState<typeof foreground, never>()
    resources = transitionAgentConnectionResource(resources, {
      type: AgentConnectionResourceEventType.BeginTurn,
      turn: foreground,
      segmentId: foregroundSegmentId
    }).state
    resources = transitionAgentConnectionResource(resources, {
      type: AgentConnectionResourceEventType.AutonomousTurnState,
      state: AgentAutonomousGenerationState.Started,
      segmentId: autonomousSegmentId,
      contextTurn: foreground
    }).state
    resources = transitionAgentConnectionResource(resources, {
      type: AgentConnectionResourceEventType.AutonomousTurnCreated,
      turn: autonomous
    }).state
    const preemptionId = toConversationEffectId('preemption-1')
    const foregroundTurnId = toConversationTurnId('conversation-turn-1')
    const foregroundExecutionId = toConversationExecutionId('conversation-execution-1')
    const internals = manager as unknown as {
      entries: Map<string, { conversation: { kind: ConversationKind.Agent; id: string }; resources: typeof resources }>
      suspendedConversationTurns: Map<
        typeof preemptionId,
        {
          conversation: { kind: ConversationKind.Agent; id: string }
          turnId: typeof foregroundTurnId
          executionId: typeof foregroundExecutionId
          suspendEffectId: typeof preemptionId
          runtimeTurnId: string
          turn: typeof foreground
        }
      >
      closeTurn: (turn: typeof autonomous) => void
      refreshIdleTimer: (entry: unknown) => void
    }
    internals.entries.set('session-1', {
      conversation: { kind: ConversationKind.Agent, id: 'session-1' },
      resources
    })
    internals.suspendedConversationTurns.set(preemptionId, {
      conversation: { kind: ConversationKind.Agent, id: 'session-1' },
      turnId: foregroundTurnId,
      executionId: foregroundExecutionId,
      runtimeTurnId: foreground.turnId,
      suspendEffectId: preemptionId,
      turn: foreground
    })
    internals.closeTurn = vi.fn()
    internals.refreshIdleTimer = vi.fn()

    manager.discardAutonomousBuffer({
      type: ConversationEffectType.DiscardRuntimeBuffer,
      conversation: { kind: ConversationKind.Agent, id: 'session-1' },
      turnId: foregroundTurnId,
      effectId: toConversationEffectId('discard-stale'),
      preemptionId: toConversationEffectId('stale-preemption')
    })
    expect(internals.entries.get('session-1')?.resources.generation.kind).toBe(
      AgentConnectionResourceKind.AutonomousTurn
    )

    manager.discardAutonomousBuffer({
      type: ConversationEffectType.DiscardRuntimeBuffer,
      conversation: { kind: ConversationKind.Agent, id: 'session-1' },
      turnId: toConversationTurnId('stale-conversation-turn'),
      effectId: toConversationEffectId('discard-stale-turn'),
      preemptionId
    })
    expect(internals.entries.get('session-1')?.resources.generation.kind).toBe(
      AgentConnectionResourceKind.AutonomousTurn
    )

    manager.discardAutonomousBuffer({
      type: ConversationEffectType.DiscardRuntimeBuffer,
      conversation: { kind: ConversationKind.Agent, id: 'session-1' },
      turnId: foregroundTurnId,
      effectId: toConversationEffectId('discard-1'),
      preemptionId
    })
    expect(internals.closeTurn).toHaveBeenCalledWith(autonomous)
    expect(internals.entries.get('session-1')?.resources.generation.kind).toBe(AgentConnectionResourceKind.Idle)
    expect(internals.suspendedConversationTurns.has(preemptionId)).toBe(false)
    expect(internals.refreshIdleTimer).toHaveBeenCalledOnce()
  })

  it('resumes only the exact suspended Conversation execution and runtime turn', () => {
    const manager = new AgentConnectionManager()
    const conversation = { kind: ConversationKind.Agent, id: 'session-1' } as const
    const foreground = { turnId: 'runtime-turn-1', activeToolIds: new Set<string>() }
    const resources = transitionAgentConnectionResource(
      createAgentConnectionResourceState<typeof foreground, never>(),
      {
        type: AgentConnectionResourceEventType.BeginTurn,
        turn: foreground,
        segmentId: toAgentRuntimeSegmentId('segment-foreground')
      }
    ).state
    const internals = manager as unknown as {
      entries: Map<
        string,
        {
          conversation: typeof conversation
          resources: typeof resources
        }
      >
    }
    internals.entries.set(conversation.id, { conversation, resources })
    const turnId = toConversationTurnId('conversation-turn-1')
    const executionId = toConversationExecutionId('conversation-execution-1')
    const suspendEffectId = toConversationEffectId('suspend-1')

    expect(
      manager.suspendConversationExecution(
        {
          type: ConversationEffectType.SuspendExecution,
          conversation,
          turnId,
          executionId,
          effectId: suspendEffectId
        },
        foreground.turnId
      )
    ).toEqual({ kind: AgentConversationResourceEffectResultKind.Applied, effectId: suspendEffectId })

    const resume = (overrides: { turnId?: typeof turnId; executionId?: typeof executionId; runtimeTurnId?: string }) =>
      manager.resumeConversationExecution(
        {
          type: ConversationEffectType.ResumeSuspendedExecution,
          conversation,
          turnId: overrides.turnId ?? turnId,
          executionId: overrides.executionId ?? executionId,
          effectId: toConversationEffectId('resume-1'),
          runEffectId: toConversationEffectId('run-1'),
          suspendEffectId
        },
        overrides.runtimeTurnId ?? foreground.turnId
      )

    expect(resume({ turnId: toConversationTurnId('stale-turn') }).kind).toBe(
      AgentConversationResourceEffectResultKind.Stale
    )
    expect(resume({ executionId: toConversationExecutionId('stale-execution') }).kind).toBe(
      AgentConversationResourceEffectResultKind.Stale
    )
    expect(resume({ runtimeTurnId: 'stale-runtime-turn' }).kind).toBe(AgentConversationResourceEffectResultKind.Stale)
    expect(resume({}).kind).toBe(AgentConversationResourceEffectResultKind.Applied)
    expect(internals.entries.get(conversation.id)?.resources.generation).toMatchObject({
      kind: AgentConnectionResourceKind.Turn,
      turn: foreground
    })
  })
})
