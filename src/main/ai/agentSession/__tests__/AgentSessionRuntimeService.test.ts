import { EventEmitter } from 'node:events'

import { agentService } from '@data/services/AgentService'
import { agentSessionMessageService } from '@data/services/AgentSessionMessageService'
import { agentSessionService } from '@data/services/AgentSessionService'
import { aiUsageRecordService } from '@data/services/AiUsageRecordService'
import { BaseService } from '@main/core/lifecycle/BaseService'
import { getDependencies } from '@main/core/lifecycle/decorators'
import { AGENT_SESSION_API_RETRY_CACHE_KEY } from '@shared/ai/agentSessionApiRetry'
import {
  AGENT_SESSION_BACKGROUND_TASKS_CACHE_KEY,
  AGENT_SESSION_TASK_EVENTS_CACHE_KEY
} from '@shared/ai/agentSessionBackgroundTasks'
import { AGENT_SESSION_COMPACTION_CACHE_KEY } from '@shared/ai/agentSessionCompaction'
import { AGENT_SESSION_CONTEXT_USAGE_CACHE_KEY } from '@shared/ai/agentSessionContextUsage'
import { AGENT_SESSION_FLOW_PARTS_CACHE_KEY } from '@shared/ai/agentSessionFlowParts'
import { AGENT_SESSION_SLASH_COMMANDS_CACHE_KEY } from '@shared/ai/agentSessionSlashCommands'
import {
  ConversationActivityKind,
  ConversationKind,
  toConversationActivityId,
  toConversationEffectId,
  toConversationExecutionId,
  toConversationInputId,
  toConversationTurnId
} from '@shared/ai/conversation'
import type { UniqueModelId } from '@shared/data/types/model'
import { mockMainLoggerService } from '@test-mocks/MainLoggerService'
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from 'vitest'

const services = vi.hoisted(() => {
  const sharedValues = new Map<string, unknown>()
  return {
    sharedValues,
    cache: {
      setShared: vi.fn((key: string, value: unknown) => {
        sharedValues.set(key, value)
      }),
      getShared: vi.fn((key: string) => sharedValues.get(key)),
      deleteShared: vi.fn((key: string) => {
        sharedValues.delete(key)
      })
    },
    conversation: {
      openAgentActivity: vi.fn(() => 'activity-1'),
      closeAgentActivity: vi.fn(),
      abort: vi.fn(),
      acceptAgentRedirects: vi.fn(),
      resolveAgentInteraction: vi.fn(),
      enqueueAgentUndelivered: vi.fn(),
      startAgentAutonomous: vi.fn(() => true)
    },
    warmQuery: { closeAgentSessionWarm: vi.fn() }
  }
})
vi.mock('@application', () => ({
  application: {
    get: (name: string) => {
      if (name === 'ConversationRuntimeService') return services.conversation
      if (name === 'ClaudeCodeWarmQueryManager') return services.warmQuery
      return services.cache
    }
  }
}))

import { ConversationEffectType, ConversationResponderKind } from '../../conversation'
import { runtimeDriverRegistry } from '../../runtime/registry'
import {
  AgentApprovalLifetime,
  AgentRuntimeAutonomousState,
  type AgentRuntimeConnection,
  type AgentRuntimeEvent,
  AgentRuntimeEventType,
  AgentRuntimeMessageAssociation,
  AgentRuntimeReconcileResult,
  type AgentRuntimeRedirectInput,
  AgentRuntimeRedirectReceiptKind,
  type AgentRuntimeUserInput,
  AgentSessionUsageCaptureOwner,
  AiRuntimeCapability,
  toAgentRuntimeRedirectId,
  toAgentRuntimeSegmentId
} from '../../runtime/types'
import { agentChatContextProvider } from '../../streamManager'
import { toolApprovalRegistry } from '../../toolApproval/ToolApprovalRegistry'
import { AgentConnectionManager } from '../AgentConnectionManager'
import {
  AgentAutonomousGenerationState,
  AgentAutonomousResourceOwnership,
  AgentConnectionDeliveryPhase,
  AgentConnectionOccupancyKind,
  AgentConnectionResourceEventType,
  AgentConnectionResourceKind,
  type AgentConnectionResourceState,
  AgentDriverOutcomeKind,
  AgentStreamResourcePhase,
  createAgentConnectionResourceState,
  getAgentConnectionOccupancy,
  getAgentCurrentSegmentId,
  getAgentCurrentStreamResource,
  getAgentLiveStreamResource,
  hasAgentCompactionResource,
  hasAgentConnectionBackgroundWork,
  hasAgentConnectionResources,
  hasOpenAgentStreamResource,
  isAgentAutonomousResourceActive,
  isAgentTurnSentToConnection,
  transitionAgentConnectionResource
} from '../agentConnectionResourceState'

type Turn = { id: string; abortController: AbortController }
type Reservation = { id: string }

const turn = (id: string): Turn => ({ id, abortController: new AbortController() })
const chunk = (text: string) => ({ type: 'text-delta' as const, id: 'text-1', delta: text })
const sourceSegmentId = toAgentRuntimeSegmentId('segment-source')
const successorSegmentId = toAgentRuntimeSegmentId('segment-successor')
const autonomousSegmentId = toAgentRuntimeSegmentId('segment-autonomous')

function resourceState(current?: Turn): AgentConnectionResourceState<Turn, Reservation> {
  const state = createAgentConnectionResourceState<Turn, Reservation>()
  if (!current) return state
  return transitionAgentConnectionResource(state, {
    type: AgentConnectionResourceEventType.BeginTurn,
    turn: current,
    segmentId: sourceSegmentId
  }).state
}
const neverRuntimeEvents = (): AsyncIterable<AgentRuntimeEvent> => ({
  [Symbol.asyncIterator]: () => ({
    next: () => new Promise<IteratorResult<AgentRuntimeEvent>>(() => {})
  })
})
const closableRuntimeEvents = () => {
  let closed = false
  let finish: (() => void) | undefined
  return {
    events: {
      [Symbol.asyncIterator]: () => ({
        next: () => {
          if (closed) return Promise.resolve({ done: true as const, value: undefined })
          return new Promise<IteratorResult<AgentRuntimeEvent>>((resolve) => {
            finish = () => resolve({ done: true, value: undefined })
          })
        }
      })
    } satisfies AsyncIterable<AgentRuntimeEvent>,
    close: () => {
      closed = true
      finish?.()
    }
  }
}
const input = (text: string): AgentRuntimeUserInput => ({
  segmentId: sourceSegmentId,
  message: {
    id: `message-${text}`,
    data: { parts: [{ type: 'text', text }] }
  } as AgentRuntimeUserInput['message']
})

const redirectInput = (id: string, text = id): AgentRuntimeRedirectInput => ({
  ...input(text),
  redirectId: toAgentRuntimeRedirectId(id)
})

function queueRedirectResource(
  state: AgentConnectionResourceState<Turn, Reservation>,
  redirect: AgentRuntimeRedirectInput
): AgentConnectionResourceState<Turn, Reservation> {
  return transitionAgentConnectionResource(state, {
    type: AgentConnectionResourceEventType.RedirectQueued,
    redirect
  }).state
}
const userMessage = (id: string, knowledgeBaseIds: string[] = []) =>
  ({
    id,
    data: {
      parts: [
        { type: 'text', text: id },
        ...(knowledgeBaseIds.length > 0 ? [{ type: 'data-knowledge-scope', data: { baseIds: knowledgeBaseIds } }] : [])
      ]
    }
  }) as AgentRuntimeUserInput['message']

describe('legacy AgentSessionRuntimeService behavior on split owners', () => {
  beforeEach(() => {
    toolApprovalRegistry.clear('test-reset')
    vi.restoreAllMocks()
    BaseService.resetInstances()
    vi.clearAllMocks()
    services.sharedValues.clear()
  })

  it('keeps connection resources separate from Conversation-owned input queues', () => {
    const state = resourceState(turn('turn-1'))

    expect(state.generation.kind).toBe(AgentConnectionResourceKind.Turn)
    expect('queue' in state).toBe(false)
    expect('deferredTurn' in state).toBe(false)
  })

  describe('respondToolApproval', () => {
    it('clears the live awaiting-approval anchor as soon as the decision is dispatched', () => {
      const resolve = vi.fn()
      toolApprovalRegistry.register({
        approvalId: 'approval-1',
        sessionId: 'session-1',
        toolCallId: 'tool-call-1',
        toolName: 'Bash',
        originalInput: { command: 'sleep 10' },
        resolve
      })
      const manager = new AgentConnectionManager()

      expect(manager.respondToolApproval('approval-1', { approved: true })).toBe(true)

      expect(resolve).toHaveBeenCalledExactlyOnceWith({ approved: true })
      expect(services.conversation.resolveAgentInteraction).toHaveBeenCalledExactlyOnceWith('session-1', 'approval-1')
      expect(toolApprovalRegistry.peek('approval-1')).toBeUndefined()
    })

    it('settles a persisted background interaction before resolving the requesting agent', () => {
      const resolve = vi.fn()
      const applyDecision = vi.spyOn(agentSessionMessageService, 'applyToolApprovalDecision').mockReturnValue(true)
      toolApprovalRegistry.register({
        approvalId: 'approval-bg',
        sessionId: 'session-1',
        toolCallId: 'tool-call-bg',
        toolName: 'AskUserQuestion',
        originalInput: { questions: [] },
        lifetime: AgentApprovalLifetime.SessionMessage,
        resolve
      })
      const claim = toolApprovalRegistry.claimMessage('approval-bg', 'session-1')
      if (!claim) throw new Error('message approval was not claimable')
      toolApprovalRegistry.bindMessage(claim, 'approval-message-1')
      const updatedInput = { questions: [], answers: { Choice: 'SQLite' } }
      const manager = new AgentConnectionManager()

      expect(manager.respondToolApproval('approval-bg', { approved: true, updatedInput }, 'approval-message-1')).toBe(
        true
      )

      expect(applyDecision).toHaveBeenCalledExactlyOnceWith('session-1', 'approval-message-1', {
        approvalId: 'approval-bg',
        approved: true,
        updatedInput
      })
      expect(resolve).toHaveBeenCalledExactlyOnceWith({ approved: true, updatedInput })
      expect(applyDecision.mock.invocationCallOrder[0]).toBeLessThan(resolve.mock.invocationCallOrder[0])
      expect(services.conversation.resolveAgentInteraction).not.toHaveBeenCalled()
    })

    it('keeps the background agent waiting when its persisted interaction cannot be settled', () => {
      const resolve = vi.fn()
      vi.spyOn(agentSessionMessageService, 'applyToolApprovalDecision').mockReturnValue(false)
      toolApprovalRegistry.register({
        approvalId: 'approval-bg',
        sessionId: 'session-1',
        toolCallId: 'tool-call-bg',
        toolName: 'AskUserQuestion',
        originalInput: { questions: [] },
        lifetime: AgentApprovalLifetime.SessionMessage,
        resolve
      })
      const claim = toolApprovalRegistry.claimMessage('approval-bg', 'session-1')
      if (!claim) throw new Error('message approval was not claimable')
      toolApprovalRegistry.bindMessage(claim, 'approval-message-1')
      const manager = new AgentConnectionManager()

      expect(manager.respondToolApproval('approval-bg', { approved: true }, 'wrong-message')).toBe(false)

      expect(resolve).not.toHaveBeenCalled()
      expect(toolApprovalRegistry.peek('approval-bg')).toBeDefined()
    })

    it('leaves stream status untouched for an unknown approval', () => {
      const manager = new AgentConnectionManager()

      expect(manager.respondToolApproval('missing', { approved: true })).toBe(false)

      expect(services.conversation.resolveAgentInteraction).not.toHaveBeenCalled()
    })
  })

  describe('Agent HistoryPort — boot crash recovery', () => {
    it('resolves crash-orphaned pending rows with terminalized parts and invalidates their sessions', () => {
      vi.spyOn(agentSessionMessageService, 'findCrashOrphanedAssistantMessages').mockReturnValue([
        {
          id: 'stale-1',
          sessionId: 'session-a',
          data: {
            parts: [
              { type: 'text', text: 'partial answer' },
              {
                type: 'tool-Bash',
                toolCallId: 'call-1',
                state: 'input-available',
                input: { command: 'ls' }
              }
            ]
          }
        },
        { id: 'stale-2', sessionId: 'session-a', data: { parts: [] } },
        { id: 'stale-3', sessionId: 'session-b', data: {} }
      ] as never)
      const resolveOrphans = vi
        .spyOn(agentSessionMessageService, 'resolveCrashOrphanedMessages')
        .mockReturnValue(undefined)
      expect(agentChatContextProvider.recoverCrashOrphans()).toEqual({
        repairedOutputs: [
          { outputNodeId: 'stale-1', status: 'error' },
          { outputNodeId: 'stale-2', status: 'error' },
          { outputNodeId: 'stale-3', status: 'error' }
        ]
      })

      expect(resolveOrphans).toHaveBeenCalledWith(
        [
          {
            id: 'stale-1',
            data: {
              parts: [
                { type: 'text', text: 'partial answer' },
                expect.objectContaining({
                  type: 'tool-Bash',
                  toolCallId: 'call-1',
                  state: 'output-error'
                })
              ]
            }
          },
          { id: 'stale-2', data: { parts: [] } },
          { id: 'stale-3', data: { parts: [] } }
        ],
        ['session-a', 'session-b']
      )
    })

    it('does not resolve anything when there are no stale messages', () => {
      vi.spyOn(agentSessionMessageService, 'findCrashOrphanedAssistantMessages').mockReturnValue([])
      const resolveOrphans = vi
        .spyOn(agentSessionMessageService, 'resolveCrashOrphanedMessages')
        .mockReturnValue(undefined)

      expect(agentChatContextProvider.recoverCrashOrphans()).toEqual({ repairedOutputs: [] })

      expect(resolveOrphans).not.toHaveBeenCalled()
    })

    it('propagates recovery failures so the Conversation owner can retain and retry the operation', () => {
      vi.spyOn(agentSessionMessageService, 'findCrashOrphanedAssistantMessages').mockImplementation(() => {
        throw new Error('db down')
      })
      const resolveOrphans = vi
        .spyOn(agentSessionMessageService, 'resolveCrashOrphanedMessages')
        .mockReturnValue(undefined)

      expect(() => agentChatContextProvider.recoverCrashOrphans()).toThrow('db down')
      expect(resolveOrphans).not.toHaveBeenCalled()
    })
  })

  it('tracks unopened, open, and sent phases for the exact turn', () => {
    const current = turn('turn-1')
    let state = resourceState(current)
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
    expect(isAgentTurnSentToConnection(state, current)).toBe(true)
  })

  it('does not evict a turn until Conversation terminal persistence releases it', () => {
    const current = turn('turn-1')
    let state = resourceState(current)
    state = transitionAgentConnectionResource(state, {
      type: AgentConnectionResourceEventType.TurnStreamOpened,
      turn: current
    }).state
    const terminal = transitionAgentConnectionResource(state, {
      type: AgentConnectionResourceEventType.DriverTerminal,
      segmentId: sourceSegmentId,
      outcome: { status: AgentDriverOutcomeKind.Success }
    })

    expect(terminal.state.generation).toMatchObject({ stream: AgentStreamResourcePhase.AwaitingRelease })
    expect(hasAgentConnectionResources(terminal.state)).toBe(true)

    const released = transitionAgentConnectionResource(terminal.state, {
      type: AgentConnectionResourceEventType.TurnReleased,
      turnId: current.id,
      turn: current,
      status: AgentDriverOutcomeKind.Success
    })
    expect(released.state.generation).toEqual({ kind: AgentConnectionResourceKind.Idle, lastTurn: current })
  })

  it('latches an early terminal until the stream is available', () => {
    const current = turn('turn-1')
    let state = resourceState(current)
    state = transitionAgentConnectionResource(state, {
      type: AgentConnectionResourceEventType.DriverTerminal,
      segmentId: sourceSegmentId,
      outcome: { status: AgentDriverOutcomeKind.Error, error: 'early' }
    }).state
    state = transitionAgentConnectionResource(state, {
      type: AgentConnectionResourceEventType.TurnStreamOpened,
      turn: current
    }).state
    const flushed = transitionAgentConnectionResource(state, {
      type: AgentConnectionResourceEventType.FlushTransition
    })

    expect(flushed.effects).toEqual([
      {
        type: AgentConnectionResourceEventType.CloseTurnStream,
        turn: current,
        outcome: { status: AgentDriverOutcomeKind.Error, error: 'early' }
      }
    ])
  })

  it('keeps the first terminal outcome when duplicate driver callbacks race', () => {
    const current = turn('turn-1')
    let state = resourceState(current)
    state = transitionAgentConnectionResource(state, {
      type: AgentConnectionResourceEventType.DriverTerminal,
      segmentId: sourceSegmentId,
      outcome: { status: AgentDriverOutcomeKind.Error, error: 'first' }
    }).state
    state = transitionAgentConnectionResource(state, {
      type: AgentConnectionResourceEventType.DriverTerminal,
      segmentId: sourceSegmentId,
      outcome: { status: AgentDriverOutcomeKind.Success }
    }).state

    expect(state.generation).toMatchObject({
      driverOutcome: { status: AgentDriverOutcomeKind.Error, error: 'first' }
    })
  })

  it('surfaces a runtime error event via controller.error and drops trailing chunks (REGRESSION agent-session-3)', () => {
    const manager = new AgentConnectionManager()
    manager.prepareTurnResources({
      conversation: { kind: ConversationKind.Agent, id: 'session-1' },
      agentId: 'agent-1',
      agentType: 'test-runtime',
      modelId: 'provider::model',
      assistantMessageId: 'assistant-1',
      userMessage: userMessage('user-1')
    })
    type StreamTurn = Turn & {
      controller?: {
        enqueue: ReturnType<typeof vi.fn>
        error: ReturnType<typeof vi.fn>
        close: ReturnType<typeof vi.fn>
      }
    }
    const internals = manager as unknown as {
      entries: Map<
        string,
        { resources: ReturnType<typeof createAgentConnectionResourceState<StreamTurn, Reservation>> }
      >
      handleRuntimeEvent: (
        current: { resources: ReturnType<typeof createAgentConnectionResourceState<StreamTurn, Reservation>> },
        event: AgentRuntimeEvent
      ) => void
    }
    const entry = internals.entries.get('session-1')!
    const current = getAgentCurrentStreamResource(entry.resources)!
    const currentSegmentId = getAgentCurrentSegmentId(entry.resources)!
    const controller = { enqueue: vi.fn(), error: vi.fn(), close: vi.fn() }
    current.controller = controller
    entry.resources = transitionAgentConnectionResource(entry.resources, {
      type: AgentConnectionResourceEventType.TurnStreamOpened,
      turn: current
    }).state
    const runtimeError = new Error('runtime boom')

    internals.handleRuntimeEvent.call(manager, entry, {
      type: AgentRuntimeEventType.Error,
      segmentId: currentSegmentId,
      error: runtimeError
    })
    internals.handleRuntimeEvent.call(manager, entry, {
      type: AgentRuntimeEventType.Chunk,
      segmentId: currentSegmentId,
      chunk: { type: 'text-delta', id: 'text-1', delta: 'late' }
    })

    expect(controller.error).toHaveBeenCalledExactlyOnceWith(runtimeError)
    expect(controller.enqueue).not.toHaveBeenCalled()
    expect(entry.resources.generation).toMatchObject({ stream: AgentStreamResourcePhase.AwaitingRelease })
  })

  it('routes runtime events from the selected driver into the active turn', () => {
    const manager = new AgentConnectionManager()
    manager.prepareTurnResources({
      conversation: { kind: ConversationKind.Agent, id: 'session-1' },
      agentId: 'agent-1',
      agentType: 'test-runtime',
      modelId: 'provider::model',
      assistantMessageId: 'assistant-1',
      userMessage: userMessage('user-1')
    })
    type StreamTurn = Turn & {
      controller?: {
        enqueue: ReturnType<typeof vi.fn>
        error: ReturnType<typeof vi.fn>
        close: ReturnType<typeof vi.fn>
      }
    }
    const internals = manager as unknown as {
      entries: Map<
        string,
        { resources: ReturnType<typeof createAgentConnectionResourceState<StreamTurn, Reservation>> }
      >
      handleRuntimeEvent: (
        current: { resources: ReturnType<typeof createAgentConnectionResourceState<StreamTurn, Reservation>> },
        event: AgentRuntimeEvent
      ) => void
    }
    const entry = internals.entries.get('session-1')!
    const current = getAgentCurrentStreamResource(entry.resources)!
    const currentSegmentId = getAgentCurrentSegmentId(entry.resources)!
    const controller = { enqueue: vi.fn(), error: vi.fn(), close: vi.fn() }
    current.controller = controller
    entry.resources = transitionAgentConnectionResource(entry.resources, {
      type: AgentConnectionResourceEventType.TurnStreamOpened,
      turn: current
    }).state
    const runtimeChunk = { type: 'text-delta' as const, id: 'text-1', delta: 'hello' }

    internals.handleRuntimeEvent.call(manager, entry, {
      type: AgentRuntimeEventType.Chunk,
      segmentId: currentSegmentId,
      chunk: runtimeChunk
    })

    expect(controller.enqueue).toHaveBeenCalledExactlyOnceWith(runtimeChunk)
    expect(controller.error).not.toHaveBeenCalled()
  })

  it('warns for an abort but errors for a real failure when the runtime ends with no active turn (S5)', () => {
    const manager = new AgentConnectionManager()
    const handle = manager.prepareTurnResources({
      conversation: { kind: ConversationKind.Agent, id: 'session-1' },
      agentId: 'agent-1',
      agentType: 'test-runtime',
      modelId: 'provider::model',
      assistantMessageId: 'assistant-1',
      userMessage: userMessage('user-1')
    })
    const entry = (manager as unknown as { entries: Map<string, { resources: unknown }> }).entries.get('session-1')!
    let resources = entry.resources as ReturnType<typeof resourceState>
    const current = getAgentCurrentStreamResource(resources)!
    const currentSegmentId = getAgentCurrentSegmentId(resources)!
    resources = transitionAgentConnectionResource(resources, {
      type: AgentConnectionResourceEventType.TurnStreamOpened,
      turn: current
    }).state
    resources = transitionAgentConnectionResource(resources, {
      type: AgentConnectionResourceEventType.DriverTerminal,
      segmentId: currentSegmentId,
      outcome: { status: AgentDriverOutcomeKind.Success }
    }).state
    entry.resources = resources
    manager.releaseTurnResource('session-1', AgentDriverOutcomeKind.Success, handle.turnId)
    const handleRuntimeError = (
      manager as unknown as {
        handleRuntimeError: (
          currentEntry: typeof entry,
          segmentId: ReturnType<typeof toAgentRuntimeSegmentId>,
          error: unknown
        ) => void
      }
    ).handleRuntimeError.bind(manager)
    const abort = Object.assign(new Error('aborted'), { name: 'AbortError' })
    const failure = new Error('runtime failed')

    handleRuntimeError(entry, currentSegmentId, abort)
    handleRuntimeError(entry, currentSegmentId, failure)

    expect(mockMainLoggerService.warn).toHaveBeenCalledWith(
      'Agent runtime connection ended without an active turn',
      expect.objectContaining({ sessionId: 'session-1', error: abort })
    )
    expect(mockMainLoggerService.error).toHaveBeenCalledWith(
      'Agent runtime connection ended without an active turn',
      expect.objectContaining({ sessionId: 'session-1', error: failure })
    )
  })

  it('rejects a stale turn release without evicting the live turn', () => {
    const current = turn('turn-1')
    const stale = turn('turn-old')
    const state = resourceState(current)
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

  it('closes the source segment before admitting a steer continuation', () => {
    const source = turn('turn-1')
    const redirect = redirectInput('redirect-follow-up', 'follow-up')
    let state = resourceState(source)
    state = transitionAgentConnectionResource(state, {
      type: AgentConnectionResourceEventType.TurnStreamOpened,
      turn: source
    }).state
    state = queueRedirectResource(state, redirect)
    const boundary = transitionAgentConnectionResource(state, {
      type: AgentConnectionResourceEventType.SteerBoundary,
      redirectIds: [redirect.redirectId],
      sourceSegmentId,
      successorSegmentId,
      headless: false
    })

    expect(boundary.state.generation.kind).toBe(AgentConnectionResourceKind.SteerTransition)
    expect(boundary.effects).toEqual([
      {
        type: AgentConnectionResourceEventType.CloseTurnStream,
        turn: source,
        outcome: { status: AgentDriverOutcomeKind.Success }
      }
    ])
  })

  it('rolls the turn at a steer-boundary: finalises A1a, opens A2 without re-sending, replays buffered chunks', () => {
    const source = turn('turn-1')
    const continuation = turn('turn-2')
    const redirect = redirectInput('redirect-continued')
    let state = resourceState(source)
    state = transitionAgentConnectionResource(state, {
      type: AgentConnectionResourceEventType.TurnStreamOpened,
      turn: source
    }).state
    state = queueRedirectResource(state, redirect)
    state = transitionAgentConnectionResource(state, {
      type: AgentConnectionResourceEventType.SteerBoundary,
      redirectIds: [redirect.redirectId],
      sourceSegmentId,
      successorSegmentId,
      headless: false
    }).state
    state = transitionAgentConnectionResource(state, {
      type: AgentConnectionResourceEventType.RuntimeChunk,
      segmentId: successorSegmentId,
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

    expect(
      transitionAgentConnectionResource(state, { type: AgentConnectionResourceEventType.FlushTransition }).effects
    ).toEqual([expect.objectContaining({ type: AgentConnectionResourceEventType.LogInvalidTransition })])

    state = transitionAgentConnectionResource(state, {
      type: AgentConnectionResourceEventType.TurnReleased,
      turnId: source.id,
      turn: source,
      status: AgentDriverOutcomeKind.Success
    }).state
    const flushed = transitionAgentConnectionResource(state, {
      type: AgentConnectionResourceEventType.FlushTransition
    })
    expect(flushed.effects).toEqual([
      { type: AgentConnectionResourceEventType.DeliverBuffer, turn: continuation, chunks: [chunk('continued')] }
    ])
  })

  it('abandons a steer transition when its source terminal is not successful', () => {
    const source = turn('turn-1')
    const redirect = redirectInput('redirect-abandoned')
    let state = resourceState(source)
    state = transitionAgentConnectionResource(state, {
      type: AgentConnectionResourceEventType.TurnStreamOpened,
      turn: source
    }).state
    state = queueRedirectResource(state, redirect)
    state = transitionAgentConnectionResource(state, {
      type: AgentConnectionResourceEventType.SteerBoundary,
      redirectIds: [redirect.redirectId],
      sourceSegmentId,
      successorSegmentId,
      headless: false
    }).state
    state = transitionAgentConnectionResource(state, {
      type: AgentConnectionResourceEventType.TurnReleased,
      turnId: source.id,
      turn: source,
      status: AgentDriverOutcomeKind.Error
    }).state

    expect(state.generation).toEqual({ kind: AgentConnectionResourceKind.Idle, lastTurn: source })
  })

  it('clears an unused gateway continuation reservation when the turn ends before a boundary', () => {
    const current = turn('turn-1')
    let state = resourceState(current)
    state = transitionAgentConnectionResource(state, {
      type: AgentConnectionResourceEventType.ReserveSteer,
      reservation: { id: 'reservation-1' }
    }).state
    state = transitionAgentConnectionResource(state, {
      type: AgentConnectionResourceEventType.ClearSteerReservation
    }).state

    expect(state.generation).toMatchObject({ kind: AgentConnectionResourceKind.Turn, turn: current })
    expect(state.generation).not.toHaveProperty('reservation')
  })

  it('sets current turn headless from beginTurn input', () => {
    const manager = new AgentConnectionManager()
    manager.prepareTurnResources({
      conversation: { kind: ConversationKind.Agent, id: 'session-1' },
      agentId: 'agent-1',
      agentType: 'test-runtime',
      modelId: 'provider::model',
      assistantMessageId: 'assistant-1',
      userMessage: userMessage('user-1'),
      headless: true
    })
    const entry = (
      manager as unknown as {
        entries: Map<string, { resources: ReturnType<typeof createAgentConnectionResourceState> }>
      }
    ).entries.get('session-1')!

    expect(getAgentCurrentStreamResource(entry.resources)).toMatchObject({ headless: true })
  })

  describe('steer continuation identity', () => {
    const openBoundary = (
      manager: AgentConnectionManager,
      options: {
        sourceHeadless: boolean
        sourceKnowledge?: string[]
        steerHeadless: boolean
        steerKnowledge?: string[]
      }
    ) => {
      manager.prepareTurnResources({
        conversation: { kind: ConversationKind.Agent, id: 'session-1' },
        agentId: 'agent-1',
        agentType: 'test-runtime',
        modelId: 'provider::model',
        assistantMessageId: 'assistant-1',
        userMessage: userMessage('source', options.sourceKnowledge),
        headless: options.sourceHeadless
      })
      const entry = (
        manager as unknown as {
          entries: Map<string, { resources: ReturnType<typeof resourceState> }>
          handleRuntimeEvent: (
            current: { resources: ReturnType<typeof resourceState> },
            event: AgentRuntimeEvent
          ) => void
        }
      ).entries.get('session-1')!
      const source = getAgentCurrentStreamResource(entry.resources)!
      const currentSegmentId = getAgentCurrentSegmentId(entry.resources)!
      entry.resources = transitionAgentConnectionResource(entry.resources, {
        type: AgentConnectionResourceEventType.TurnStreamOpened,
        turn: source
      }).state
      const redirect: AgentRuntimeRedirectInput = {
        redirectId: toAgentRuntimeRedirectId('redirect-steer'),
        segmentId: currentSegmentId,
        message: userMessage('steer', options.steerKnowledge),
        headless: options.steerHeadless
      }
      entry.resources = transitionAgentConnectionResource(entry.resources, {
        type: AgentConnectionResourceEventType.RedirectQueued,
        redirect
      }).state
      ;(
        manager as unknown as {
          handleRuntimeEvent: (current: typeof entry, event: AgentRuntimeEvent) => void
        }
      ).handleRuntimeEvent(entry, {
        type: AgentRuntimeEventType.SteerDelivered,
        redirects: [redirect],
        sourceSegmentId: currentSegmentId,
        successorSegmentId
      })
      return manager.describeConversationContinuation('session-1')
    }

    it('keeps a roll continuation headless when the current turn and injected steer are headless', () => {
      const continuation = openBoundary(new AgentConnectionManager(), {
        sourceHeadless: true,
        steerHeadless: true
      })

      expect(continuation.headless).toBe(true)
    })

    it('opens a headless turn plus interactive steer roll continuation as interactive', () => {
      const continuation = openBoundary(new AgentConnectionManager(), {
        sourceHeadless: true,
        steerHeadless: false
      })

      expect(continuation.headless).toBe(false)
    })

    it('opens an interactive turn plus headless steer roll continuation as interactive', () => {
      const continuation = openBoundary(new AgentConnectionManager(), {
        sourceHeadless: false,
        steerHeadless: true
      })

      expect(continuation.headless).toBe(false)
    })

    it('inherits the rolled turn knowledge scope over a steer message carrying a different one', () => {
      const continuation = openBoundary(new AgentConnectionManager(), {
        sourceHeadless: false,
        sourceKnowledge: ['source-kb'],
        steerHeadless: false,
        steerKnowledge: ['steer-kb']
      })

      expect(continuation.knowledgeBaseIds).toEqual(['source-kb'])
    })

    it('inherits the rolled turn knowledge scope when the delivered redirect has no knowledge scope', () => {
      const manager = new AgentConnectionManager()
      manager.prepareTurnResources({
        conversation: { kind: ConversationKind.Agent, id: 'session-1' },
        agentId: 'agent-1',
        agentType: 'test-runtime',
        modelId: 'provider::model',
        assistantMessageId: 'assistant-1',
        userMessage: userMessage('source', ['source-kb'])
      })
      const internals = manager as unknown as {
        entries: Map<string, { resources: ReturnType<typeof resourceState> }>
      }
      const entry = internals.entries.get('session-1')!
      const source = getAgentCurrentStreamResource(entry.resources)!
      const currentSegmentId = getAgentCurrentSegmentId(entry.resources)!
      entry.resources = transitionAgentConnectionResource(entry.resources, {
        type: AgentConnectionResourceEventType.TurnStreamOpened,
        turn: source
      }).state
      const redirect: AgentRuntimeRedirectInput = {
        ...redirectInput('redirect-no-scope'),
        segmentId: currentSegmentId
      }
      entry.resources = transitionAgentConnectionResource(entry.resources, {
        type: AgentConnectionResourceEventType.RedirectQueued,
        redirect
      }).state
      entry.resources = transitionAgentConnectionResource(entry.resources, {
        type: AgentConnectionResourceEventType.SteerBoundary,
        redirectIds: [redirect.redirectId],
        sourceSegmentId: currentSegmentId,
        successorSegmentId,
        headless: false
      }).state

      expect(manager.describeConversationContinuation('session-1').knowledgeBaseIds).toEqual(['source-kb'])
    })
  })

  it('replays an autonomous terminal that arrives before the receive-only turn is created', () => {
    const autonomous = turn('autonomous-1')
    let state = resourceState()
    state = transitionAgentConnectionResource(state, {
      type: AgentConnectionResourceEventType.AutonomousTurnState,
      segmentId: autonomousSegmentId,
      state: AgentAutonomousGenerationState.Started
    }).state
    state = transitionAgentConnectionResource(state, {
      type: AgentConnectionResourceEventType.AutonomousTurnCreated,
      turn: autonomous
    }).state
    state = transitionAgentConnectionResource(state, {
      type: AgentConnectionResourceEventType.RuntimeChunk,
      segmentId: autonomousSegmentId,
      chunk: chunk('autonomous')
    }).state
    state = transitionAgentConnectionResource(state, {
      type: AgentConnectionResourceEventType.DriverTerminal,
      segmentId: autonomousSegmentId,
      outcome: { status: AgentDriverOutcomeKind.Success }
    }).state
    state = transitionAgentConnectionResource(state, {
      type: AgentConnectionResourceEventType.TurnStreamOpened,
      turn: autonomous
    }).state
    const flushed = transitionAgentConnectionResource(state, {
      type: AgentConnectionResourceEventType.FlushTransition
    })

    expect(flushed.effects).toEqual([
      { type: AgentConnectionResourceEventType.DeliverBuffer, turn: autonomous, chunks: [chunk('autonomous')] },
      {
        type: AgentConnectionResourceEventType.CloseTurnStream,
        turn: autonomous,
        outcome: { status: AgentDriverOutcomeKind.Success }
      }
    ])
  })

  it('keeps autonomous ownership active until the runtime release fact arrives', () => {
    let state = resourceState()
    state = transitionAgentConnectionResource(state, {
      type: AgentConnectionResourceEventType.AutonomousTurnState,
      segmentId: autonomousSegmentId,
      state: AgentAutonomousGenerationState.Started
    }).state
    expect(isAgentAutonomousResourceActive(state)).toBe(true)

    state = transitionAgentConnectionResource(state, {
      type: AgentConnectionResourceEventType.AutonomousTurnState,
      segmentId: autonomousSegmentId,
      state: AgentAutonomousGenerationState.Finished
    }).state
    expect(state.generation).toMatchObject({ ownership: AgentAutonomousResourceOwnership.Released })
    expect(isAgentAutonomousResourceActive(state)).toBe(false)
  })

  it('does not let a foreground turn overwrite an autonomous generation resource', () => {
    let state = resourceState()
    state = transitionAgentConnectionResource(state, {
      type: AgentConnectionResourceEventType.AutonomousTurnState,
      segmentId: autonomousSegmentId,
      state: AgentAutonomousGenerationState.Started
    }).state
    const result = transitionAgentConnectionResource(state, {
      type: AgentConnectionResourceEventType.BeginTurn,
      segmentId: sourceSegmentId,
      turn: turn('foreground')
    })

    expect(result.state).toBe(state)
    expect(result.effects).toEqual([
      expect.objectContaining({ type: AgentConnectionResourceEventType.LogInvalidTransition })
    ])
  })

  describe('autonomous signal ownership', () => {
    const install = (liveTurn: boolean) => {
      const manager = new AgentConnectionManager()
      manager.prepareTurnResources({
        conversation: { kind: ConversationKind.Agent, id: 'session-1' },
        agentId: 'agent-1',
        agentType: 'test-runtime',
        modelId: 'provider::model',
        assistantMessageId: 'assistant-1',
        userMessage: userMessage('user-1')
      })
      const connection = {
        events: neverRuntimeEvents(),
        send: vi.fn(),
        close: vi.fn(),
        reconcile: vi.fn().mockResolvedValue(AgentRuntimeReconcileResult.Current)
      } satisfies AgentRuntimeConnection
      const entry = (manager as unknown as { entries: Map<string, { resources: unknown }> }).entries.get('session-1')!
      let resources = entry.resources as ReturnType<typeof resourceState>
      const current = getAgentCurrentStreamResource(resources)!
      resources = transitionAgentConnectionResource(resources, {
        type: AgentConnectionResourceEventType.TurnStreamOpened,
        turn: current
      }).state
      resources = transitionAgentConnectionResource(resources, {
        type: AgentConnectionResourceEventType.ConnectionStarted,
        connectionAttemptId: 'connect-1'
      }).state
      resources = transitionAgentConnectionResource(resources, {
        type: AgentConnectionResourceEventType.ConnectionConnected,
        connectionAttemptId: 'connect-1',
        connection
      }).state
      if (liveTurn) {
        resources = transitionAgentConnectionResource(resources, {
          type: AgentConnectionResourceEventType.TurnSentToConnection,
          turn: current
        }).state
      } else {
        resources = {
          ...resources,
          generation: { kind: AgentConnectionResourceKind.Idle, lastTurn: current }
        }
      }
      entry.resources = resources
      const handle = (
        manager as unknown as {
          handleRuntimeEvent: (current: typeof entry, event: AgentRuntimeEvent, owner: AgentRuntimeConnection) => void
        }
      ).handleRuntimeEvent.bind(manager)
      return { manager, entry, connection, handle }
    }

    it('reports an interactive-origin receive-only wake without reading Conversation state', () => {
      const { entry, connection, handle } = install(false)

      handle(
        entry,
        {
          type: AgentRuntimeEventType.AutonomousTurnState,
          segmentId: autonomousSegmentId,
          state: AgentRuntimeAutonomousState.Started
        },
        connection
      )

      expect(services.conversation.startAgentAutonomous).toHaveBeenCalledExactlyOnceWith('session-1')
    })

    it('reports a responder-less receive-only wake without inferring policy in the resource plane', () => {
      const { entry, connection, handle } = install(false)

      handle(
        entry,
        {
          type: AgentRuntimeEventType.AutonomousTurnState,
          segmentId: autonomousSegmentId,
          state: AgentRuntimeAutonomousState.Started
        },
        connection
      )

      expect(services.conversation.startAgentAutonomous).toHaveBeenCalledExactlyOnceWith('session-1')
    })

    it('ignores a receive-only signal while an admitted turn is live', () => {
      const { entry, connection, handle } = install(true)

      handle(
        entry,
        {
          type: AgentRuntimeEventType.AutonomousTurnState,
          segmentId: autonomousSegmentId,
          state: AgentRuntimeAutonomousState.Started
        },
        connection
      )

      expect(services.conversation.startAgentAutonomous).not.toHaveBeenCalled()
    })
  })

  it('fences a connection result by its exact attempt id', () => {
    const connection = {} as AgentRuntimeConnection
    let state = resourceState()
    state = transitionAgentConnectionResource(state, {
      type: AgentConnectionResourceEventType.ConnectionStarted,
      connectionAttemptId: 'connect-1'
    }).state
    const stale = transitionAgentConnectionResource(state, {
      type: AgentConnectionResourceEventType.ConnectionConnected,
      connectionAttemptId: 'connect-old',
      connection
    })

    expect(stale.state.connection).toEqual({
      kind: AgentConnectionResourceKind.Connecting,
      connectionAttemptId: 'connect-1'
    })
    expect(stale.effects).toEqual([
      expect.objectContaining({ type: AgentConnectionResourceEventType.LogInvalidTransition })
    ])
  })

  it('scopes background and compaction occupancy to the connected resource', () => {
    const connection = {} as AgentRuntimeConnection
    let state = resourceState()
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

    expect(getAgentConnectionOccupancy(state)).toEqual({ background: true, compaction: true })
    expect(hasAgentConnectionBackgroundWork(state)).toBe(true)
    expect(hasAgentCompactionResource(state)).toBe(true)
  })

  it('closes connection-scoped occupancy together on disconnect', () => {
    const connection = {} as AgentRuntimeConnection
    let state = resourceState()
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
      type: AgentConnectionResourceEventType.ConnectionOccupancy,
      occupancy: AgentConnectionOccupancyKind.Compaction,
      active: true
    }).state
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

  it('closes the exact compaction activity when its connection is interrupted', () => {
    const manager = new AgentConnectionManager()
    const activityId = toConversationActivityId('compaction-1')
    const entry = {
      conversation: { kind: ConversationKind.Agent, id: 'session-1' } as const,
      compactionActivityId: activityId
    }
    const internals = manager as unknown as {
      executeResourceEffect: (
        current: typeof entry,
        effect: { type: AgentConnectionResourceEventType.CompactionInterrupted }
      ) => void
    }

    internals.executeResourceEffect(entry, { type: AgentConnectionResourceEventType.CompactionInterrupted })

    expect(services.conversation.closeAgentActivity).toHaveBeenCalledExactlyOnceWith('session-1', activityId)
    expect(entry.compactionActivityId).toBeUndefined()
    expect(services.cache.setShared).toHaveBeenCalledWith('agent.session.compaction.session-1', { status: 'idle' })
  })

  it('closes the exact background activity when the connection releases its waiter', () => {
    const manager = new AgentConnectionManager()
    const activityId = toConversationActivityId('background-1')
    const connection = {} as AgentRuntimeConnection
    const entry = {
      conversation: { kind: ConversationKind.Agent, id: 'session-1' } as const,
      backgroundActivityId: activityId
    }
    const releaseBackgroundWorkWaiter = vi.fn()
    const internals = manager as unknown as {
      executeResourceEffect: (
        current: typeof entry,
        effect: { type: AgentConnectionResourceEventType.ReleaseBackgroundWaiter; connection: AgentRuntimeConnection }
      ) => void
      releaseBackgroundWorkWaiter: typeof releaseBackgroundWorkWaiter
    }
    internals.releaseBackgroundWorkWaiter = releaseBackgroundWorkWaiter

    internals.executeResourceEffect(entry, {
      type: AgentConnectionResourceEventType.ReleaseBackgroundWaiter,
      connection
    })

    expect(services.conversation.closeAgentActivity).toHaveBeenCalledExactlyOnceWith('session-1', activityId)
    expect(entry.backgroundActivityId).toBeUndefined()
    expect(releaseBackgroundWorkWaiter).toHaveBeenCalledExactlyOnceWith(entry, connection)
  })

  it('does not let a stale disconnect tear down a replacement connection', () => {
    const current = {} as AgentRuntimeConnection
    const stale = {} as AgentRuntimeConnection
    let state = resourceState()
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

    expect(result.state).toBe(state)
    expect(result.effects).toEqual([
      expect.objectContaining({ type: AgentConnectionResourceEventType.LogInvalidTransition })
    ])
  })

  it('invalidates the entry before awaiting its connection close and exposes the close to drain', async () => {
    let finishClose!: () => void
    const closing = new Promise<void>((resolve) => {
      finishClose = resolve
    })
    const connection = { close: vi.fn(() => closing) } as unknown as AgentRuntimeConnection
    let resources = resourceState()
    resources = transitionAgentConnectionResource(resources, {
      type: AgentConnectionResourceEventType.ConnectionStarted,
      connectionAttemptId: 'connect-1'
    }).state
    resources = transitionAgentConnectionResource(resources, {
      type: AgentConnectionResourceEventType.ConnectionConnected,
      connectionAttemptId: 'connect-1',
      connection
    }).state
    const manager = new AgentConnectionManager()
    const entry = {
      conversation: { kind: ConversationKind.Agent, id: 'session-1' } as const,
      agentId: 'agent-1',
      agentType: 'test-runtime',
      modelId: 'provider::model',
      resources
    }
    const internals = manager as unknown as {
      entries: Map<string, typeof entry>
      sessionTeardowns: Map<string, { id: string; promise: Promise<void>; phase: 'closing' }>
    }
    internals.entries.set('session-1', entry)

    const closed = manager.closeSession('session-1')
    expect(internals.entries.has('session-1')).toBe(false)
    expect(connection.close).toHaveBeenCalledOnce()
    expect(internals.sessionTeardowns.size).toBe(1)

    const hold = manager.pause('backup')
    const draining = manager.drainInFlight({ timeoutMs: 5_000 })
    let drained = false
    void draining.then(() => {
      drained = true
    })
    await Promise.resolve()
    expect(drained).toBe(false)

    finishClose()
    await expect(closed).resolves.toBeUndefined()
    await expect(draining).resolves.toEqual({ stragglerIds: [] })
    hold.dispose()
  })

  it('waits for background work to release before rebuilding for a fresh turn', () => {
    const connection = {} as AgentRuntimeConnection
    let state = resourceState()
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
      target: { modelId: 'provider::next', reasoningEffort: 'medium', serviceTier: 'standard', knowledgeBaseIds: [] }
    }).state
    const drained = transitionAgentConnectionResource(state, {
      type: AgentConnectionResourceEventType.ConnectionOccupancy,
      occupancy: AgentConnectionOccupancyKind.Background,
      active: false
    })

    expect(drained.state.connection).toEqual({
      kind: AgentConnectionResourceKind.Connected,
      connection,
      occupancy: {}
    })
    expect(drained.effects).toEqual([{ type: AgentConnectionResourceEventType.ReleaseBackgroundWaiter, connection }])
  })

  it('derives liveness and current resource from the state machine', () => {
    const current = turn('turn-1')
    let state = resourceState(current)

    expect(getAgentCurrentStreamResource(state)).toBe(current)
    expect(getAgentLiveStreamResource(state)).toBe(current)
    expect(hasOpenAgentStreamResource(state, current)).toBe(false)

    state = transitionAgentConnectionResource(state, {
      type: AgentConnectionResourceEventType.TurnStreamOpened,
      turn: current
    }).state
    expect(hasOpenAgentStreamResource(state, current)).toBe(true)
  })

  it('keeps nested backup holds active until the last owner releases', () => {
    const manager = new AgentConnectionManager()
    const first = manager.pause('backup')
    const second = manager.pause('restore')

    expect(manager.isWriteQuiesced).toBe(true)
    first.dispose()
    expect(manager.isWriteQuiesced).toBe(true)
    second.dispose()
    expect(manager.isWriteQuiesced).toBe(false)
  })

  it('drains connection work to a fixed point instead of one snapshot', async () => {
    const manager = new AgentConnectionManager()
    let finishStart!: () => void
    let finishClose!: () => void
    const start = new Promise<boolean>((resolve) => (finishStart = () => resolve(true)))
    const close = new Promise<void>((resolve) => (finishClose = resolve))
    const internals = manager as unknown as {
      connectionStarts: Map<string, { id: string; promise: Promise<boolean> }>
      sessionTeardowns: Map<string, { id: string; promise: Promise<void>; phase: 'closing' }>
    }
    internals.connectionStarts.set('session-1', { id: 'start-1', promise: start })
    const hold = manager.pause('backup')
    const draining = manager.drainInFlight({ timeoutMs: 5_000 })

    internals.sessionTeardowns.set('session-1', { id: 'close-1', promise: close, phase: 'closing' })
    finishStart()
    await new Promise((resolve) => setTimeout(resolve, 0))
    finishClose()

    await expect(draining).resolves.toEqual({ stragglerIds: [] })
    hold.dispose()
  })

  it('reports stable operation identities when backup drain times out', async () => {
    const manager = new AgentConnectionManager()
    const never = new Promise<void>(() => {})
    const internals = manager as unknown as {
      sessionTeardowns: Map<string, { id: string; promise: Promise<void>; phase: 'closing' }>
    }
    internals.sessionTeardowns.set('session-1', { id: 'close-1', promise: never, phase: 'closing' })
    const hold = manager.pause('backup')

    await expect(manager.drainInFlight({ timeoutMs: 0 })).resolves.toEqual({
      stragglerIds: ['connection-close:session-1:close-1']
    })
    hold.dispose()
  })

  it('discards only the autonomous buffer owned by the matching preemption', () => {
    const manager = new AgentConnectionManager()
    const foreground = turn('foreground')
    const autonomous = turn('autonomous')
    let resources = createAgentConnectionResourceState<Turn, never>()
    resources = transitionAgentConnectionResource(resources, {
      type: AgentConnectionResourceEventType.BeginTurn,
      turn: foreground,
      segmentId: sourceSegmentId
    }).state
    resources = transitionAgentConnectionResource(resources, {
      type: AgentConnectionResourceEventType.AutonomousTurnState,
      segmentId: autonomousSegmentId,
      state: AgentAutonomousGenerationState.Started,
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
      entries: Map<
        string,
        {
          conversation: { kind: ConversationKind.Agent; id: string }
          resources: typeof resources
        }
      >
      suspendedConversationTurns: Map<
        typeof preemptionId,
        {
          conversation: { kind: ConversationKind.Agent; id: string }
          turnId: typeof foregroundTurnId
          executionId: typeof foregroundExecutionId
          suspendEffectId: typeof preemptionId
          runtimeTurnId: string
          turn: Turn
        }
      >
      closeTurn: (value: Turn) => void
      refreshIdleTimer: (value: unknown) => void
    }
    internals.entries.set('session-1', {
      conversation: { kind: ConversationKind.Agent, id: 'session-1' },
      resources
    })
    internals.suspendedConversationTurns.set(preemptionId, {
      conversation: { kind: ConversationKind.Agent, id: 'session-1' },
      turnId: foregroundTurnId,
      executionId: foregroundExecutionId,
      runtimeTurnId: foreground.id,
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
      preemptionId: toConversationEffectId('stale')
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
  })

  it('uses exact Conversation identities without synthetic agent-session topic strings', () => {
    const conversation = { kind: ConversationKind.Agent, id: 'session-1' } as const
    const turnId = toConversationTurnId('turn-1')
    const executionId = toConversationExecutionId('execution-1')
    const inputId = toConversationInputId('input-1')

    expect(conversation).toEqual({ kind: ConversationKind.Agent, id: 'session-1' })
    expect(Object.values({ turnId, executionId, inputId })).not.toContain('agent-session:session-1')
  })

  describe('usage capture ownership', () => {
    const snapshot = () => ({
      id: 'agent-1',
      name: 'Original Agent',
      emoji: '🧠',
      model: { id: 'claude-sonnet-4-5', name: 'Claude Sonnet', provider: 'claude-code' }
    })

    const prepareUsageTurn = (manager: AgentConnectionManager) => {
      const messageSnapshot = snapshot()
      manager.prepareTurnResources({
        conversation: { kind: ConversationKind.Agent, id: 'session-1' },
        agentId: 'agent-1',
        agentType: 'test-runtime',
        modelId: 'claude-code::claude-sonnet-4-5',
        assistantMessageId: 'assistant-1',
        userMessage: userMessage('user-1'),
        messageSnapshot: messageSnapshot as never
      })
      const entry = (
        manager as unknown as { entries: Map<string, { resources: unknown; usageCapture?: unknown }> }
      ).entries.get('session-1')!
      let resources = entry.resources as ReturnType<typeof resourceState>
      const currentTurn = getAgentCurrentStreamResource(resources)!
      resources = transitionAgentConnectionResource(resources, {
        type: AgentConnectionResourceEventType.TurnStreamOpened,
        turn: currentTurn
      }).state
      entry.resources = resources
      return { entry, messageSnapshot }
    }

    it('keeps the active usage source frozen when the agent is edited or deleted mid-turn', () => {
      const manager = new AgentConnectionManager()
      const { messageSnapshot } = prepareUsageTurn(manager)
      messageSnapshot.name = 'Renamed Agent'
      messageSnapshot.emoji = '🆕'
      vi.spyOn(agentService, 'getAgent').mockReturnValue(null)

      expect(manager.getActiveUsageContext('session-1')).toEqual({
        agentSessionId: 'session-1',
        assistantMessageId: 'assistant-1',
        source: {
          type: 'agent',
          id: 'agent-1',
          name: 'Original Agent',
          icon: '🧠'
        }
      })
    })

    it('records runtime model usage against the exact turn and frozen source', () => {
      const recordInvocation = vi.spyOn(aiUsageRecordService, 'recordInvocation').mockReturnValue(undefined)
      const manager = new AgentConnectionManager()
      const { entry } = prepareUsageTurn(manager)
      entry.usageCapture = {
        owner: AgentSessionUsageCaptureOwner.AgentSdk,
        credentialReceipt: { attribution: 'explicit', id: 'key-a', masked: 'key-***' },
        providerId: 'claude-code',
        providerName: 'Claude Code',
        source: { type: 'agent', id: 'agent-1', name: 'Connection Agent', icon: '🔒' },
        frozenModels: [
          {
            modelId: 'claude-sonnet-4-5',
            modelName: 'Claude Sonnet',
            pricingSnapshot: null,
            aliases: ['claude-sonnet-4-5']
          }
        ]
      }

      ;(
        manager as unknown as {
          handleRuntimeEvent: (current: typeof entry, event: AgentRuntimeEvent) => void
        }
      ).handleRuntimeEvent(entry, {
        type: AgentRuntimeEventType.Usage,
        invocation: {
          requestId: 'claude-agent:sdk-request-1',
          model: 'claude-sonnet-4-5',
          messageAssociation: AgentRuntimeMessageAssociation.CurrentTurn,
          usage: {
            inputTokens: 10,
            outputTokens: 5,
            totalTokens: 15,
            noCacheTokens: 10,
            cacheReadTokens: 0,
            cacheWriteTokens: 0
          },
          metrics: { timeFirstTokenMs: 120, timeCompletionMs: 480, timeThinkingMs: 75 }
        }
      })

      expect(recordInvocation).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          requestId: 'claude-agent:sdk-request-1',
          context: expect.objectContaining({
            providerId: 'claude-code',
            modelId: 'claude-sonnet-4-5',
            source: { type: 'agent', id: 'agent-1', name: 'Original Agent', icon: '🧠' },
            messageRef: { kind: 'agent-session', id: 'assistant-1' }
          }),
          modality: 'language'
        })
      )
    })

    it('ignores SDK usage when provider-call middleware owns the gateway route', () => {
      const recordInvocation = vi.spyOn(aiUsageRecordService, 'recordInvocation').mockReturnValue(undefined)
      const manager = new AgentConnectionManager()
      const { entry } = prepareUsageTurn(manager)
      entry.usageCapture = { owner: AgentSessionUsageCaptureOwner.ProviderCalls }

      ;(
        manager as unknown as {
          handleRuntimeEvent: (current: typeof entry, event: AgentRuntimeEvent) => void
        }
      ).handleRuntimeEvent(entry, {
        type: AgentRuntimeEventType.Usage,
        invocation: {
          requestId: 'gateway-duplicate',
          model: 'claude-sonnet-4-5',
          messageAssociation: AgentRuntimeMessageAssociation.CurrentTurn,
          usage: {
            inputTokens: 10,
            outputTokens: 5,
            totalTokens: 15,
            noCacheTokens: 10,
            cacheReadTokens: 0,
            cacheWriteTokens: 0
          }
        }
      })

      expect(recordInvocation).not.toHaveBeenCalled()
    })
  })

  describe('api retry ephemeral status', () => {
    const installEntry = (manager: AgentConnectionManager) => {
      const entry = {
        conversation: { kind: ConversationKind.Agent, id: 'session-1' } as const,
        resources: resourceState()
      }
      const internals = manager as unknown as {
        entries: Map<string, typeof entry>
        handleRuntimeEvent: (current: typeof entry, event: AgentRuntimeEvent) => void
      }
      internals.entries.set('session-1', entry)
      return { entry, handle: internals.handleRuntimeEvent.bind(manager) }
    }

    it('writes retrying status to shared cache on an api-retry event', () => {
      const manager = new AgentConnectionManager()
      const { entry, handle } = installEntry(manager)

      handle(entry, {
        type: AgentRuntimeEventType.ApiRetry,
        retry: {
          attempt: 2,
          maxRetries: 5,
          retryDelayMs: 1_000,
          errorStatus: 429,
          errorCategory: 'rate_limit'
        }
      })

      expect(services.sharedValues.get(AGENT_SESSION_API_RETRY_CACHE_KEY('session-1'))).toMatchObject({
        status: 'retrying',
        attempt: 2,
        maxRetries: 5,
        retryDelayMs: 1_000,
        errorStatus: 429,
        errorCategory: 'rate_limit'
      })
    })

    it('clears the status once a content chunk resumes the stream', () => {
      const manager = new AgentConnectionManager()
      const { entry, handle } = installEntry(manager)
      services.sharedValues.set(AGENT_SESSION_API_RETRY_CACHE_KEY('session-1'), { status: 'retrying' })

      handle(entry, { type: AgentRuntimeEventType.Chunk, segmentId: sourceSegmentId, chunk: chunk('resumed') })

      expect(services.sharedValues.get(AGENT_SESSION_API_RETRY_CACHE_KEY('session-1'))).toEqual({ status: 'idle' })
    })

    it('clears the status when the turn completes', () => {
      const manager = new AgentConnectionManager()
      const { entry, handle } = installEntry(manager)
      services.sharedValues.set(AGENT_SESSION_API_RETRY_CACHE_KEY('session-1'), { status: 'retrying' })

      handle(entry, { type: AgentRuntimeEventType.TurnComplete, segmentId: sourceSegmentId })

      expect(services.sharedValues.get(AGENT_SESSION_API_RETRY_CACHE_KEY('session-1'))).toEqual({ status: 'idle' })
    })

    it('does not write idle when no retry is in flight (the cache entry is the only truth)', () => {
      const manager = new AgentConnectionManager()
      const { entry, handle } = installEntry(manager)

      handle(entry, { type: AgentRuntimeEventType.Chunk, segmentId: sourceSegmentId, chunk: chunk('ordinary') })

      expect(services.cache.setShared).not.toHaveBeenCalledWith(AGENT_SESSION_API_RETRY_CACHE_KEY('session-1'), {
        status: 'idle'
      })
    })
  })

  describe('primeConnection — eager command load on session open', () => {
    const commands = [{ name: 'clear', description: 'Clear conversation', argumentHint: '' }]

    const configureSession = (connection: AgentRuntimeConnection) => {
      vi.spyOn(agentSessionService, 'getById').mockReturnValue({ id: 'session-1', agentId: 'agent-1' } as never)
      vi.spyOn(agentSessionService, 'ensureTraceId').mockReturnValue('b'.repeat(32))
      vi.spyOn(agentSessionMessageService, 'getLastRuntimeResumeToken').mockReturnValue(null)
      vi.spyOn(agentService, 'getAgent').mockReturnValue({
        id: 'agent-1',
        type: 'test-runtime',
        model: 'provider::model',
        knowledgeBaseIds: []
      } as never)
      const connect = vi.fn().mockResolvedValue(connection)
      runtimeDriverRegistry.register({
        type: 'test-runtime',
        capabilities: [AiRuntimeCapability.AgentSession],
        connect,
        validateSession: vi.fn(),
        listAvailableTools: vi.fn().mockResolvedValue([])
      })
      return connect
    }

    afterEach(() => {
      runtimeDriverRegistry.clearForTest()
      vi.restoreAllMocks()
    })

    it('opens the connection without a turn and caches the slash-command catalog', async () => {
      const connection: AgentRuntimeConnection = {
        events: neverRuntimeEvents(),
        send: vi.fn(),
        close: vi.fn(),
        reconcile: vi.fn().mockResolvedValue(AgentRuntimeReconcileResult.Current),
        getSupportedCommands: vi.fn().mockResolvedValue(commands)
      }
      const connect = configureSession(connection)
      const manager = new AgentConnectionManager()

      await manager.primeConnection('session-1')

      expect(connect).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          sessionId: 'session-1',
          trace: expect.objectContaining({ traceId: 'b'.repeat(32) })
        })
      )
      await vi.waitFor(() =>
        expect(services.sharedValues.get(AGENT_SESSION_SLASH_COMMANDS_CACHE_KEY('session-1'))).toEqual(commands)
      )
      const internals = manager as unknown as { entries: Map<string, unknown> }
      expect(internals.entries.has('session-1')).toBe(true)
    })

    it('is a no-op for a session whose agent was deleted', async () => {
      vi.spyOn(agentSessionService, 'getById').mockReturnValue({ id: 'session-1', agentId: null } as never)
      const manager = new AgentConnectionManager()

      await manager.primeConnection('session-1')

      const internals = manager as unknown as { entries: Map<string, unknown> }
      expect(internals.entries.has('session-1')).toBe(false)
    })

    it('re-priming a live session republishes the catalog without rebuilding the connection', async () => {
      const getSupportedCommands = vi.fn().mockResolvedValue(commands)
      const connection: AgentRuntimeConnection = {
        events: neverRuntimeEvents(),
        send: vi.fn(),
        close: vi.fn(),
        reconcile: vi.fn().mockResolvedValue(AgentRuntimeReconcileResult.Current),
        getSupportedCommands
      }
      const connect = configureSession(connection)
      const manager = new AgentConnectionManager()
      await manager.primeConnection('session-1')
      await vi.waitFor(() => expect(getSupportedCommands).toHaveBeenCalledTimes(1))

      await manager.primeConnection('session-1')

      await vi.waitFor(() => expect(getSupportedCommands).toHaveBeenCalledTimes(2))
      expect(connect).toHaveBeenCalledTimes(1)
    })

    it('replaces the cached catalog when the runtime pushes a commands_changed event', () => {
      const manager = new AgentConnectionManager()
      const entry = {
        conversation: { kind: ConversationKind.Agent, id: 'session-1' } as const,
        resources: resourceState()
      }
      const internals = manager as unknown as {
        entries: Map<string, typeof entry>
        handleRuntimeEvent: (current: typeof entry, event: AgentRuntimeEvent) => void
      }
      internals.entries.set('session-1', entry)
      const updated = [...commands, { name: 'deploy', description: 'Deploy project', argumentHint: '' }]

      internals.handleRuntimeEvent(entry, { type: AgentRuntimeEventType.SupportedCommands, commands: updated })

      expect(services.sharedValues.get(AGENT_SESSION_SLASH_COMMANDS_CACHE_KEY('session-1'))).toEqual(updated)
    })

    it('releaseIdleConnection closes an idle session but leaves a busy one running', () => {
      const manager = new AgentConnectionManager()
      const closeSession = vi.spyOn(manager, 'closeSession').mockResolvedValue(undefined)
      const entries = (manager as unknown as { entries: Map<string, { resources: unknown }> }).entries
      entries.set('idle', { resources: resourceState() })
      entries.set('busy', { resources: resourceState(turn('turn-1')) })

      manager.releaseIdleConnection('busy')
      manager.releaseIdleConnection('idle')

      expect(closeSession).not.toHaveBeenCalledWith('busy')
      expect(closeSession).toHaveBeenCalledExactlyOnceWith('idle')
    })
  })

  describe('connection-scoped compaction and context projections', () => {
    const installConnectedEntry = (
      manager: AgentConnectionManager,
      connectionOverrides: Partial<AgentRuntimeConnection> = {}
    ) => {
      const connection = {
        events: neverRuntimeEvents(),
        send: vi.fn(),
        close: vi.fn(),
        reconcile: vi.fn().mockResolvedValue(AgentRuntimeReconcileResult.Current),
        ...connectionOverrides
      } satisfies AgentRuntimeConnection
      let resources = resourceState()
      resources = transitionAgentConnectionResource(resources, {
        type: AgentConnectionResourceEventType.ConnectionStarted,
        connectionAttemptId: 'connect-1'
      }).state
      resources = transitionAgentConnectionResource(resources, {
        type: AgentConnectionResourceEventType.ConnectionConnected,
        connectionAttemptId: 'connect-1',
        connection
      }).state
      const entry = {
        conversation: { kind: ConversationKind.Agent, id: 'session-1' } as const,
        resources,
        compactionActivityId: undefined as ReturnType<typeof toConversationActivityId> | undefined
      }
      const internals = manager as unknown as {
        entries: Map<string, typeof entry>
        handleRuntimeEvent: (current: typeof entry, event: AgentRuntimeEvent) => void
      }
      internals.entries.set('session-1', entry)
      return { connection, entry, handle: internals.handleRuntimeEvent.bind(manager) }
    }

    it('publishes compaction state through shared cache and treats compaction as busy', () => {
      const manager = new AgentConnectionManager()
      const { entry, handle } = installConnectedEntry(manager)

      handle(entry, { type: AgentRuntimeEventType.CompactionStart })

      expect(manager.hasBusySessions()).toBe(true)
      expect(services.sharedValues.get(AGENT_SESSION_COMPACTION_CACHE_KEY('session-1'))).toMatchObject({
        status: 'compacting',
        startedAt: expect.any(String)
      })
      expect(entry.compactionActivityId).toBe('activity-1')
    })

    it('a no-anchor compaction success (no boundary) settles status to idle and is no longer busy (B2)', () => {
      const manager = new AgentConnectionManager()
      const { entry, handle } = installConnectedEntry(manager)
      handle(entry, { type: AgentRuntimeEventType.CompactionStart })

      handle(entry, { type: AgentRuntimeEventType.CompactionComplete })

      expect(manager.hasBusySessions()).toBe(false)
      expect(services.sharedValues.get(AGENT_SESSION_COMPACTION_CACHE_KEY('session-1'))).toEqual({ status: 'idle' })
      expect(services.conversation.closeAgentActivity).toHaveBeenCalledExactlyOnceWith('session-1', 'activity-1')
      expect(entry.compactionActivityId).toBeUndefined()
    })

    it('settles compaction when the runtime connection errors', () => {
      const manager = new AgentConnectionManager()
      const { entry, handle } = installConnectedEntry(manager)
      handle(entry, { type: AgentRuntimeEventType.CompactionStart })

      handle(entry, {
        type: AgentRuntimeEventType.Error,
        segmentId: sourceSegmentId,
        error: new Error('connection lost')
      })

      expect(manager.hasBusySessions()).toBe(false)
      expect(services.sharedValues.get(AGENT_SESSION_COMPACTION_CACHE_KEY('session-1'))).toEqual({ status: 'idle' })
      expect(services.conversation.closeAgentActivity).toHaveBeenCalledExactlyOnceWith('session-1', 'activity-1')
    })

    it('persists context usage events from the runtime', () => {
      const manager = new AgentConnectionManager()
      const { entry, handle } = installConnectedEntry(manager)
      const usage = {
        categories: [],
        totalTokens: 64,
        maxTokens: 100,
        percentage: 64,
        model: 'claude-sonnet-4-5'
      }

      handle(entry, { type: AgentRuntimeEventType.ContextUsage, usage })

      expect(services.sharedValues.get(AGENT_SESSION_CONTEXT_USAGE_CACHE_KEY('session-1'))).toEqual(usage)
    })

    it('publishes runtime context usage through persist cache', () => {
      const manager = new AgentConnectionManager()
      const { entry, handle } = installConnectedEntry(manager)
      const usage = {
        categories: [],
        totalTokens: 64,
        maxTokens: 100,
        percentage: 64,
        model: 'claude-sonnet-4-5'
      }

      handle(entry, { type: AgentRuntimeEventType.ContextUsage, usage })

      expect(services.sharedValues.has(AGENT_SESSION_CONTEXT_USAGE_CACHE_KEY('session-1'))).toBe(true)
      expect(services.sharedValues.get(AGENT_SESSION_CONTEXT_USAGE_CACHE_KEY('session-1'))).toEqual(usage)
    })

    it('enqueues a compaction anchor into the current turn and refreshes context usage on completion', async () => {
      const usage = {
        categories: [] as [],
        totalTokens: 24,
        maxTokens: 100,
        percentage: 24,
        model: 'claude-sonnet-4-5'
      }
      const connection = {
        events: neverRuntimeEvents(),
        send: vi.fn(),
        close: vi.fn(),
        reconcile: vi.fn().mockResolvedValue(AgentRuntimeReconcileResult.Current),
        getContextUsage: vi.fn().mockResolvedValue(usage)
      } satisfies AgentRuntimeConnection
      const manager = new AgentConnectionManager()
      manager.prepareTurnResources({
        conversation: { kind: ConversationKind.Agent, id: 'session-1' },
        agentId: 'agent-1',
        agentType: 'test-runtime',
        modelId: 'provider::model',
        assistantMessageId: 'assistant-1',
        userMessage: input('user-1').message
      })
      type StreamTurn = Turn & { controller?: { enqueue: ReturnType<typeof vi.fn> } }
      const entry = (
        manager as unknown as {
          entries: Map<
            string,
            { resources: ReturnType<typeof createAgentConnectionResourceState<StreamTurn, Reservation>> }
          >
          handleRuntimeEvent: (
            current: { resources: ReturnType<typeof createAgentConnectionResourceState<StreamTurn, Reservation>> },
            event: AgentRuntimeEvent
          ) => void
        }
      ).entries.get('session-1')!
      let resources = entry.resources
      const currentTurn = getAgentCurrentStreamResource(resources)!
      const enqueue = vi.fn()
      currentTurn.controller = { enqueue }
      resources = transitionAgentConnectionResource(resources, {
        type: AgentConnectionResourceEventType.TurnStreamOpened,
        turn: currentTurn
      }).state
      resources = transitionAgentConnectionResource(resources, {
        type: AgentConnectionResourceEventType.ConnectionStarted,
        connectionAttemptId: 'connect-1'
      }).state
      resources = transitionAgentConnectionResource(resources, {
        type: AgentConnectionResourceEventType.ConnectionConnected,
        connectionAttemptId: 'connect-1',
        connection
      }).state
      entry.resources = resources
      const anchor = {
        status: 'done' as const,
        phase: 'agent-session' as const,
        trigger: 'auto' as const,
        completedAt: '2026-06-09T12:00:00.000Z',
        preTokens: 52_000,
        postTokens: 14_000,
        durationMs: 1234
      }

      ;(
        manager as unknown as {
          handleRuntimeEvent: (current: typeof entry, event: AgentRuntimeEvent) => void
        }
      ).handleRuntimeEvent(entry, { type: AgentRuntimeEventType.CompactionComplete, anchor })

      expect(enqueue).toHaveBeenCalledWith({
        type: 'data-compaction-anchor',
        id: expect.any(String),
        data: anchor
      })
      expect(services.sharedValues.get(AGENT_SESSION_COMPACTION_CACHE_KEY('session-1'))).toEqual({ status: 'idle' })
      await vi.waitFor(() =>
        expect(services.sharedValues.get(AGENT_SESSION_CONTEXT_USAGE_CACHE_KEY('session-1'))).toEqual(usage)
      )
    })

    it('clears session-scoped shared cache entries when closing a session', async () => {
      const manager = new AgentConnectionManager()
      const { entry, handle } = installConnectedEntry(manager)
      handle(entry, { type: AgentRuntimeEventType.CompactionStart })
      services.sharedValues.set(AGENT_SESSION_CONTEXT_USAGE_CACHE_KEY('session-1'), {
        categories: [],
        totalTokens: 1,
        maxTokens: 100,
        percentage: 1,
        model: 'claude-sonnet-4-5'
      })
      services.sharedValues.set(AGENT_SESSION_SLASH_COMMANDS_CACHE_KEY('session-1'), [])

      await manager.closeSession('session-1')

      expect(services.sharedValues.get(AGENT_SESSION_CONTEXT_USAGE_CACHE_KEY('session-1'))).toBeDefined()
      expect(services.sharedValues.get(AGENT_SESSION_COMPACTION_CACHE_KEY('session-1'))).toEqual({ status: 'idle' })
      expect(services.sharedValues.has(AGENT_SESSION_SLASH_COMMANDS_CACHE_KEY('session-1'))).toBe(false)
    })

    it('throttles on-demand refreshes and no-ops without a live connection', async () => {
      const manager = new AgentConnectionManager()
      const getContextUsage = vi.fn().mockResolvedValue({
        categories: [],
        totalTokens: 24,
        maxTokens: 100,
        percentage: 24,
        model: 'claude-sonnet-4-5'
      })
      installConnectedEntry(manager, { getContextUsage })

      manager.refreshContextUsageOnDemand('missing')
      manager.refreshContextUsageOnDemand('session-1')
      manager.refreshContextUsageOnDemand('session-1')

      await vi.waitFor(() => expect(getContextUsage).toHaveBeenCalledTimes(1))
    })

    it('coalesces concurrent refreshes and runs one trailing semantic invalidation', async () => {
      let resolveFirst!: (usage: {
        categories: []
        totalTokens: number
        maxTokens: number
        percentage: number
        model: string
      }) => void
      const first = new Promise<{
        categories: []
        totalTokens: number
        maxTokens: number
        percentage: number
        model: string
      }>((resolve) => {
        resolveFirst = resolve
      })
      const trailing = {
        categories: [] as [],
        totalTokens: 30,
        maxTokens: 100,
        percentage: 30,
        model: 'claude-sonnet-4-5'
      }
      const getContextUsage = vi.fn().mockReturnValueOnce(first).mockResolvedValueOnce(trailing)
      const manager = new AgentConnectionManager()
      const { entry } = installConnectedEntry(manager, { getContextUsage })
      const refresh = (
        manager as unknown as { refreshContextUsage: (current: typeof entry) => void }
      ).refreshContextUsage.bind(manager)

      refresh(entry)
      refresh(entry)
      refresh(entry)
      expect(getContextUsage).toHaveBeenCalledTimes(1)

      resolveFirst({ ...trailing, totalTokens: 20, percentage: 20 })
      await vi.waitFor(() => expect(getContextUsage).toHaveBeenCalledTimes(2))
      expect(getContextUsage).toHaveBeenCalledTimes(2)
      await vi.waitFor(() =>
        expect(services.sharedValues.get(AGENT_SESSION_CONTEXT_USAGE_CACHE_KEY('session-1'))).toEqual(trailing)
      )
    })

    it('swallows a getContextUsage rejection during refresh and logs a warning (S5)', async () => {
      const usage = {
        categories: [] as [],
        totalTokens: 40,
        maxTokens: 100,
        percentage: 40,
        model: 'claude-sonnet-4-5'
      }
      const getContextUsage = vi.fn().mockRejectedValueOnce(new Error('probe failed')).mockResolvedValueOnce(usage)
      const manager = new AgentConnectionManager()
      const { entry } = installConnectedEntry(manager, { getContextUsage })
      const refresh = (
        manager as unknown as { refreshContextUsage: (current: typeof entry) => void }
      ).refreshContextUsage.bind(manager)

      refresh(entry)
      await vi.waitFor(() => {
        const state = entry as typeof entry & { contextUsageRefresh?: unknown }
        expect(state.contextUsageRefresh).toBeUndefined()
      })
      refresh(entry)

      await vi.waitFor(() =>
        expect(services.sharedValues.get(AGENT_SESSION_CONTEXT_USAGE_CACHE_KEY('session-1'))).toEqual(usage)
      )
      expect(getContextUsage).toHaveBeenCalledTimes(2)
    })
  })

  describe('connection shutdown ownership', () => {
    it('freezes a resume checkpoint only for the exact runtime turn before teardown', async () => {
      const manager = new AgentConnectionManager()
      const handle = manager.prepareTurnResources({
        conversation: { kind: ConversationKind.Agent, id: 'session-1' },
        agentId: 'agent-1',
        agentType: 'test-runtime',
        modelId: 'provider::model',
        assistantMessageId: 'assistant-checkpoint',
        userMessage: userMessage('user-checkpoint')
      })
      const entry = (manager as unknown as { entries: Map<string, { lastResumeToken?: string }> }).entries.get(
        'session-1'
      )
      if (!entry) throw new Error('turn did not create an Agent resource entry')
      entry.lastResumeToken = 'resume-exact'

      expect(manager.executionCheckpoint('session-1', 'another-turn')).toBeUndefined()
      const checkpoint = manager.executionCheckpoint('session-1', handle.turnId)
      const closing = manager.closeSession('session-1')

      expect(checkpoint).toEqual({ runtimeResumeToken: 'resume-exact' })
      expect(manager.executionCheckpoint('session-1', handle.turnId)).toEqual({
        runtimeResumeToken: 'resume-exact'
      })
      expect(manager.executionCheckpoint('session-1', 'another-turn')).toBeUndefined()
      await closing
      expect(manager.executionCheckpoint('session-1', handle.turnId)).toBeUndefined()
    })

    const installConnection = (
      manager: AgentConnectionManager,
      sessionId: string,
      connection: AgentRuntimeConnection
    ) => {
      let resources = resourceState()
      resources = transitionAgentConnectionResource(resources, {
        type: AgentConnectionResourceEventType.ConnectionStarted,
        connectionAttemptId: `connect-${sessionId}`
      }).state
      resources = transitionAgentConnectionResource(resources, {
        type: AgentConnectionResourceEventType.ConnectionConnected,
        connectionAttemptId: `connect-${sessionId}`,
        connection
      }).state
      const entry = {
        conversation: { kind: ConversationKind.Agent, id: sessionId } as const,
        agentId: 'agent-1',
        agentType: 'test-runtime',
        modelId: 'provider::model',
        resources
      }
      ;(manager as unknown as { entries: Map<string, typeof entry> }).entries.set(sessionId, entry)
      return entry
    }

    it('clears the runtime and closes the connection on closeSession', async () => {
      const manager = new AgentConnectionManager()
      const connection = {
        events: neverRuntimeEvents(),
        send: vi.fn(),
        close: vi.fn(),
        reconcile: vi.fn().mockResolvedValue(AgentRuntimeReconcileResult.Current)
      } satisfies AgentRuntimeConnection
      installConnection(manager, 'session-1', connection)

      await manager.closeSession('session-1')

      expect(connection.close).toHaveBeenCalledOnce()
      expect((manager as unknown as { entries: Map<string, unknown> }).entries.has('session-1')).toBe(false)
    })

    it('does not prepare a successor turn until the prior session teardown completes', async () => {
      let finishClose!: () => void
      const closeGate = new Promise<void>((resolve) => {
        finishClose = resolve
      })
      const manager = new AgentConnectionManager()
      const connection = {
        events: neverRuntimeEvents(),
        send: vi.fn(),
        close: vi.fn(() => closeGate),
        reconcile: vi.fn().mockResolvedValue(AgentRuntimeReconcileResult.Current)
      } satisfies AgentRuntimeConnection
      installConnection(manager, 'session-1', connection)

      const closing = manager.closeSession('session-1')
      const preparing = manager.prepareExecutionTurnResources(
        {
          conversation: { kind: ConversationKind.Agent, id: 'session-1' },
          agentId: 'agent-1',
          agentType: 'test-runtime',
          modelId: 'provider::model',
          assistantMessageId: 'assistant-successor',
          userMessage: userMessage('user-successor')
        },
        new AbortController().signal
      )
      await Promise.resolve()

      expect((manager as unknown as { entries: Map<string, unknown> }).entries.has('session-1')).toBe(false)
      finishClose()
      await closing
      await expect(preparing).resolves.toEqual({ turnId: expect.any(String) })
      expect((manager as unknown as { entries: Map<string, unknown> }).entries.has('session-1')).toBe(true)
    })

    it('declares ClaudeCodeProcessManager so the CLI owner stops last', () => {
      expect(getDependencies(AgentConnectionManager)).toContain('ClaudeCodeProcessManager')
    })

    it('waits for every graceful connection close before service stop resolves', async () => {
      let resolveFirst!: () => void
      let resolveSecond!: () => void
      const firstClose = new Promise<void>((resolve) => {
        resolveFirst = resolve
      })
      const secondClose = new Promise<void>((resolve) => {
        resolveSecond = resolve
      })
      const firstConnection = {
        events: neverRuntimeEvents(),
        send: vi.fn(),
        close: vi.fn(() => firstClose),
        reconcile: vi.fn().mockResolvedValue(AgentRuntimeReconcileResult.Current)
      } satisfies AgentRuntimeConnection
      const secondConnection = {
        events: neverRuntimeEvents(),
        send: vi.fn(),
        close: vi.fn(() => secondClose),
        reconcile: vi.fn().mockResolvedValue(AgentRuntimeReconcileResult.Current)
      } satisfies AgentRuntimeConnection
      const manager = new AgentConnectionManager()
      installConnection(manager, 'session-1', firstConnection)
      installConnection(manager, 'session-2', secondConnection)

      const stopping = manager._doStop()
      let settled = false
      void stopping.then(() => {
        settled = true
      })
      await Promise.resolve()

      expect(firstConnection.close).toHaveBeenCalledOnce()
      expect(secondConnection.close).toHaveBeenCalledOnce()
      expect(settled).toBe(false)

      resolveFirst()
      await Promise.resolve()
      expect(settled).toBe(false)

      resolveSecond()
      await expect(stopping).resolves.toBeUndefined()
    })

    it('keeps a failed teardown fence when the runtime close rejects', async () => {
      const manager = new AgentConnectionManager()
      const connection = {
        events: neverRuntimeEvents(),
        send: vi.fn(),
        close: vi.fn().mockRejectedValue(new Error('close failed')),
        reconcile: vi.fn().mockResolvedValue(AgentRuntimeReconcileResult.Current)
      } satisfies AgentRuntimeConnection
      installConnection(manager, 'session-1', connection)

      const closing = manager.closeSession('session-1')
      await expect(closing).rejects.toThrow('Agent session teardown failed')
      await expect(manager.closeSession('session-1')).rejects.toBeInstanceOf(AggregateError)
      await expect(
        manager.prepareExecutionTurnResources(
          {
            conversation: { kind: ConversationKind.Agent, id: 'session-1' },
            agentId: 'agent-1',
            agentType: 'test-runtime',
            modelId: 'provider::model',
            assistantMessageId: 'assistant-retry',
            userMessage: userMessage('user-retry')
          },
          new AbortController().signal
        )
      ).rejects.toBeInstanceOf(AggregateError)

      expect(connection.close).toHaveBeenCalledOnce()
      expect((manager as unknown as { entries: Map<string, unknown> }).entries.has('session-1')).toBe(false)
      expect(manager.hasBusySessions()).toBe(true)
      const teardown = (manager as unknown as { sessionTeardowns: Map<string, { id: string }> }).sessionTeardowns.get(
        'session-1'
      )
      const hold = manager.pause('backup')
      await expect(manager.drainInFlight({ timeoutMs: 0 })).resolves.toEqual({
        stragglerIds: [`connection-close:session-1:${teardown?.id}`]
      })
      hold.dispose()
    })

    it('aborts live streams before shutdown clears their pending approvals', async () => {
      const manager = new AgentConnectionManager()
      const connection = {
        events: neverRuntimeEvents(),
        send: vi.fn(),
        close: vi.fn(),
        reconcile: vi.fn().mockResolvedValue(AgentRuntimeReconcileResult.Current)
      } satisfies AgentRuntimeConnection
      installConnection(manager, 'session-1', connection)
      const resolve = vi.fn()
      toolApprovalRegistry.register({
        approvalId: 'approval-1',
        sessionId: 'session-1',
        toolCallId: 'tool-call-1',
        toolName: 'Bash',
        originalInput: {},
        resolve
      })

      await manager._doStop()

      expect(services.conversation.abort).toHaveBeenCalledExactlyOnceWith(
        { kind: ConversationKind.Agent, id: 'session-1' },
        'agent-session-runtime-stop'
      )
      expect(resolve).toHaveBeenCalledExactlyOnceWith({ approved: false, reason: 'agent-session-runtime-stop' })
      expect(services.conversation.abort.mock.invocationCallOrder[0]).toBeLessThan(resolve.mock.invocationCallOrder[0])
    })
  })

  describe('idle connection reuse and expiry', () => {
    const installTurn = (
      manager: AgentConnectionManager,
      options: { headless?: boolean; resumeToken?: string } = {}
    ) => {
      const handle = manager.prepareTurnResources({
        conversation: { kind: ConversationKind.Agent, id: 'session-1' },
        agentId: 'agent-1',
        agentType: 'test-runtime',
        modelId: 'provider::model',
        assistantMessageId: 'assistant-1',
        userMessage: userMessage('user-1'),
        headless: options.headless
      })
      const connection = {
        events: neverRuntimeEvents(),
        send: vi.fn(),
        close: vi.fn(),
        reconcile: vi.fn().mockResolvedValue(AgentRuntimeReconcileResult.Current)
      } satisfies AgentRuntimeConnection
      const entry = (
        manager as unknown as {
          entries: Map<string, { resources: unknown; lastResumeToken?: string }>
        }
      ).entries.get('session-1')!
      entry.lastResumeToken = options.resumeToken
      let resources = entry.resources as ReturnType<typeof resourceState>
      const currentTurn = getAgentCurrentStreamResource(resources)!
      resources = transitionAgentConnectionResource(resources, {
        type: AgentConnectionResourceEventType.TurnStreamOpened,
        turn: currentTurn
      }).state
      resources = transitionAgentConnectionResource(resources, {
        type: AgentConnectionResourceEventType.ConnectionStarted,
        connectionAttemptId: 'connect-1'
      }).state
      resources = transitionAgentConnectionResource(resources, {
        type: AgentConnectionResourceEventType.ConnectionConnected,
        connectionAttemptId: 'connect-1',
        connection
      }).state
      resources = transitionAgentConnectionResource(resources, {
        type: AgentConnectionResourceEventType.TurnSentToConnection,
        turn: currentTurn
      }).state
      entry.resources = resources
      ;(
        manager as unknown as {
          handleRuntimeEvent: (current: typeof entry, event: AgentRuntimeEvent) => void
        }
      ).handleRuntimeEvent(entry, { type: AgentRuntimeEventType.TurnComplete, segmentId: sourceSegmentId })
      manager.releaseTurnResource('session-1', AgentDriverOutcomeKind.Success, handle.turnId)
      return { connection, entry, handle }
    }

    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      runtimeDriverRegistry.clearForTest()
      vi.useRealTimers()
    })

    it('hands an idle session with a resume token to the driver onSessionIdle hook', () => {
      const onSessionIdle = vi.fn()
      runtimeDriverRegistry.register({
        type: 'test-runtime',
        capabilities: [AiRuntimeCapability.AgentSession],
        connect: vi.fn(),
        validateSession: vi.fn(),
        listAvailableTools: vi.fn().mockResolvedValue([]),
        onSessionIdle
      })
      const manager = new AgentConnectionManager()
      const { connection } = installTurn(manager, { resumeToken: 'resume-1' })

      vi.runAllTimers()

      expect(connection.close).toHaveBeenCalledOnce()
      expect(onSessionIdle).toHaveBeenCalledExactlyOnceWith('session-1')
    })

    it('does not call onSessionIdle for an idle session without a resume token', () => {
      const onSessionIdle = vi.fn()
      runtimeDriverRegistry.register({
        type: 'test-runtime',
        capabilities: [AiRuntimeCapability.AgentSession],
        connect: vi.fn(),
        validateSession: vi.fn(),
        listAvailableTools: vi.fn().mockResolvedValue([]),
        onSessionIdle
      })
      const manager = new AgentConnectionManager()
      installTurn(manager)

      vi.runAllTimers()

      expect(onSessionIdle).not.toHaveBeenCalled()
    })

    it('reuses an idle runtime for the next fresh turn', () => {
      const manager = new AgentConnectionManager()
      const { connection } = installTurn(manager)

      const next = manager.prepareTurnResources({
        conversation: { kind: ConversationKind.Agent, id: 'session-1' },
        agentId: 'agent-1',
        agentType: 'test-runtime',
        modelId: 'provider::model',
        assistantMessageId: 'assistant-2',
        userMessage: userMessage('user-2')
      })

      const resources = (
        manager as unknown as {
          entries: Map<
            string,
            { resources: ReturnType<typeof createAgentConnectionResourceState<{ turnId: string }, Reservation>> }
          >
        }
      ).entries.get('session-1')!.resources
      expect(getAgentCurrentStreamResource(resources)?.turnId).toBe(next.turnId)
      expect(connection.close).not.toHaveBeenCalled()
    })

    it('passes trace context to the runtime driver and keeps the connection warm across turns', async () => {
      const manager = new AgentConnectionManager()
      const first = manager.prepareTurnResources({
        conversation: { kind: ConversationKind.Agent, id: 'session-1' },
        agentId: 'agent-1',
        agentType: 'test-runtime',
        modelId: 'provider::model',
        assistantMessageId: 'assistant-1',
        userMessage: userMessage('user-1'),
        traceId: 'a'.repeat(32)
      })
      const connection = {
        events: neverRuntimeEvents(),
        send: vi.fn(),
        close: vi.fn(),
        refreshTraceContext: vi.fn(),
        reconcile: vi.fn().mockResolvedValue(AgentRuntimeReconcileResult.Current)
      } satisfies AgentRuntimeConnection
      const entry = (manager as unknown as { entries: Map<string, { resources: unknown }> }).entries.get('session-1')!
      let resources = entry.resources as ReturnType<typeof resourceState>
      const firstTurn = getAgentCurrentStreamResource(resources)!
      resources = transitionAgentConnectionResource(resources, {
        type: AgentConnectionResourceEventType.TurnStreamOpened,
        turn: firstTurn
      }).state
      resources = transitionAgentConnectionResource(resources, {
        type: AgentConnectionResourceEventType.ConnectionStarted,
        connectionAttemptId: 'connect-1'
      }).state
      resources = transitionAgentConnectionResource(resources, {
        type: AgentConnectionResourceEventType.ConnectionConnected,
        connectionAttemptId: 'connect-1',
        connection
      }).state
      resources = transitionAgentConnectionResource(resources, {
        type: AgentConnectionResourceEventType.TurnSentToConnection,
        turn: firstTurn
      }).state
      resources = transitionAgentConnectionResource(resources, {
        type: AgentConnectionResourceEventType.DriverTerminal,
        segmentId: sourceSegmentId,
        outcome: { status: AgentDriverOutcomeKind.Success }
      }).state
      entry.resources = resources
      manager.releaseTurnResource('session-1', AgentDriverOutcomeKind.Success, first.turnId)

      const second = manager.prepareTurnResources({
        conversation: { kind: ConversationKind.Agent, id: 'session-1' },
        agentId: 'agent-1',
        agentType: 'test-runtime',
        modelId: 'provider::model',
        assistantMessageId: 'assistant-2',
        userMessage: userMessage('user-2'),
        traceId: 'a'.repeat(32)
      })
      const reader = manager
        .openExecutionStream({
          conversation: { kind: ConversationKind.Agent, id: 'session-1' },
          turnId: second.turnId,
          signal: new AbortController().signal
        })
        .getReader()

      await expect(reader.read()).resolves.toMatchObject({ done: false, value: { type: 'start' } })
      await vi.waitFor(() => expect(connection.send).toHaveBeenCalledOnce())
      expect(connection.refreshTraceContext).toHaveBeenCalledWith(
        expect.objectContaining({
          traceId: 'a'.repeat(32),
          sessionId: 'session-1',
          turnId: second.turnId
        })
      )
      expect(connection.close).not.toHaveBeenCalled()

      await manager.closeSession('session-1')
      await reader.cancel().catch(() => undefined)
    })

    it('reuses an idle connection for a headless run regardless of the mode it was built in', () => {
      const manager = new AgentConnectionManager()
      const { connection } = installTurn(manager, { headless: true })

      manager.prepareTurnResources({
        conversation: { kind: ConversationKind.Agent, id: 'session-1' },
        agentId: 'agent-1',
        agentType: 'test-runtime',
        modelId: 'provider::model',
        assistantMessageId: 'assistant-2',
        userMessage: userMessage('user-2'),
        headless: false
      })

      expect(connection.close).not.toHaveBeenCalled()
    })
  })

  describe('turn abort resource fencing', () => {
    const prepare = (manager: AgentConnectionManager, suffix: string) => {
      const controller = new AbortController()
      const handle = manager.prepareTurnResources({
        conversation: { kind: ConversationKind.Agent, id: 'session-1' },
        agentId: 'agent-1',
        agentType: 'test-runtime',
        modelId: 'provider::model',
        assistantMessageId: `assistant-${suffix}`,
        userMessage: input(`user-${suffix}`).message
      })
      return { ...handle, controller }
    }

    it('closes a pre-aborted execution stream without inferring session teardown', async () => {
      const manager = new AgentConnectionManager()
      const handle = prepare(manager, 'one')
      handle.controller.abort('user-stop')

      const reader = manager
        .openExecutionStream({
          conversation: { kind: ConversationKind.Agent, id: 'session-1' },
          turnId: handle.turnId,
          signal: handle.controller.signal
        })
        .getReader()

      await expect(reader.read()).resolves.toEqual({ done: true, value: undefined })
      expect((manager as unknown as { entries: Map<string, unknown> }).entries.has('session-1')).toBe(true)
      await manager.closeSession('session-1')
    })

    it('admits a later turn only after the prior session teardown completes', async () => {
      const manager = new AgentConnectionManager()
      const first = prepare(manager, 'one')
      await manager.closeSession('session-1')

      const second = prepare(manager, 'two')

      expect(second.controller).not.toBe(first.controller)
      expect(second.controller.signal.aborted).toBe(false)
    })

    it('closes the runtime session when the active turn is aborted by the user', async () => {
      vi.spyOn(agentService, 'getAgent').mockReturnValue({ knowledgeBaseIds: [] } as never)
      const manager = new AgentConnectionManager()
      const handle = prepare(manager, 'one')
      const connection = {
        events: neverRuntimeEvents(),
        send: vi.fn(),
        close: vi.fn(),
        reconcile: vi.fn().mockResolvedValue(AgentRuntimeReconcileResult.Current)
      } satisfies AgentRuntimeConnection
      const entry = (manager as unknown as { entries: Map<string, { resources: unknown }> }).entries.get('session-1')!
      let resources = entry.resources as ReturnType<typeof resourceState>
      resources = transitionAgentConnectionResource(resources, {
        type: AgentConnectionResourceEventType.ConnectionStarted,
        connectionAttemptId: 'connect-1'
      }).state
      resources = transitionAgentConnectionResource(resources, {
        type: AgentConnectionResourceEventType.ConnectionConnected,
        connectionAttemptId: 'connect-1',
        connection
      }).state
      entry.resources = resources
      const reader = manager
        .openExecutionStream({
          conversation: { kind: ConversationKind.Agent, id: 'session-1' },
          turnId: handle.turnId,
          signal: handle.controller.signal
        })
        .getReader()
      await expect(reader.read()).resolves.toMatchObject({ done: false, value: { type: 'start' } })

      await manager.closeSession('session-1')

      expect(connection.close).toHaveBeenCalledOnce()
      expect((manager as unknown as { entries: Map<string, unknown> }).entries.has('session-1')).toBe(false)
    })

    it('joins repeated teardown requests without closing the runtime twice', async () => {
      vi.spyOn(agentService, 'getAgent').mockReturnValue({ knowledgeBaseIds: [] } as never)
      const manager = new AgentConnectionManager()
      const handle = prepare(manager, 'one')
      const connection = {
        events: neverRuntimeEvents(),
        send: vi.fn(),
        close: vi.fn(),
        reconcile: vi.fn().mockResolvedValue(AgentRuntimeReconcileResult.Current)
      } satisfies AgentRuntimeConnection
      const entry = (manager as unknown as { entries: Map<string, { resources: unknown }> }).entries.get('session-1')!
      let resources = entry.resources as ReturnType<typeof resourceState>
      resources = transitionAgentConnectionResource(resources, {
        type: AgentConnectionResourceEventType.ConnectionStarted,
        connectionAttemptId: 'connect-1'
      }).state
      resources = transitionAgentConnectionResource(resources, {
        type: AgentConnectionResourceEventType.ConnectionConnected,
        connectionAttemptId: 'connect-1',
        connection
      }).state
      entry.resources = resources
      const reader = manager
        .openExecutionStream({
          conversation: { kind: ConversationKind.Agent, id: 'session-1' },
          turnId: handle.turnId,
          signal: handle.controller.signal
        })
        .getReader()
      await expect(reader.read()).resolves.toMatchObject({ done: false, value: { type: 'start' } })

      const firstClose = manager.closeSession('session-1')
      const repeatedClose = manager.closeSession('session-1')
      expect(repeatedClose).toBe(firstClose)
      await repeatedClose

      expect(connection.close).toHaveBeenCalledOnce()
      expect((manager as unknown as { entries: Map<string, unknown> }).entries.has('session-1')).toBe(false)
    })

    it('closes a late runtime connection when the user aborts before connect resolves', async () => {
      let resolveConnect!: (connection: AgentRuntimeConnection) => void
      const connecting = new Promise<AgentRuntimeConnection>((resolve) => {
        resolveConnect = resolve
      })
      const connection = {
        events: neverRuntimeEvents(),
        send: vi.fn(),
        close: vi.fn(),
        reconcile: vi.fn().mockResolvedValue(AgentRuntimeReconcileResult.Current)
      } satisfies AgentRuntimeConnection
      const connect = vi.fn(() => connecting)
      runtimeDriverRegistry.register({
        type: 'test-runtime',
        capabilities: [AiRuntimeCapability.AgentSession],
        connect,
        validateSession: vi.fn(),
        listAvailableTools: vi.fn().mockResolvedValue([])
      })
      vi.spyOn(agentService, 'getAgent').mockReturnValue({ knowledgeBaseIds: [] } as never)
      vi.spyOn(agentSessionMessageService, 'getLastRuntimeResumeToken').mockReturnValue(null)
      const manager = new AgentConnectionManager()
      const handle = prepare(manager, 'one')
      manager.openExecutionStream({
        conversation: { kind: ConversationKind.Agent, id: 'session-1' },
        turnId: handle.turnId,
        signal: handle.controller.signal
      })
      await vi.waitFor(() => expect(connect).toHaveBeenCalledOnce())

      const closing = manager.closeSession('session-1')
      resolveConnect(connection)

      await closing
      expect(connection.close).toHaveBeenCalledOnce()
      expect((manager as unknown as { entries: Map<string, unknown> }).entries.has('session-1')).toBe(false)
      runtimeDriverRegistry.clearForTest()
    })

    it('refreshes the trace context before starting a steer continuation stream', async () => {
      let finishRefresh!: () => void
      const refreshPending = new Promise<void>((resolve) => {
        finishRefresh = resolve
      })
      const connection = {
        events: neverRuntimeEvents(),
        send: vi.fn(),
        close: vi.fn(),
        refreshTraceContext: vi.fn(() => refreshPending),
        reconcile: vi.fn().mockResolvedValue(AgentRuntimeReconcileResult.Current)
      } satisfies AgentRuntimeConnection
      const manager = new AgentConnectionManager()
      manager.prepareTurnResources({
        conversation: { kind: ConversationKind.Agent, id: 'session-1' },
        agentId: 'agent-1',
        agentType: 'test-runtime',
        modelId: 'provider::model',
        assistantMessageId: 'assistant-1',
        userMessage: userMessage('user-1'),
        traceId: 'a'.repeat(32)
      })
      const entry = (manager as unknown as { entries: Map<string, { resources: unknown }> }).entries.get('session-1')!
      let resources = entry.resources as ReturnType<typeof resourceState>
      const sourceTurn = getAgentCurrentStreamResource(resources)!
      const currentSegmentId = getAgentCurrentSegmentId(resources)!
      const redirect: AgentRuntimeRedirectInput = {
        redirectId: toAgentRuntimeRedirectId('redirect-trace-refresh'),
        segmentId: currentSegmentId,
        message: userMessage('user-2'),
        systemReminder: true
      }
      resources = transitionAgentConnectionResource(resources, {
        type: AgentConnectionResourceEventType.TurnStreamOpened,
        turn: sourceTurn
      }).state
      resources = transitionAgentConnectionResource(resources, {
        type: AgentConnectionResourceEventType.ConnectionStarted,
        connectionAttemptId: 'connect-1'
      }).state
      resources = transitionAgentConnectionResource(resources, {
        type: AgentConnectionResourceEventType.ConnectionConnected,
        connectionAttemptId: 'connect-1',
        connection
      }).state
      resources = transitionAgentConnectionResource(resources, {
        type: AgentConnectionResourceEventType.TurnSentToConnection,
        turn: sourceTurn
      }).state
      resources = transitionAgentConnectionResource(resources, {
        type: AgentConnectionResourceEventType.RedirectQueued,
        redirect
      }).state
      resources = transitionAgentConnectionResource(resources, {
        type: AgentConnectionResourceEventType.SteerBoundary,
        redirectIds: [redirect.redirectId],
        sourceSegmentId: currentSegmentId,
        successorSegmentId,
        headless: false
      }).state
      entry.resources = resources
      const intent = manager.describeConversationContinuation('session-1')
      const activating = manager.activateConversationRuntimeTurn(intent, new AbortController().signal)
      let activated = false
      void activating.then(() => {
        activated = true
      })

      await vi.waitFor(() => expect(connection.refreshTraceContext).toHaveBeenCalledOnce())
      expect(activated).toBe(false)
      expect(connection.refreshTraceContext).toHaveBeenCalledWith(
        expect.objectContaining({ sessionId: 'session-1', turnId: intent.runtimeTurnId })
      )

      finishRefresh()
      await expect(activating).resolves.toBeUndefined()
      expect(activated).toBe(true)

      await manager.closeSession('session-1')
    })

    it('does not start a receive-only stream after the session closes during trace refresh', async () => {
      let finishRefresh!: () => void
      const refreshPending = new Promise<void>((resolve) => {
        finishRefresh = resolve
      })
      const connection = {
        events: neverRuntimeEvents(),
        send: vi.fn(),
        close: vi.fn(),
        refreshTraceContext: vi.fn(() => refreshPending),
        reconcile: vi.fn().mockResolvedValue(AgentRuntimeReconcileResult.Current)
      } satisfies AgentRuntimeConnection
      const manager = new AgentConnectionManager()
      const first = manager.prepareTurnResources({
        conversation: { kind: ConversationKind.Agent, id: 'session-1' },
        agentId: 'agent-1',
        agentType: 'test-runtime',
        modelId: 'provider::model',
        assistantMessageId: 'assistant-1',
        userMessage: userMessage('user-1'),
        traceId: 'a'.repeat(32)
      })
      const entry = (manager as unknown as { entries: Map<string, { resources: unknown }> }).entries.get('session-1')!
      let resources = entry.resources as ReturnType<typeof resourceState>
      const firstTurn = getAgentCurrentStreamResource(resources)!
      resources = transitionAgentConnectionResource(resources, {
        type: AgentConnectionResourceEventType.TurnStreamOpened,
        turn: firstTurn
      }).state
      resources = transitionAgentConnectionResource(resources, {
        type: AgentConnectionResourceEventType.ConnectionStarted,
        connectionAttemptId: 'connect-1'
      }).state
      resources = transitionAgentConnectionResource(resources, {
        type: AgentConnectionResourceEventType.ConnectionConnected,
        connectionAttemptId: 'connect-1',
        connection
      }).state
      resources = transitionAgentConnectionResource(resources, {
        type: AgentConnectionResourceEventType.DriverTerminal,
        segmentId: sourceSegmentId,
        outcome: { status: AgentDriverOutcomeKind.Success }
      }).state
      entry.resources = resources
      manager.releaseTurnResource('session-1', AgentDriverOutcomeKind.Success, first.turnId)
      entry.resources = transitionAgentConnectionResource(entry.resources as ReturnType<typeof resourceState>, {
        type: AgentConnectionResourceEventType.AutonomousTurnState,
        segmentId: autonomousSegmentId,
        state: AgentAutonomousGenerationState.Started
      }).state
      const intent = manager.describeConversationAutonomous('session-1', true)
      const activating = manager.activateConversationRuntimeTurn(intent, new AbortController().signal)
      await vi.waitFor(() => expect(connection.refreshTraceContext).toHaveBeenCalledOnce())

      await manager.closeSession('session-1')
      finishRefresh()

      await expect(activating).rejects.toThrow('superseded')
      expect((manager as unknown as { entries: Map<string, unknown> }).entries.has('session-1')).toBe(false)
    })
  })

  describe('connection reconcile ownership', () => {
    const connection = (reconcile: AgentRuntimeConnection['reconcile']): AgentRuntimeConnection => ({
      events: neverRuntimeEvents(),
      send: vi.fn(),
      close: vi.fn(),
      reconcile
    })

    const installIdle = (manager: AgentConnectionManager, current: AgentRuntimeConnection) => {
      let resources = resourceState()
      resources = transitionAgentConnectionResource(resources, {
        type: AgentConnectionResourceEventType.ConnectionStarted,
        connectionAttemptId: 'connect-1'
      }).state
      resources = transitionAgentConnectionResource(resources, {
        type: AgentConnectionResourceEventType.ConnectionConnected,
        connectionAttemptId: 'connect-1',
        connection: current
      }).state
      const entry = {
        conversation: { kind: ConversationKind.Agent, id: 'session-1' } as const,
        agentId: 'agent-1',
        agentType: 'test-runtime',
        modelId: 'provider::model',
        resources
      }
      ;(manager as unknown as { entries: Map<string, typeof entry> }).entries.set('session-1', entry)
      return entry
    }

    const update = (manager: AgentConnectionManager, entry: ReturnType<typeof installIdle>, updates = {}) =>
      (
        manager as unknown as {
          handleAgentUpdated: (agentId: string, changes: object, agent: object) => Promise<void>
        }
      ).handleAgentUpdated(entry.agentId, updates, {
        id: entry.agentId,
        model: entry.modelId,
        type: entry.agentType
      })

    it('connects a turn created before a model edit with its captured model (edit-before-open-stream)', () => {
      const manager = new AgentConnectionManager()
      manager.prepareTurnResources({
        conversation: { kind: ConversationKind.Agent, id: 'session-1' },
        agentId: 'agent-1',
        agentType: 'test-runtime',
        modelId: 'provider::captured-model',
        assistantMessageId: 'assistant-1',
        userMessage: input('user-1').message
      })
      const entry = (
        manager as unknown as { entries: Map<string, { modelId: string; resources: unknown }> }
      ).entries.get('session-1')!
      entry.modelId = 'provider::edited-model'

      const target = (
        manager as unknown as {
          connectionTarget: (current: typeof entry) => { modelId: string }
        }
      ).connectionTarget(entry)

      expect(target.modelId).toBe('provider::captured-model')
    })

    it('reconciles the connection on any agent update without closing a current one', async () => {
      const current = connection(vi.fn().mockResolvedValue(AgentRuntimeReconcileResult.Patched))
      const manager = new AgentConnectionManager()
      const entry = installIdle(manager, current)

      await update(manager, entry, { disabledTools: ['Bash'] })

      expect(current.reconcile).toHaveBeenCalledExactlyOnceWith({
        modelId: 'provider::model',
        reasoningEffort: 'default',
        serviceTier: 'standard',
        knowledgeBaseIds: [],
        fastMode: false
      })
      expect(current.close).not.toHaveBeenCalled()
    })

    it('pushes a reconcile for configuration-only updates', async () => {
      const current = connection(vi.fn().mockResolvedValue(AgentRuntimeReconcileResult.Current))
      const manager = new AgentConnectionManager()
      const entry = installIdle(manager, current)

      await update(manager, entry, { configuration: { permission_mode: 'plan' } })

      expect(current.reconcile).toHaveBeenCalledOnce()
      expect(current.close).not.toHaveBeenCalled()
    })

    it('fails closed and logs when a push reconcile throws', async () => {
      const current = connection(vi.fn().mockRejectedValue(new Error('policy update failed')))
      const manager = new AgentConnectionManager()
      const entry = installIdle(manager, current)

      await update(manager, entry, { disabledTools: ['Bash'] })

      await vi.waitFor(() => expect(current.close).toHaveBeenCalledOnce())
      expect(entry.resources.connection.kind).toBe(AgentConnectionResourceKind.Disconnected)
    })

    it('pauses the active stream and delegates queued-input disposal to Conversation when a live reconcile fails', async () => {
      const current = connection(vi.fn().mockResolvedValue(AgentRuntimeReconcileResult.Failed))
      const manager = new AgentConnectionManager()
      manager.prepareTurnResources({
        conversation: { kind: ConversationKind.Agent, id: 'session-1' },
        agentId: 'agent-1',
        agentType: 'test-runtime',
        modelId: 'provider::model',
        assistantMessageId: 'assistant-1',
        userMessage: userMessage('user-1')
      })
      const entry = (
        manager as unknown as { entries: Map<string, { agentId: string; agentType: string; resources: unknown }> }
      ).entries.get('session-1')!
      let resources = entry.resources as ReturnType<typeof resourceState>
      const currentTurn = getAgentCurrentStreamResource(resources)!
      resources = transitionAgentConnectionResource(resources, {
        type: AgentConnectionResourceEventType.TurnStreamOpened,
        turn: currentTurn
      }).state
      resources = transitionAgentConnectionResource(resources, {
        type: AgentConnectionResourceEventType.ConnectionStarted,
        connectionAttemptId: 'connect-1'
      }).state
      resources = transitionAgentConnectionResource(resources, {
        type: AgentConnectionResourceEventType.ConnectionConnected,
        connectionAttemptId: 'connect-1',
        connection: current
      }).state
      resources = transitionAgentConnectionResource(resources, {
        type: AgentConnectionResourceEventType.TurnSentToConnection,
        turn: currentTurn
      }).state
      entry.resources = resources

      await (
        manager as unknown as {
          handleAgentUpdated: (agentId: string, changes: object, agent: object) => Promise<void>
        }
      ).handleAgentUpdated(
        'agent-1',
        { disabledTools: ['Bash'] },
        {
          id: 'agent-1',
          model: 'provider::model',
          type: 'test-runtime'
        }
      )

      expect(services.conversation.abort).toHaveBeenCalledExactlyOnceWith(
        { kind: ConversationKind.Agent, id: 'session-1' },
        'agent-policy-update-failed'
      )
      expect(current.close).toHaveBeenCalledOnce()
      expect(entry.resources).toMatchObject({ connection: { kind: AgentConnectionResourceKind.Disconnected } })
      expect(entry).not.toHaveProperty('pendingTurns')
    })

    it('does not close a replacement runtime when an old reconcile settles late', async () => {
      let rejectOld!: (error: Error) => void
      const oldResult = new Promise<AgentRuntimeReconcileResult>((_, reject) => {
        rejectOld = reject
      })
      const oldConnection = connection(vi.fn(() => oldResult))
      const replacement = connection(vi.fn().mockResolvedValue(AgentRuntimeReconcileResult.Current))
      const manager = new AgentConnectionManager()
      const oldEntry = installIdle(manager, oldConnection)
      const updating = update(manager, oldEntry, { disabledTools: ['Bash'] })
      await vi.waitFor(() => expect(oldConnection.reconcile).toHaveBeenCalledOnce())
      installIdle(manager, replacement)

      rejectOld(new Error('late reconcile failure'))
      await updating

      expect(oldConnection.close).toHaveBeenCalledOnce()
      expect(replacement.close).not.toHaveBeenCalled()
    })

    it('rebuilds an idle connection eagerly when reconcile reports rebuild', async () => {
      const current = connection(vi.fn().mockResolvedValue(AgentRuntimeReconcileResult.Rebuild))
      const manager = new AgentConnectionManager()
      const entry = installIdle(manager, current)

      await update(manager, entry, { instructions: 'be terse' })

      await vi.waitFor(() => expect(current.close).toHaveBeenCalledOnce())
      expect(entry.resources.connection.kind).toBe(AgentConnectionResourceKind.Disconnected)
    })

    it('defers the rebuild while a turn is live and leaves the connection streaming', async () => {
      const current = connection(vi.fn().mockResolvedValue(AgentRuntimeReconcileResult.Rebuild))
      const manager = new AgentConnectionManager()
      const handle = manager.prepareTurnResources({
        conversation: { kind: ConversationKind.Agent, id: 'session-1' },
        agentId: 'agent-1',
        agentType: 'test-runtime',
        modelId: 'provider::model',
        assistantMessageId: 'assistant-1',
        userMessage: input('user-1').message
      })
      const entry = (manager as unknown as { entries: Map<string, { resources: unknown }> }).entries.get('session-1')!
      let resources = entry.resources as ReturnType<typeof resourceState>
      const currentTurn = getAgentCurrentStreamResource(resources)!
      resources = transitionAgentConnectionResource(resources, {
        type: AgentConnectionResourceEventType.TurnStreamOpened,
        turn: currentTurn
      }).state
      resources = transitionAgentConnectionResource(resources, {
        type: AgentConnectionResourceEventType.ConnectionStarted,
        connectionAttemptId: 'connect-1'
      }).state
      resources = transitionAgentConnectionResource(resources, {
        type: AgentConnectionResourceEventType.ConnectionConnected,
        connectionAttemptId: 'connect-1',
        connection: current
      }).state
      entry.resources = resources

      await update(manager, entry as ReturnType<typeof installIdle>, { instructions: 'be terse' })

      expect(handle.turnId).toBeDefined()
      expect(current.close).not.toHaveBeenCalled()
    })

    it('keeps the live connection across a steer roll when the agent model changes mid-roll', async () => {
      const current = connection(vi.fn().mockResolvedValue(AgentRuntimeReconcileResult.Rebuild))
      const manager = new AgentConnectionManager()
      manager.prepareTurnResources({
        conversation: { kind: ConversationKind.Agent, id: 'session-1' },
        agentId: 'agent-1',
        agentType: 'test-runtime',
        modelId: 'provider::model',
        assistantMessageId: 'assistant-1',
        userMessage: input('user-1').message
      })
      const entry = (
        manager as unknown as {
          entries: Map<string, { resources: unknown; modelId: string; agentId: string; agentType: string }>
        }
      ).entries.get('session-1')!
      let resources = entry.resources as ReturnType<typeof resourceState>
      const source = getAgentCurrentStreamResource(resources)!
      const currentSegmentId = getAgentCurrentSegmentId(resources)!
      const redirect = { ...redirectInput('redirect-model-change'), segmentId: currentSegmentId }
      resources = transitionAgentConnectionResource(resources, {
        type: AgentConnectionResourceEventType.TurnStreamOpened,
        turn: source
      }).state
      resources = transitionAgentConnectionResource(resources, {
        type: AgentConnectionResourceEventType.ConnectionStarted,
        connectionAttemptId: 'connect-1'
      }).state
      resources = transitionAgentConnectionResource(resources, {
        type: AgentConnectionResourceEventType.ConnectionConnected,
        connectionAttemptId: 'connect-1',
        connection: current
      }).state
      resources = transitionAgentConnectionResource(resources, {
        type: AgentConnectionResourceEventType.RedirectQueued,
        redirect
      }).state
      resources = transitionAgentConnectionResource(resources, {
        type: AgentConnectionResourceEventType.SteerBoundary,
        redirectIds: [redirect.redirectId],
        sourceSegmentId: currentSegmentId,
        successorSegmentId,
        headless: false
      }).state
      entry.resources = resources

      await (
        manager as unknown as {
          handleAgentUpdated: (agentId: string, changes: object, agent: object) => Promise<void>
        }
      ).handleAgentUpdated(
        'agent-1',
        { model: 'provider::updated-model' },
        { id: 'agent-1', model: 'provider::updated-model', type: 'test-runtime' }
      )

      expect(entry.modelId).toBe('provider::updated-model')
      expect(entry.resources).toMatchObject({
        generation: { kind: AgentConnectionResourceKind.SteerTransition }
      })
      expect(current.reconcile).toHaveBeenCalledExactlyOnceWith({
        modelId: 'provider::model',
        reasoningEffort: 'default',
        serviceTier: 'standard',
        knowledgeBaseIds: [],
        fastMode: false
      })
      expect(current.close).not.toHaveBeenCalled()
    })

    it('does not retarget/close the live connection when ensureConnection re-enters mid-roll after a model edit', async () => {
      const current = connection(vi.fn().mockResolvedValue(AgentRuntimeReconcileResult.Rebuild))
      const manager = new AgentConnectionManager()
      manager.prepareTurnResources({
        conversation: { kind: ConversationKind.Agent, id: 'session-1' },
        agentId: 'agent-1',
        agentType: 'test-runtime',
        modelId: 'provider::model',
        assistantMessageId: 'assistant-1',
        userMessage: input('user-1').message
      })
      const entry = (
        manager as unknown as { entries: Map<string, { resources: unknown; modelId: string }> }
      ).entries.get('session-1')!
      let resources = entry.resources as ReturnType<typeof resourceState>
      const currentTurn = getAgentCurrentStreamResource(resources)!
      const currentSegmentId = getAgentCurrentSegmentId(resources)!
      const redirect = { ...redirectInput('redirect-reentry'), segmentId: currentSegmentId }
      resources = transitionAgentConnectionResource(resources, {
        type: AgentConnectionResourceEventType.TurnStreamOpened,
        turn: currentTurn
      }).state
      resources = transitionAgentConnectionResource(resources, {
        type: AgentConnectionResourceEventType.ConnectionStarted,
        connectionAttemptId: 'connect-1'
      }).state
      resources = transitionAgentConnectionResource(resources, {
        type: AgentConnectionResourceEventType.ConnectionConnected,
        connectionAttemptId: 'connect-1',
        connection: current
      }).state
      resources = transitionAgentConnectionResource(resources, {
        type: AgentConnectionResourceEventType.TurnSentToConnection,
        turn: currentTurn
      }).state
      resources = transitionAgentConnectionResource(resources, {
        type: AgentConnectionResourceEventType.RedirectQueued,
        redirect
      }).state
      resources = transitionAgentConnectionResource(resources, {
        type: AgentConnectionResourceEventType.SteerBoundary,
        redirectIds: [redirect.redirectId],
        sourceSegmentId: currentSegmentId,
        successorSegmentId,
        headless: false
      }).state
      entry.resources = resources
      entry.modelId = 'provider::updated-model'

      await expect(
        (manager as unknown as { ensureConnection: (current: typeof entry) => Promise<boolean> }).ensureConnection(
          entry
        )
      ).resolves.toBe(true)

      expect(current.reconcile).not.toHaveBeenCalled()
      expect(current.close).not.toHaveBeenCalled()
    })

    it('never reconciles under an admitted streaming turn', async () => {
      const current = connection(vi.fn().mockResolvedValue(AgentRuntimeReconcileResult.Rebuild))
      const manager = new AgentConnectionManager()
      manager.prepareTurnResources({
        conversation: { kind: ConversationKind.Agent, id: 'session-1' },
        agentId: 'agent-1',
        agentType: 'test-runtime',
        modelId: 'provider::model',
        assistantMessageId: 'assistant-1',
        userMessage: input('user-1').message
      })
      const entry = (manager as unknown as { entries: Map<string, { resources: unknown }> }).entries.get('session-1')!
      let resources = entry.resources as ReturnType<typeof resourceState>
      const currentTurn = getAgentCurrentStreamResource(resources)!
      resources = transitionAgentConnectionResource(resources, {
        type: AgentConnectionResourceEventType.TurnStreamOpened,
        turn: currentTurn
      }).state
      resources = transitionAgentConnectionResource(resources, {
        type: AgentConnectionResourceEventType.ConnectionStarted,
        connectionAttemptId: 'connect-1'
      }).state
      resources = transitionAgentConnectionResource(resources, {
        type: AgentConnectionResourceEventType.ConnectionConnected,
        connectionAttemptId: 'connect-1',
        connection: current
      }).state
      resources = transitionAgentConnectionResource(resources, {
        type: AgentConnectionResourceEventType.TurnSentToConnection,
        turn: currentTurn
      }).state
      entry.resources = resources

      await expect(
        (manager as unknown as { ensureConnection: (current: typeof entry) => Promise<boolean> }).ensureConnection(
          entry
        )
      ).resolves.toBe(true)

      expect(current.reconcile).not.toHaveBeenCalled()
      expect(current.close).not.toHaveBeenCalled()
    })

    it('does not close a replacement connection when a slow reconcile resolves after a racing rebuild (TOCTOU)', async () => {
      let resolveOld!: (result: AgentRuntimeReconcileResult) => void
      const oldResult = new Promise<AgentRuntimeReconcileResult>((resolve) => {
        resolveOld = resolve
      })
      const stale = connection(vi.fn(() => oldResult))
      const replacement = connection(vi.fn().mockResolvedValue(AgentRuntimeReconcileResult.Current))
      const manager = new AgentConnectionManager()
      manager.prepareTurnResources({
        conversation: { kind: ConversationKind.Agent, id: 'session-1' },
        agentId: 'agent-1',
        agentType: 'test-runtime',
        modelId: 'provider::model',
        assistantMessageId: 'assistant-1',
        userMessage: input('user-1').message
      })
      const entry = (manager as unknown as { entries: Map<string, { resources: unknown }> }).entries.get('session-1')!
      let resources = entry.resources as ReturnType<typeof resourceState>
      const currentTurn = getAgentCurrentStreamResource(resources)!
      resources = transitionAgentConnectionResource(resources, {
        type: AgentConnectionResourceEventType.TurnStreamOpened,
        turn: currentTurn
      }).state
      resources = transitionAgentConnectionResource(resources, {
        type: AgentConnectionResourceEventType.ConnectionStarted,
        connectionAttemptId: 'connect-old'
      }).state
      resources = transitionAgentConnectionResource(resources, {
        type: AgentConnectionResourceEventType.ConnectionConnected,
        connectionAttemptId: 'connect-old',
        connection: stale
      }).state
      entry.resources = resources
      const ensuring = (
        manager as unknown as { ensureConnection: (current: typeof entry) => Promise<boolean> }
      ).ensureConnection(entry)
      await vi.waitFor(() => expect(stale.reconcile).toHaveBeenCalledOnce())

      resources = transitionAgentConnectionResource(resources, {
        type: AgentConnectionResourceEventType.ConnectionDisconnected,
        connection: stale
      }).state
      resources = transitionAgentConnectionResource(resources, {
        type: AgentConnectionResourceEventType.ConnectionStarted,
        connectionAttemptId: 'connect-new'
      }).state
      resources = transitionAgentConnectionResource(resources, {
        type: AgentConnectionResourceEventType.ConnectionConnected,
        connectionAttemptId: 'connect-new',
        connection: replacement
      }).state
      resources = transitionAgentConnectionResource(resources, {
        type: AgentConnectionResourceEventType.TurnSentToConnection,
        turn: currentTurn
      }).state
      entry.resources = resources
      resolveOld(AgentRuntimeReconcileResult.Rebuild)

      await expect(ensuring).resolves.toBe(true)
      expect(replacement.close).not.toHaveBeenCalled()
      expect(replacement.reconcile).not.toHaveBeenCalled()
    })

    it('closes the session when reconcile reports the config is no longer derivable', async () => {
      const current = connection(vi.fn().mockResolvedValue(AgentRuntimeReconcileResult.Invalid))
      const manager = new AgentConnectionManager()
      const entry = installIdle(manager, current)

      await expect(
        (manager as unknown as { ensureConnection: (current: typeof entry) => Promise<boolean> }).ensureConnection(
          entry
        )
      ).resolves.toBe(false)

      await vi.waitFor(() => expect(current.close).toHaveBeenCalledOnce())
      expect((manager as unknown as { entries: Map<string, unknown> }).entries.has('session-1')).toBe(false)
    })

    it('invalidates an entry with an in-flight connect when the agent model is cleared', async () => {
      runtimeDriverRegistry.clearForTest()
      let finishConnect!: (connection: AgentRuntimeConnection) => void
      const pendingConnect = new Promise<AgentRuntimeConnection>((resolve) => {
        finishConnect = resolve
      })
      const lateConnection = connection(vi.fn().mockResolvedValue(AgentRuntimeReconcileResult.Current))
      const connect = vi.fn(() => pendingConnect)
      runtimeDriverRegistry.register({
        type: 'test-runtime',
        capabilities: [AiRuntimeCapability.AgentSession],
        connect,
        validateSession: vi.fn(),
        listAvailableTools: vi.fn().mockResolvedValue([])
      })
      vi.spyOn(agentService, 'getAgent').mockReturnValue({ knowledgeBaseIds: [] } as never)
      vi.spyOn(agentSessionMessageService, 'getLastRuntimeResumeToken').mockReturnValue(null)
      const manager = new AgentConnectionManager()
      const entry = {
        conversation: { kind: ConversationKind.Agent, id: 'session-1' } as const,
        agentId: 'agent-1',
        agentType: 'test-runtime',
        modelId: 'provider::model',
        resources: resourceState()
      }
      ;(manager as unknown as { entries: Map<string, typeof entry> }).entries.set('session-1', entry)
      const connecting = (
        manager as unknown as { ensureConnection: (current: typeof entry) => Promise<boolean> }
      ).ensureConnection(entry)
      await vi.waitFor(() => expect(connect).toHaveBeenCalledOnce())

      await (
        manager as unknown as {
          handleAgentUpdated: (agentId: string, changes: object, agent: object) => Promise<void>
        }
      ).handleAgentUpdated('agent-1', { model: null }, { id: 'agent-1', model: null, type: 'test-runtime' })
      finishConnect(lateConnection)

      await expect(connecting).resolves.toBe(false)
      await vi.waitFor(() => expect(lateConnection.close).toHaveBeenCalledOnce())
      expect((manager as unknown as { entries: Map<string, unknown> }).entries.has('session-1')).toBe(false)
      expect(services.conversation.abort).not.toHaveBeenCalled()
      runtimeDriverRegistry.clearForTest()
    })

    it('retries callers sharing an in-flight connect when a mid-flight model edit discards it', async () => {
      runtimeDriverRegistry.clearForTest()
      let finishFirst!: (connection: AgentRuntimeConnection) => void
      const firstPending = new Promise<AgentRuntimeConnection>((resolve) => {
        finishFirst = resolve
      })
      const firstConnection = connection(vi.fn().mockResolvedValue(AgentRuntimeReconcileResult.Current))
      const secondEvents = closableRuntimeEvents()
      const secondConnection = {
        events: secondEvents.events,
        send: vi.fn(),
        close: vi.fn(secondEvents.close),
        reconcile: vi.fn().mockResolvedValue(AgentRuntimeReconcileResult.Current)
      } satisfies AgentRuntimeConnection
      const connect = vi.fn().mockReturnValueOnce(firstPending).mockResolvedValueOnce(secondConnection)
      runtimeDriverRegistry.register({
        type: 'test-runtime',
        capabilities: [AiRuntimeCapability.AgentSession],
        connect,
        validateSession: vi.fn(),
        listAvailableTools: vi.fn().mockResolvedValue([])
      })
      vi.spyOn(agentService, 'getAgent').mockReturnValue({ knowledgeBaseIds: [] } as never)
      vi.spyOn(agentSessionMessageService, 'getLastRuntimeResumeToken').mockReturnValue(null)
      const manager = new AgentConnectionManager()
      const entry = {
        conversation: { kind: ConversationKind.Agent, id: 'session-1' } as const,
        agentId: 'agent-1',
        agentType: 'test-runtime',
        modelId: 'provider::model',
        resources: resourceState()
      }
      ;(manager as unknown as { entries: Map<string, typeof entry> }).entries.set('session-1', entry)
      const ensure = (
        manager as unknown as { ensureConnection: (current: typeof entry) => Promise<boolean> }
      ).ensureConnection.bind(manager)
      const starter = ensure(entry)
      const waiter = ensure(entry)
      await vi.waitFor(() => expect(connect).toHaveBeenCalledOnce())

      await (
        manager as unknown as {
          handleAgentUpdated: (agentId: string, changes: object, agent: object) => Promise<void>
        }
      ).handleAgentUpdated(
        'agent-1',
        { model: 'provider::updated-model' },
        { id: 'agent-1', model: 'provider::updated-model', type: 'test-runtime' }
      )
      finishFirst(firstConnection)

      await expect(starter).resolves.toBe(true)
      await expect(waiter).resolves.toBe(true)
      expect(firstConnection.close).toHaveBeenCalledOnce()
      expect(secondConnection.close).not.toHaveBeenCalled()
      expect(connect).toHaveBeenCalledTimes(2)
      expect(connect).toHaveBeenNthCalledWith(2, expect.objectContaining({ modelId: 'provider::updated-model' }))
      await manager.closeSession('session-1')
      runtimeDriverRegistry.clearForTest()
    })

    it('pauses a live turn and tears the session down when the agent model is cleared', async () => {
      const current = connection(vi.fn().mockResolvedValue(AgentRuntimeReconcileResult.Current))
      const manager = new AgentConnectionManager()
      manager.prepareTurnResources({
        conversation: { kind: ConversationKind.Agent, id: 'session-1' },
        agentId: 'agent-1',
        agentType: 'test-runtime',
        modelId: 'provider::model',
        assistantMessageId: 'assistant-1',
        userMessage: input('user-1').message
      })
      const entry = (manager as unknown as { entries: Map<string, { resources: unknown }> }).entries.get('session-1')!
      let resources = entry.resources as ReturnType<typeof resourceState>
      const currentTurn = getAgentCurrentStreamResource(resources)!
      resources = transitionAgentConnectionResource(resources, {
        type: AgentConnectionResourceEventType.TurnStreamOpened,
        turn: currentTurn
      }).state
      resources = transitionAgentConnectionResource(resources, {
        type: AgentConnectionResourceEventType.ConnectionStarted,
        connectionAttemptId: 'connect-1'
      }).state
      resources = transitionAgentConnectionResource(resources, {
        type: AgentConnectionResourceEventType.ConnectionConnected,
        connectionAttemptId: 'connect-1',
        connection: current
      }).state
      resources = transitionAgentConnectionResource(resources, {
        type: AgentConnectionResourceEventType.TurnSentToConnection,
        turn: currentTurn
      }).state
      entry.resources = resources

      await (
        manager as unknown as {
          handleAgentUpdated: (agentId: string, changes: object, agent: object) => Promise<void>
        }
      ).handleAgentUpdated('agent-1', { model: null }, { id: 'agent-1', model: null, type: 'test-runtime' })

      expect(services.conversation.abort).toHaveBeenCalledExactlyOnceWith(
        { kind: ConversationKind.Agent, id: 'session-1' },
        'agent-model-cleared'
      )
      await vi.waitFor(() => expect(current.close).toHaveBeenCalledOnce())
      expect((manager as unknown as { entries: Map<string, unknown> }).entries.has('session-1')).toBe(false)
    })
  })

  describe('connection reconcile — pull path', () => {
    const openAgainstWarmConnection = async (options: {
      modelId?: UniqueModelId
      knowledgeBaseIds?: string[]
      verdict: AgentRuntimeReconcileResult
    }) => {
      runtimeDriverRegistry.clearForTest()
      const replacementEvents = closableRuntimeEvents()
      const current = {
        events: neverRuntimeEvents(),
        send: vi.fn(),
        close: vi.fn(),
        reconcile: vi.fn().mockResolvedValue(options.verdict)
      } satisfies AgentRuntimeConnection
      const replacement = {
        events: replacementEvents.events,
        send: vi.fn(),
        close: vi.fn(replacementEvents.close),
        reconcile: vi.fn().mockResolvedValue(AgentRuntimeReconcileResult.Current)
      } satisfies AgentRuntimeConnection
      const connect = vi.fn().mockResolvedValue(replacement)
      runtimeDriverRegistry.register({
        type: 'test-runtime',
        capabilities: [AiRuntimeCapability.AgentSession],
        connect,
        validateSession: vi.fn(),
        listAvailableTools: vi.fn().mockResolvedValue([])
      })
      vi.spyOn(agentService, 'getAgent').mockReturnValue({ knowledgeBaseIds: [] } as never)
      vi.spyOn(agentSessionMessageService, 'getLastRuntimeResumeToken').mockReturnValue(null)
      const manager = new AgentConnectionManager()
      const handle = manager.prepareTurnResources({
        conversation: { kind: ConversationKind.Agent, id: 'session-1' },
        agentId: 'agent-1',
        agentType: 'test-runtime',
        modelId: options.modelId ?? 'provider::model',
        assistantMessageId: 'assistant-1',
        userMessage: userMessage('user-1', options.knowledgeBaseIds)
      })
      const entry = (manager as unknown as { entries: Map<string, { resources: unknown }> }).entries.get('session-1')!
      let resources = entry.resources as ReturnType<typeof resourceState>
      const turnResource = getAgentCurrentStreamResource(resources)!
      resources = transitionAgentConnectionResource(resources, {
        type: AgentConnectionResourceEventType.TurnStreamOpened,
        turn: turnResource
      }).state
      resources = transitionAgentConnectionResource(resources, {
        type: AgentConnectionResourceEventType.ConnectionStarted,
        connectionAttemptId: 'warm-connect'
      }).state
      resources = transitionAgentConnectionResource(resources, {
        type: AgentConnectionResourceEventType.ConnectionConnected,
        connectionAttemptId: 'warm-connect',
        connection: current
      }).state
      entry.resources = resources
      const ensuring = (
        manager as unknown as { ensureConnection: (currentEntry: typeof entry) => Promise<boolean> }
      ).ensureConnection(entry)
      await vi.waitFor(() => expect(current.reconcile).toHaveBeenCalledOnce())
      if (options.verdict === AgentRuntimeReconcileResult.Rebuild) {
        await vi.waitFor(() => expect(connect).toHaveBeenCalled())
        await Promise.resolve()
        expect(connect).toHaveBeenCalledTimes(1)
        expect(entry.resources).toMatchObject({
          connection: { kind: AgentConnectionResourceKind.Connected, connection: replacement }
        })
      }
      await expect(ensuring).resolves.toBe(true)
      return { manager, handle, entry, current, replacement, connect }
    }

    const close = async (result: Awaited<ReturnType<typeof openAgainstWarmConnection>>) => {
      await result.manager.closeSession('session-1')
      runtimeDriverRegistry.clearForTest()
    }

    it('reconnects an idle runtime when the agent model changes before the next turn', async () => {
      const result = await openAgainstWarmConnection({
        modelId: 'provider::updated-model',
        verdict: AgentRuntimeReconcileResult.Rebuild
      })

      expect(result.current.reconcile).toHaveBeenCalledWith(
        expect.objectContaining({ modelId: 'provider::updated-model' })
      )
      expect(result.current.close).toHaveBeenCalledOnce()
      expect(result.connect).toHaveBeenCalledWith(expect.objectContaining({ modelId: 'provider::updated-model' }))
      expect(result.entry.resources).toMatchObject({
        connection: { kind: AgentConnectionResourceKind.Connected, connection: result.replacement }
      })
      await close(result)
    })

    it('rebuilds a stale warm connection before the next turn — no event required', async () => {
      const result = await openAgainstWarmConnection({ verdict: AgentRuntimeReconcileResult.Rebuild })

      expect(result.current.reconcile).toHaveBeenCalledOnce()
      expect(result.current.close).toHaveBeenCalledOnce()
      expect(result.connect).toHaveBeenCalledOnce()
      expect(result.entry.resources).toMatchObject({
        connection: { kind: AgentConnectionResourceKind.Connected, connection: result.replacement }
      })
      await close(result)
    })

    it('rebuilds the connection for a queued turn with a different knowledge scope', async () => {
      const result = await openAgainstWarmConnection({
        knowledgeBaseIds: ['kb-2'],
        verdict: AgentRuntimeReconcileResult.Rebuild
      })

      expect(result.current.reconcile).toHaveBeenCalledWith(expect.objectContaining({ knowledgeBaseIds: ['kb-2'] }))
      expect(result.connect).toHaveBeenCalledWith(expect.objectContaining({ knowledgeBaseIds: ['kb-2'] }))
      expect(result.current.close).toHaveBeenCalledOnce()
      await close(result)
    })

    it('reuses the warm connection for a queued turn whose knowledge scope is unchanged', async () => {
      const result = await openAgainstWarmConnection({
        knowledgeBaseIds: ['kb-1'],
        verdict: AgentRuntimeReconcileResult.Current
      })

      expect(result.current.reconcile).toHaveBeenCalledWith(expect.objectContaining({ knowledgeBaseIds: ['kb-1'] }))
      expect(result.connect).not.toHaveBeenCalled()
      expect(result.current.close).not.toHaveBeenCalled()
      expect(result.entry.resources).toMatchObject({
        connection: { kind: AgentConnectionResourceKind.Connected, connection: result.current }
      })
      await close(result)
    })
  })

  describe('background tasks', () => {
    const tasks = [{ id: 'bg-1', type: 'subagent', description: 'Audit the codebase' }]

    const install = (
      manager: AgentConnectionManager,
      options: { headless?: boolean; stopTask?: (id: string) => Promise<boolean> } = {}
    ) => {
      const turnHandle = manager.prepareTurnResources({
        conversation: { kind: ConversationKind.Agent, id: 'session-1' },
        agentId: 'agent-1',
        agentType: 'test-runtime',
        modelId: 'provider::model',
        assistantMessageId: 'assistant-1',
        userMessage: input('user-1').message,
        headless: options.headless
      })
      const connection = {
        events: neverRuntimeEvents(),
        send: vi.fn(),
        close: vi.fn(),
        reconcile: vi.fn().mockResolvedValue(AgentRuntimeReconcileResult.Current),
        ...(options.stopTask ? { stopTask: options.stopTask } : {})
      } satisfies AgentRuntimeConnection
      const entry = (manager as unknown as { entries: Map<string, { resources: unknown }> }).entries.get('session-1')!
      let resources = entry.resources as ReturnType<typeof resourceState>
      resources = transitionAgentConnectionResource(resources, {
        type: AgentConnectionResourceEventType.ConnectionStarted,
        connectionAttemptId: 'connect-1'
      }).state
      resources = transitionAgentConnectionResource(resources, {
        type: AgentConnectionResourceEventType.ConnectionConnected,
        connectionAttemptId: 'connect-1',
        connection
      }).state
      entry.resources = resources
      const handleRuntimeEvent = (
        manager as unknown as {
          handleRuntimeEvent: (current: typeof entry, event: AgentRuntimeEvent, owner?: AgentRuntimeConnection) => void
        }
      ).handleRuntimeEvent.bind(manager)
      return { connection, entry, handleRuntimeEvent, turnHandle }
    }

    it('republishes the membership snapshot as session-scoped status', () => {
      const manager = new AgentConnectionManager()
      const { entry, handleRuntimeEvent } = install(manager)

      handleRuntimeEvent(entry, { type: AgentRuntimeEventType.BackgroundTasks, tasks })

      expect(services.sharedValues.get(AGENT_SESSION_BACKGROUND_TASKS_CACHE_KEY('session-1'))).toEqual(tasks)
    })

    it('replaces the set, so an emptied snapshot clears the last running task', () => {
      const manager = new AgentConnectionManager()
      const { entry, handleRuntimeEvent } = install(manager)
      handleRuntimeEvent(entry, { type: AgentRuntimeEventType.BackgroundTasks, tasks })

      handleRuntimeEvent(entry, { type: AgentRuntimeEventType.BackgroundTasks, tasks: [] })

      expect(services.sharedValues.get(AGENT_SESSION_BACKGROUND_TASKS_CACHE_KEY('session-1'))).toEqual([])
    })

    it('remembers whether the turn that spawned background work had an interactive responder', () => {
      const interactiveManager = new AgentConnectionManager()
      const interactive = install(interactiveManager)
      interactive.handleRuntimeEvent(interactive.entry, {
        type: AgentRuntimeEventType.BackgroundWorkState,
        active: true
      })
      expect(services.conversation.openAgentActivity).toHaveBeenLastCalledWith(
        'session-1',
        ConversationActivityKind.Background,
        ConversationResponderKind.Interactive
      )

      BaseService.resetInstances()
      const headlessManager = new AgentConnectionManager()
      const headless = install(headlessManager, { headless: true })
      headless.handleRuntimeEvent(headless.entry, {
        type: AgentRuntimeEventType.BackgroundWorkState,
        active: true
      })
      expect(services.conversation.openAgentActivity).toHaveBeenLastCalledWith(
        'session-1',
        ConversationActivityKind.Background,
        ConversationResponderKind.Headless
      )
    })

    it('releases background keepalive on a no-wake completion without touching autonomous ownership', () => {
      const manager = new AgentConnectionManager()
      const { entry, handleRuntimeEvent } = install(manager)

      handleRuntimeEvent(entry, { type: AgentRuntimeEventType.BackgroundWorkState, active: true })
      expect(hasAgentConnectionBackgroundWork(entry.resources as never)).toBe(true)
      expect((entry.resources as { generation: { kind: AgentConnectionResourceKind } }).generation.kind).toBe(
        AgentConnectionResourceKind.Turn
      )

      handleRuntimeEvent(entry, { type: AgentRuntimeEventType.BackgroundWorkState, active: false })
      expect(hasAgentConnectionBackgroundWork(entry.resources as never)).toBe(false)
      expect((entry.resources as { generation: { kind: AgentConnectionResourceKind } }).generation.kind).toBe(
        AgentConnectionResourceKind.Turn
      )
    })

    it('stops one task through the connection without touching the turn', async () => {
      const stopTask = vi.fn().mockResolvedValue(true)
      const manager = new AgentConnectionManager()
      const { entry } = install(manager, { stopTask })
      const before = (entry.resources as { generation: unknown }).generation

      await expect(manager.stopBackgroundTask('session-1', 'bg-1')).resolves.toBe(true)

      expect(stopTask).toHaveBeenCalledExactlyOnceWith('bg-1')
      expect((entry.resources as { generation: unknown }).generation).toBe(before)
    })

    it('reports failure when the session has no live connection', async () => {
      const manager = new AgentConnectionManager()

      await expect(manager.stopBackgroundTask('missing', 'bg-1')).resolves.toBe(false)
    })

    it('reports failure when the runtime cannot stop tasks', async () => {
      const manager = new AgentConnectionManager()
      install(manager)

      await expect(manager.stopBackgroundTask('session-1', 'bg-1')).resolves.toBe(false)
    })

    it('merges late task events per task instead of letting the completion displace the start', () => {
      const manager = new AgentConnectionManager()
      const { entry, handleRuntimeEvent } = install(manager)
      handleRuntimeEvent(entry, {
        type: AgentRuntimeEventType.BackgroundTaskEvent,
        data: {
          event: 'started',
          taskId: 'bg-1',
          status: 'in_progress',
          title: 'Create worktree',
          taskType: 'local_bash'
        }
      })

      handleRuntimeEvent(entry, {
        type: AgentRuntimeEventType.BackgroundTaskEvent,
        data: {
          event: 'notification',
          taskId: 'bg-1',
          status: 'completed',
          summary: 'finished',
          outputFile: '/tmp/output'
        }
      })

      expect(services.sharedValues.get(AGENT_SESSION_TASK_EVENTS_CACHE_KEY('session-1'))).toEqual({
        'bg-1': expect.objectContaining({
          event: 'notification',
          status: 'completed',
          title: 'Create worktree',
          taskType: 'local_bash',
          summary: 'finished'
        })
      })
    })

    it('drops the level when the session closes, since it is scoped to the CLI process', async () => {
      const manager = new AgentConnectionManager()
      const { entry, handleRuntimeEvent } = install(manager)
      handleRuntimeEvent(entry, { type: AgentRuntimeEventType.BackgroundTasks, tasks })

      await manager.closeSession('session-1')

      expect(services.sharedValues.has(AGENT_SESSION_BACKGROUND_TASKS_CACHE_KEY('session-1'))).toBe(false)
    })

    it('ignores task-state resets from a stale connection', () => {
      const manager = new AgentConnectionManager()
      const { connection: current, entry } = install(manager)
      const stale = {
        events: neverRuntimeEvents(),
        send: vi.fn(),
        close: vi.fn(),
        reconcile: vi.fn().mockResolvedValue(AgentRuntimeReconcileResult.Current)
      } satisfies AgentRuntimeConnection
      services.cache.setShared.mockClear()

      ;(
        manager as unknown as {
          resetConnectionResources: (currentEntry: typeof entry, owner: AgentRuntimeConnection) => void
        }
      ).resetConnectionResources(entry, stale)

      expect(current).not.toBe(stale)
      expect(services.cache.setShared).not.toHaveBeenCalled()
    })

    it('publishes detached flow overlays under independent message keys', () => {
      const manager = new AgentConnectionManager()
      const { entry } = install(manager)
      const publish = (
        manager as unknown as {
          publishBackgroundFlowParts: (
            current: typeof entry,
            accumulator: { messageId: string; latest: { parts: Array<{ type: string; text: string }> } }
          ) => void
        }
      ).publishBackgroundFlowParts.bind(manager)

      publish(entry, { messageId: 'assistant-1', latest: { parts: [{ type: 'text', text: 'First flow' }] } })
      publish(entry, { messageId: 'assistant-2', latest: { parts: [{ type: 'text', text: 'Second flow' }] } })

      expect(services.sharedValues.get(AGENT_SESSION_FLOW_PARTS_CACHE_KEY('session-1', 'assistant-1'))).toEqual([
        { type: 'text', text: 'First flow' }
      ])
      expect(services.sharedValues.get(AGENT_SESSION_FLOW_PARTS_CACHE_KEY('session-1', 'assistant-2'))).toEqual([
        { type: 'text', text: 'Second flow' }
      ])
    })

    it('patches detached subagent chunks onto the spawning message after a new foreground turn starts', () => {
      const manager = new AgentConnectionManager()
      const { entry } = install(manager)
      const nextTurn = turn('foreground-2')
      entry.resources = transitionAgentConnectionResource(entry.resources as ReturnType<typeof resourceState>, {
        type: AgentConnectionResourceEventType.Reset
      }).state
      entry.resources = transitionAgentConnectionResource(entry.resources as ReturnType<typeof resourceState>, {
        type: AgentConnectionResourceEventType.BeginTurn,
        segmentId: sourceSegmentId,
        turn: nextTurn
      }).state
      const publish = (
        manager as unknown as {
          publishBackgroundFlowParts: (
            current: typeof entry,
            accumulator: { messageId: string; latest: { parts: Array<{ type: string; text: string }> } }
          ) => void
        }
      ).publishBackgroundFlowParts.bind(manager)

      publish(entry, {
        messageId: 'assistant-1',
        latest: { parts: [{ type: 'text', text: 'Detached continuation' }] }
      })

      expect(getAgentCurrentStreamResource(entry.resources as never)).toBe(nextTurn)
      expect(services.sharedValues.get(AGENT_SESSION_FLOW_PARTS_CACHE_KEY('session-1', 'assistant-1'))).toEqual([
        { type: 'text', text: 'Detached continuation' }
      ])
      expect(services.sharedValues.has(AGENT_SESSION_FLOW_PARTS_CACHE_KEY('session-1', 'foreground-2'))).toBe(false)
    })

    it('retains each latest flow overlay during session close handoff', async () => {
      const replaceMessageParts = vi
        .spyOn(agentSessionMessageService, 'replaceMessageParts')
        .mockReturnValue({} as never)
      const manager = new AgentConnectionManager()
      const { entry } = install(manager)
      const parts = [{ type: 'text', text: 'Latest flow' }]
      const flowEntry = entry as typeof entry & {
        backgroundFlowAccumulators: Map<
          string,
          {
            messageId: string
            controller: { close: () => void }
            done: Promise<void>
            closed: boolean
            latest: { parts: typeof parts }
          }
        >
      }
      flowEntry.backgroundFlowAccumulators = new Map([
        [
          'assistant-1',
          {
            messageId: 'assistant-1',
            controller: { close: vi.fn() },
            done: Promise.resolve(),
            closed: false,
            latest: { parts }
          }
        ]
      ])

      await manager.closeSession('session-1')

      expect(replaceMessageParts).toHaveBeenCalledExactlyOnceWith('session-1', 'assistant-1', parts)
      expect(services.cache.setShared).toHaveBeenCalledWith(
        AGENT_SESSION_FLOW_PARTS_CACHE_KEY('session-1', 'assistant-1'),
        parts,
        60_000
      )
    })

    it('does not finish closing while detached flow parts can still write', async () => {
      let releaseFlow!: () => void
      const done = new Promise<void>((resolve) => {
        releaseFlow = resolve
      })
      vi.spyOn(agentSessionMessageService, 'replaceMessageParts').mockReturnValue({} as never)
      const manager = new AgentConnectionManager()
      const { entry } = install(manager)
      const parts = [{ type: 'text', text: 'Late flow' }]
      ;(
        entry as typeof entry & {
          backgroundFlowAccumulators: Map<
            string,
            {
              messageId: string
              controller: { close: () => void }
              done: Promise<void>
              closed: boolean
              latest: { parts: typeof parts }
            }
          >
        }
      ).backgroundFlowAccumulators = new Map([
        [
          'assistant-1',
          {
            messageId: 'assistant-1',
            controller: { close: vi.fn() },
            done,
            closed: false,
            latest: { parts }
          }
        ]
      ])
      let closed = false
      const closing = manager.closeSession('session-1').then(() => {
        closed = true
      })
      await Promise.resolve()
      expect(closed).toBe(false)

      releaseFlow()
      await closing

      expect(closed).toBe(true)
    })
  })

  describe('runtime approval presentation', () => {
    const installIdle = (manager: AgentConnectionManager) => {
      const entry = {
        conversation: { kind: ConversationKind.Agent, id: 'session-1' } as const,
        agentId: 'agent-1',
        agentType: 'test-runtime',
        modelId: 'provider::model',
        resources: resourceState()
      }
      const internals = manager as unknown as {
        entries: Map<string, typeof entry>
        handleRuntimeEvent: (current: typeof entry, event: AgentRuntimeEvent) => void
      }
      internals.entries.set('session-1', entry)
      return { entry, handleRuntimeEvent: internals.handleRuntimeEvent.bind(manager) }
    }

    it('persists an out-of-turn interaction as an independent assistant message', () => {
      const saveMessage = vi
        .spyOn(agentSessionMessageService, 'saveMessage')
        .mockReturnValue({ id: 'approval-message-1' } as never)
      toolApprovalRegistry.register({
        approvalId: 'approval-bg',
        sessionId: 'session-1',
        toolCallId: 'tool-call-bg',
        toolName: 'AskUserQuestion',
        originalInput: {},
        lifetime: AgentApprovalLifetime.SessionMessage,
        resolve: vi.fn()
      })
      const manager = new AgentConnectionManager()
      const events: unknown[] = []
      manager.onApprovalRequested((event) => events.push(event))
      const { entry, handleRuntimeEvent } = installIdle(manager)
      const inputData = { questions: [{ question: 'Choose a database' }] }

      handleRuntimeEvent(entry, {
        type: AgentRuntimeEventType.ToolApprovalRequest,
        request: {
          approvalId: 'approval-bg',
          toolCallId: 'tool-call-bg',
          toolName: 'AskUserQuestion',
          input: inputData,
          lifetime: AgentApprovalLifetime.SessionMessage
        }
      })

      expect(saveMessage).toHaveBeenCalledWith(
        {
          sessionId: 'session-1',
          message: expect.objectContaining({
            role: 'assistant',
            status: 'success',
            data: {
              parts: [
                expect.objectContaining({
                  type: 'tool-AskUserQuestion',
                  toolCallId: 'tool-call-bg',
                  state: 'approval-requested',
                  approval: { id: 'approval-bg' }
                })
              ]
            }
          })
        },
        { publishDataChange: true }
      )
      expect(events).toEqual([
        {
          conversation: { kind: ConversationKind.Agent, id: 'session-1' },
          approvalId: 'approval-bg',
          requestedAt: expect.any(Number)
        }
      ])
    })

    it('does not publish an out-of-turn approval when its interaction message cannot be persisted', () => {
      vi.spyOn(agentSessionMessageService, 'saveMessage').mockImplementation(() => {
        throw new Error('disk full')
      })
      const resolve = vi.fn()
      toolApprovalRegistry.register({
        approvalId: 'approval-bg',
        sessionId: 'session-1',
        toolCallId: 'tool-call-bg',
        toolName: 'AskUserQuestion',
        originalInput: {},
        lifetime: AgentApprovalLifetime.SessionMessage,
        resolve
      })
      const manager = new AgentConnectionManager()
      const events: unknown[] = []
      manager.onApprovalRequested((event) => events.push(event))
      const { entry, handleRuntimeEvent } = installIdle(manager)

      handleRuntimeEvent(entry, {
        type: AgentRuntimeEventType.ToolApprovalRequest,
        request: {
          approvalId: 'approval-bg',
          toolCallId: 'tool-call-bg',
          toolName: 'AskUserQuestion',
          input: {},
          lifetime: AgentApprovalLifetime.SessionMessage
        }
      })

      expect(events).toEqual([])
      expect(resolve).toHaveBeenCalledExactlyOnceWith({
        approved: false,
        reason: 'Unable to present this approval request to the user'
      })
    })

    it('keeps an in-turn approval on the live assistant stream', () => {
      const manager = new AgentConnectionManager()
      const handle = manager.prepareTurnResources({
        conversation: { kind: ConversationKind.Agent, id: 'session-1' },
        agentId: 'agent-1',
        agentType: 'test-runtime',
        modelId: 'provider::model',
        assistantMessageId: 'assistant-1',
        userMessage: input('user-1').message
      })
      const entry = (manager as unknown as { entries: Map<string, { resources: unknown }> }).entries.get('session-1')!
      let resources = entry.resources as ReturnType<typeof resourceState>
      const currentTurn = getAgentCurrentStreamResource(resources)! as Turn & {
        turnId: string
        controller?: { enqueue: (value: unknown) => void }
      }
      const enqueue = vi.fn()
      currentTurn.controller = { enqueue }
      resources = transitionAgentConnectionResource(resources, {
        type: AgentConnectionResourceEventType.TurnStreamOpened,
        turn: currentTurn
      }).state
      entry.resources = resources
      const events: unknown[] = []
      manager.onApprovalRequested((event) => events.push(event))

      ;(
        manager as unknown as {
          handleRuntimeEvent: (current: typeof entry, event: AgentRuntimeEvent) => void
        }
      ).handleRuntimeEvent(entry, {
        type: AgentRuntimeEventType.ToolApprovalRequest,
        request: {
          approvalId: 'approval-live',
          toolCallId: 'tool-call-live',
          toolName: 'Bash',
          input: { command: 'pwd' },
          lifetime: AgentApprovalLifetime.ExecutionBound
        }
      })

      expect(handle.turnId).toBe(currentTurn.turnId)
      expect(enqueue).toHaveBeenCalledExactlyOnceWith({
        type: 'tool-approval-request',
        approvalId: 'approval-live',
        toolCallId: 'tool-call-live'
      })
      expect(events).toEqual([])
    })
  })

  describe('steer redirect — live input ownership', () => {
    const install = (
      manager: AgentConnectionManager,
      options: {
        open?: boolean
        headless?: boolean
        fastMode?: boolean
        knowledgeBaseIds?: string[]
        redirectResult?: AgentRuntimeRedirectReceiptKind
        boundKnowledgeBaseIds?: string[]
      } = {}
    ) => {
      vi.spyOn(agentService, 'getAgent').mockReturnValue({
        knowledgeBaseIds: options.boundKnowledgeBaseIds
      } as never)
      const handle = manager.prepareTurnResources({
        conversation: { kind: ConversationKind.Agent, id: 'session-1' },
        agentId: 'agent-1',
        agentType: 'test-runtime',
        modelId: 'provider::model',
        assistantMessageId: 'assistant-1',
        userMessage: userMessage('user-1', options.knowledgeBaseIds),
        headless: options.headless,
        fastMode: options.fastMode
      })
      const redirect = vi.fn((input: AgentRuntimeRedirectInput) => ({
        kind: options.redirectResult ?? AgentRuntimeRedirectReceiptKind.Queued,
        redirectId: input.redirectId
      }))
      const currentConnection = {
        events: neverRuntimeEvents(),
        send: vi.fn(),
        redirect,
        close: vi.fn(),
        reconcile: vi.fn().mockResolvedValue(AgentRuntimeReconcileResult.Current)
      } satisfies AgentRuntimeConnection
      const entry = (
        manager as unknown as { entries: Map<string, { modelId: string; resources: unknown }> }
      ).entries.get('session-1')!
      let resources = entry.resources as ReturnType<typeof resourceState>
      const currentTurn = getAgentCurrentStreamResource(resources)!
      if (options.open !== false) {
        resources = transitionAgentConnectionResource(resources, {
          type: AgentConnectionResourceEventType.TurnStreamOpened,
          turn: currentTurn
        }).state
      }
      resources = transitionAgentConnectionResource(resources, {
        type: AgentConnectionResourceEventType.ConnectionStarted,
        connectionAttemptId: 'connect-1'
      }).state
      resources = transitionAgentConnectionResource(resources, {
        type: AgentConnectionResourceEventType.ConnectionConnected,
        connectionAttemptId: 'connect-1',
        connection: currentConnection
      }).state
      if (options.open !== false) {
        resources = transitionAgentConnectionResource(resources, {
          type: AgentConnectionResourceEventType.TurnSentToConnection,
          turn: currentTurn
        }).state
      }
      entry.resources = resources
      return { currentConnection, currentTurn, entry, handle, redirect }
    }

    it('queues a normal live turn follow-up while its stream is unopened', () => {
      const manager = new AgentConnectionManager()
      const { redirect } = install(manager, { open: false })
      const redirectId = toAgentRuntimeRedirectId('redirect-unopened')

      expect(manager.redirectConversationInput('session-1', redirectId, userMessage('user-2'))).toEqual({
        kind: AgentRuntimeRedirectReceiptKind.Rejected,
        redirectId
      })
      expect(redirect).not.toHaveBeenCalled()
    })

    it('queues an interactive follow-up instead of steering it into a headless-owned turn', () => {
      const manager = new AgentConnectionManager()
      const { redirect } = install(manager, { headless: true })
      const redirectId = toAgentRuntimeRedirectId('redirect-headless-owner')

      expect(manager.redirectConversationInput('session-1', redirectId, userMessage('user-2'))).toEqual({
        kind: AgentRuntimeRedirectReceiptKind.Rejected,
        redirectId
      })
      expect(redirect).not.toHaveBeenCalled()
    })

    it('queues headless input instead of inheriting a live interactive turn', () => {
      const manager = new AgentConnectionManager()
      const { redirect } = install(manager)
      const redirectId = toAgentRuntimeRedirectId('redirect-headless-input')

      expect(
        manager.redirectConversationInput('session-1', redirectId, userMessage('user-2'), { headless: true })
      ).toEqual({ kind: AgentRuntimeRedirectReceiptKind.Rejected, redirectId })
      expect(redirect).not.toHaveBeenCalled()
    })

    it('queues a steer whose effective knowledge scope differs from the live turn', () => {
      const manager = new AgentConnectionManager()
      const { redirect } = install(manager, { knowledgeBaseIds: ['kb-1'] })
      const redirectId = toAgentRuntimeRedirectId('redirect-knowledge-mismatch')

      expect(manager.redirectConversationInput('session-1', redirectId, userMessage('user-2', ['kb-2']))).toEqual({
        kind: AgentRuntimeRedirectReceiptKind.Rejected,
        redirectId
      })
      expect(redirect).not.toHaveBeenCalled()
    })

    it('does not interrupt a live turn; soft-queues the steer and pushes it into the SAME warm connection on the next turn', async () => {
      const manager = new AgentConnectionManager()
      const { currentConnection, entry, handle, redirect } = install(manager, {
        knowledgeBaseIds: ['kb-1'],
        redirectResult: AgentRuntimeRedirectReceiptKind.Rejected
      })
      const followUp = userMessage('user-2', ['kb-1'])
      const redirectId = toAgentRuntimeRedirectId('redirect-runtime-rejected')

      expect(manager.redirectConversationInput('session-1', redirectId, followUp)).toEqual({
        kind: AgentRuntimeRedirectReceiptKind.Rejected,
        redirectId
      })
      expect(redirect).toHaveBeenCalledOnce()
      expect(currentConnection.close).not.toHaveBeenCalled()
      ;(
        manager as unknown as {
          handleRuntimeEvent: (current: typeof entry, event: AgentRuntimeEvent, owner: AgentRuntimeConnection) => void
        }
      ).handleRuntimeEvent(
        entry,
        { type: AgentRuntimeEventType.TurnComplete, segmentId: sourceSegmentId },
        currentConnection
      )
      manager.releaseTurnResource('session-1', AgentDriverOutcomeKind.Success, handle.turnId)

      const successor = manager.prepareTurnResources({
        conversation: { kind: ConversationKind.Agent, id: 'session-1' },
        agentId: 'agent-1',
        agentType: 'test-runtime',
        modelId: 'provider::model',
        assistantMessageId: 'assistant-2',
        userMessage: followUp
      })
      const reader = manager
        .openExecutionStream({
          conversation: { kind: ConversationKind.Agent, id: 'session-1' },
          turnId: successor.turnId,
          signal: new AbortController().signal
        })
        .getReader()

      await expect(reader.read()).resolves.toMatchObject({ done: false, value: { type: 'start' } })
      await vi.waitFor(() =>
        expect(currentConnection.send).toHaveBeenCalledWith(
          expect.objectContaining({ message: followUp, systemReminder: false })
        )
      )
      expect(currentConnection.close).not.toHaveBeenCalled()

      await manager.closeSession('session-1')
      await reader.cancel().catch(() => undefined)
    })

    it('queues a follow-up when its Fast selection differs from the live turn', () => {
      const manager = new AgentConnectionManager()
      const { redirect } = install(manager, { fastMode: true })
      const redirectId = toAgentRuntimeRedirectId('redirect-fast-mismatch')

      expect(manager.redirectConversationInput('session-1', redirectId, userMessage('user-2'))).toEqual({
        kind: AgentRuntimeRedirectReceiptKind.Rejected,
        redirectId
      })
      expect(redirect).not.toHaveBeenCalled()
    })

    it('treats a reordered knowledge scope as unchanged and still folds the steer', () => {
      const manager = new AgentConnectionManager()
      const { redirect } = install(manager, { knowledgeBaseIds: ['kb-1', 'kb-2'] })
      const followUp = userMessage('user-2', ['kb-2', 'kb-1'])
      const redirectId = toAgentRuntimeRedirectId('redirect-reordered-knowledge')

      expect(manager.redirectConversationInput('session-1', redirectId, followUp)).toEqual({
        kind: AgentRuntimeRedirectReceiptKind.Queued,
        redirectId
      })
      expect(redirect).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ redirectId, message: followUp, systemReminder: true })
      )
    })

    it('lets a static Agent binding override different composer selections for steer matching', () => {
      const manager = new AgentConnectionManager()
      const { redirect } = install(manager, {
        knowledgeBaseIds: ['kb-1'],
        boundKnowledgeBaseIds: ['kb-bound']
      })
      const followUp = userMessage('user-2', ['kb-2'])
      const redirectId = toAgentRuntimeRedirectId('redirect-bound-knowledge')

      expect(manager.redirectConversationInput('session-1', redirectId, followUp)).toEqual({
        kind: AgentRuntimeRedirectReceiptKind.Queued,
        redirectId
      })
      expect(redirect).toHaveBeenCalledOnce()
    })

    it('folds a live steer into the current turn via connection.redirect (not queued, no new turn)', () => {
      const manager = new AgentConnectionManager()
      const { currentTurn, redirect } = install(manager)
      const followUp = userMessage('user-2')
      const redirectId = toAgentRuntimeRedirectId('redirect-live')

      expect(manager.redirectConversationInput('session-1', redirectId, followUp)).toEqual({
        kind: AgentRuntimeRedirectReceiptKind.Queued,
        redirectId
      })

      expect(redirect).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ redirectId, message: followUp, systemReminder: true })
      )
      expect(
        getAgentCurrentStreamResource(
          (manager as unknown as { entries: Map<string, { resources: never }> }).entries.get('session-1')!.resources
        )
      ).toBe(currentTurn)
    })

    it('flags a mid-turn follow-up as a steer (system-reminder) while a turn is live', () => {
      const manager = new AgentConnectionManager()
      const { redirect } = install(manager)
      const followUp = userMessage('user-2')
      const redirectId = toAgentRuntimeRedirectId('redirect-reminder')

      expect(manager.redirectConversationInput('session-1', redirectId, followUp)).toEqual({
        kind: AgentRuntimeRedirectReceiptKind.Queued,
        redirectId
      })
      expect(redirect).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ redirectId, message: followUp, systemReminder: true })
      )
    })

    it('freezes a redirected steer-boundary continuation with the follow-up snapshot', () => {
      const manager = new AgentConnectionManager()
      const { currentConnection, entry, redirect } = install(manager)
      const followUp = userMessage('user-2')
      const followUpSnapshot = {
        id: 'agent-1',
        name: 'Agent after edit',
        model: { id: 'model', name: 'Model after edit', provider: 'provider' }
      }
      const redirectId = toAgentRuntimeRedirectId('redirect-snapshot-delivered')

      expect(
        manager.redirectConversationInput('session-1', redirectId, followUp, { messageSnapshot: followUpSnapshot })
      ).toEqual({ kind: AgentRuntimeRedirectReceiptKind.Queued, redirectId })
      const redirected = redirect.mock.calls[0][0]
      ;(
        manager as unknown as {
          handleRuntimeEvent: (current: typeof entry, event: AgentRuntimeEvent, owner: AgentRuntimeConnection) => void
        }
      ).handleRuntimeEvent(
        entry,
        {
          type: AgentRuntimeEventType.SteerDelivered,
          redirects: [redirected],
          sourceSegmentId: redirected.segmentId,
          successorSegmentId
        },
        currentConnection
      )

      expect(manager.describeConversationContinuation('session-1').messageSnapshot).toEqual(followUpSnapshot)
    })

    it('requeues a steer-undelivered follow-up with its enqueue-time snapshot', () => {
      const manager = new AgentConnectionManager()
      const { currentConnection, entry, redirect } = install(manager)
      const followUp = userMessage('user-2')
      const followUpSnapshot = {
        id: 'agent-1',
        name: 'Agent after edit',
        model: { id: 'model', name: 'Model after edit', provider: 'provider' }
      }
      const redirectId = toAgentRuntimeRedirectId('redirect-snapshot-undelivered')

      expect(
        manager.redirectConversationInput('session-1', redirectId, followUp, { messageSnapshot: followUpSnapshot })
      ).toEqual({ kind: AgentRuntimeRedirectReceiptKind.Queued, redirectId })
      const redirected = redirect.mock.calls[0][0]
      ;(
        manager as unknown as {
          handleRuntimeEvent: (current: typeof entry, event: AgentRuntimeEvent, owner: AgentRuntimeConnection) => void
        }
      ).handleRuntimeEvent(
        entry,
        {
          type: AgentRuntimeEventType.SteerUndelivered,
          redirectIds: [redirected.redirectId],
          sourceSegmentId: redirected.segmentId
        },
        currentConnection
      )

      expect(redirected.messageSnapshot).toEqual(followUpSnapshot)
      expect(services.conversation.enqueueAgentUndelivered).toHaveBeenCalledExactlyOnceWith('session-1', [redirectId])
    })

    it('queues follow-ups instead of redirecting them into a stale-model live connection', () => {
      const manager = new AgentConnectionManager()
      const { entry, redirect } = install(manager)
      entry.modelId = 'provider::new-model'
      const redirectId = toAgentRuntimeRedirectId('redirect-stale-model')

      expect(manager.redirectConversationInput('session-1', redirectId, userMessage('user-2'))).toEqual({
        kind: AgentRuntimeRedirectReceiptKind.Rejected,
        redirectId
      })
      expect(redirect).not.toHaveBeenCalled()
    })

    it('queues a steer the turn ended before injecting (steer-undelivered → next turn, system-reminder)', () => {
      const manager = new AgentConnectionManager()
      const { currentConnection, entry } = install(manager)
      const followUp = userMessage('user-2', ['kb-1'])
      const redirected: AgentRuntimeRedirectInput = {
        redirectId: toAgentRuntimeRedirectId('redirect-ended-before-injection'),
        segmentId: getAgentCurrentSegmentId(entry.resources as ReturnType<typeof resourceState>)!,
        message: followUp,
        systemReminder: true
      }
      entry.resources = transitionAgentConnectionResource(entry.resources as ReturnType<typeof resourceState>, {
        type: AgentConnectionResourceEventType.RedirectQueued,
        redirect: redirected
      }).state

      ;(
        manager as unknown as {
          handleRuntimeEvent: (current: typeof entry, event: AgentRuntimeEvent, owner: AgentRuntimeConnection) => void
        }
      ).handleRuntimeEvent(
        entry,
        {
          type: AgentRuntimeEventType.SteerUndelivered,
          redirectIds: [redirected.redirectId],
          sourceSegmentId: redirected.segmentId
        },
        currentConnection
      )

      expect(services.conversation.enqueueAgentUndelivered).toHaveBeenCalledExactlyOnceWith('session-1', [
        redirected.redirectId
      ])
    })
  })

  describe('warm lease ownership (multi-window)', () => {
    class FakeWebContents extends EventEmitter {
      private destroyedFlag = false

      isDestroyed(): boolean {
        return this.destroyedFlag
      }

      destroy(): void {
        this.destroyedFlag = true
        this.emit('destroyed')
      }
    }

    const createWebContents = () => new FakeWebContents()
    const asSender = (fake: FakeWebContents) => fake as unknown as Electron.WebContents

    let manager: AgentConnectionManager
    let prime: MockInstance<(sessionId: string) => Promise<void>>
    let releaseIdle: MockInstance<(sessionId: string) => void>

    beforeEach(() => {
      vi.useFakeTimers()
      manager = new AgentConnectionManager()
      prime = vi.spyOn(manager, 'primeConnection').mockResolvedValue(undefined)
      releaseIdle = vi.spyOn(manager, 'releaseIdleConnection').mockImplementation(() => undefined)
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('keeps the shared connection while another window still holds the session', () => {
      const windowA = createWebContents()
      const windowB = createWebContents()
      manager.acquireWarmLease('session-1', asSender(windowA))
      manager.acquireWarmLease('session-1', asSender(windowB))

      manager.releaseWarmLease('session-1', asSender(windowA))
      vi.runAllTimers()
      expect(services.warmQuery.closeAgentSessionWarm).not.toHaveBeenCalled()
      expect(releaseIdle).not.toHaveBeenCalled()

      manager.releaseWarmLease('session-1', asSender(windowB))
      vi.runAllTimers()
      expect(services.warmQuery.closeAgentSessionWarm).toHaveBeenCalledWith('session-1')
      expect(releaseIdle).toHaveBeenCalledWith('session-1')
    })

    it('tears down only after the full grace period with no re-acquire', () => {
      const windowA = createWebContents()
      manager.acquireWarmLease('session-1', asSender(windowA))
      manager.releaseWarmLease('session-1', asSender(windowA))

      vi.advanceTimersByTime(9_999)
      expect(releaseIdle).not.toHaveBeenCalled()

      vi.advanceTimersByTime(1)
      expect(services.warmQuery.closeAgentSessionWarm).toHaveBeenCalledWith('session-1')
      expect(releaseIdle).toHaveBeenCalledWith('session-1')
    })

    it('a re-acquire within the grace period cancels the teardown and skips the redundant prime', () => {
      const windowA = createWebContents()
      manager.acquireWarmLease('session-1', asSender(windowA))
      expect(prime).toHaveBeenCalledTimes(1)

      manager.releaseWarmLease('session-1', asSender(windowA))
      vi.advanceTimersByTime(5_000)
      manager.acquireWarmLease('session-1', asSender(windowA))

      vi.runAllTimers()
      expect(services.warmQuery.closeAgentSessionWarm).not.toHaveBeenCalled()
      expect(releaseIdle).not.toHaveBeenCalled()
      expect(prime).toHaveBeenCalledTimes(1)
    })

    it('re-primes when a second window acquires so the catalog is republished for it', () => {
      const windowA = createWebContents()
      const windowB = createWebContents()
      manager.acquireWarmLease('session-1', asSender(windowA))
      manager.acquireWarmLease('session-1', asSender(windowB))

      expect(prime).toHaveBeenCalledTimes(2)
    })

    it('reaps a destroyed window without a renderer release, deferring to remaining holders', () => {
      const windowA = createWebContents()
      const windowB = createWebContents()
      manager.acquireWarmLease('session-1', asSender(windowA))
      manager.acquireWarmLease('session-1', asSender(windowB))

      windowA.destroy()
      vi.runAllTimers()
      expect(releaseIdle).not.toHaveBeenCalled()

      windowB.destroy()
      vi.runAllTimers()
      expect(services.warmQuery.closeAgentSessionWarm).toHaveBeenCalledWith('session-1')
      expect(releaseIdle).toHaveBeenCalledWith('session-1')
    })

    it('a destroyed window releases every session it held', () => {
      const windowA = createWebContents()
      manager.acquireWarmLease('session-1', asSender(windowA))
      manager.acquireWarmLease('session-2', asSender(windowA))

      windowA.destroy()
      vi.runAllTimers()
      expect(releaseIdle).toHaveBeenCalledWith('session-1')
      expect(releaseIdle).toHaveBeenCalledWith('session-2')
    })

    it('an unmanaged sender primes without a lease and its release defers to managed holders', () => {
      const windowA = createWebContents()
      manager.acquireWarmLease('session-1', asSender(windowA))
      manager.acquireWarmLease('session-1', undefined)
      expect(prime).toHaveBeenCalledTimes(2)

      manager.releaseWarmLease('session-1', undefined)
      vi.runAllTimers()
      expect(releaseIdle).not.toHaveBeenCalled()
    })
  })
})
