/**
 * Plan-approval model handoff must settle the approved plan tool in the persistence path before
 * the teardown closes the turn. The approval dispatch resolves the runtime's permission
 * continuation asynchronously; pausing the turn first shuts the stream before its successful tool
 * result reaches the accumulator, so `finalizeInterruptedParts` saves the approved plan as
 * `output-error` "Interrupted by user" and reloaded application history displays an error.
 *
 * Real path under test: runtime turn stream → AiStreamManager's `readUIMessageStream` accumulator →
 * PersistenceListener → AgentSessionMessageBackend → agentSessionMessageService (SQLite). Only the
 * runtime connection is faked.
 */

import { setupTestDatabase } from '@test-helpers/db'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { agentTable } from '@data/db/schemas/agent'
import { agentSessionTable } from '@data/db/schemas/agentSession'
import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import { userModelTable } from '@data/db/schemas/userModel'
import { userProviderTable } from '@data/db/schemas/userProvider'
import { agentSessionMessageService } from '@data/services/AgentSessionMessageService'
import { AgentSessionRuntimeService } from '@main/ai/agentSession/AgentSessionRuntimeService'
import { runtimeDriverRegistry } from '@main/ai/runtime/registry'
import { AiStreamManager } from '@main/ai/streamManager'
import { toolApprovalRegistry } from '@main/ai/toolApproval/ToolApprovalRegistry'
import { BaseService } from '@main/core/lifecycle/BaseService'
import type { UniqueModelId } from '@shared/data/types/model'

import { buildAgentSessionTopicId } from '../topic'

const serviceRefs = vi.hoisted(() => ({
  instances: {} as Record<string, unknown>
}))

vi.mock('@main/services/TopicNamingService', () => ({
  topicNamingService: {
    maybeRenameAgentSession: vi.fn(),
    inFlightWrites: () => new Map<string, Promise<void>>()
  }
}))

vi.mock('@application', async () => {
  const { createMockApplication } = await import('@test-mocks/main/application')
  const base = createMockApplication()
  const override = (name: string) => (name in serviceRefs.instances ? serviceRefs.instances[name] : base.get(name))
  return {
    application: {
      ...base,
      get: override,
      getOptional: (name: string) =>
        name in serviceRefs.instances ? serviceRefs.instances[name] : base.getOptional(name),
      getExisting: (name: string) =>
        name in serviceRefs.instances ? serviceRefs.instances[name] : base.getExisting(name)
    },
    serviceList: []
  }
})

const AGENT_ID = 'agent-plan-handoff-persistence'
const WORKSPACE_ID = 'workspace-plan-handoff-persistence'
const SESSION_ID = 'session-plan-handoff-persistence'
const TOPIC_ID = buildAgentSessionTopicId(SESSION_ID)
const USER_MESSAGE_ID = '018f6ed6-73b8-7f40-8d0d-9bb2f8f1d200'
const ASSISTANT_MESSAGE_ID = '018f6ed6-73b8-7f40-8d0d-9bb2f8f1d201'
const APPROVAL_ID = 'approval-plan-handoff-persistence'
const TOOL_CALL_ID = 'tool-call-plan-handoff-persistence'
const MODEL_A: UniqueModelId = 'test-runtime::model-a'
const MODEL_B: UniqueModelId = 'test-runtime::model-b'
const PROVIDER_ID = 'test-runtime'

function createAsyncQueue<T>() {
  const items: T[] = []
  const waiters: Array<(value: IteratorResult<T>) => void> = []

  return {
    push(item: T) {
      const waiter = waiters.shift()
      if (waiter) waiter({ value: item, done: false })
      else items.push(item)
    },
    iterable: {
      [Symbol.asyncIterator](): AsyncIterator<T> {
        return {
          next: () => {
            const item = items.shift()
            if (item) return Promise.resolve({ value: item, done: false })
            return new Promise<IteratorResult<T>>((resolve) => waiters.push(resolve))
          }
        }
      }
    }
  }
}

describe('Plan-approval model handoff persistence', () => {
  const dbh = setupTestDatabase()

  beforeEach(async () => {
    BaseService.resetInstances()
    runtimeDriverRegistry.clearForTest()
    toolApprovalRegistry.clear('test-reset')
    vi.clearAllMocks()

    await dbh.db.insert(userProviderTable).values({
      providerId: PROVIDER_ID,
      name: 'Test Runtime',
      orderKey: 'a0'
    })
    for (const [id, modelId] of [
      [MODEL_A, 'model-a'],
      [MODEL_B, 'model-b']
    ] as const) {
      await dbh.db.insert(userModelTable).values({
        id,
        providerId: PROVIDER_ID,
        modelId,
        name: modelId,
        capabilities: [],
        supportsStreaming: true,
        isEnabled: true,
        isHidden: false,
        orderKey: 'a0'
      })
    }
    await dbh.db.insert(agentTable).values({
      id: AGENT_ID,
      type: 'test-runtime',
      name: 'Plan handoff persistence Agent',
      instructions: 'Test instructions',
      model: MODEL_A,
      orderKey: 'a0'
    })
    await dbh.db.insert(agentWorkspaceTable).values({
      id: WORKSPACE_ID,
      name: 'Plan handoff persistence workspace',
      path: '/tmp/plan-handoff-persistence-workspace',
      type: 'user',
      orderKey: 'a0'
    })
    await dbh.db.insert(agentSessionTable).values({
      id: SESSION_ID,
      agentId: AGENT_ID,
      name: 'Plan handoff persistence Session',
      workspaceId: WORKSPACE_ID,
      orderKey: 'a0'
    })
    agentSessionMessageService.saveMessage({
      sessionId: SESSION_ID,
      message: {
        id: ASSISTANT_MESSAGE_ID,
        role: 'assistant',
        status: 'pending',
        data: { parts: [] },
        modelId: MODEL_A
      }
    })
  })

  it('persists the approved plan tool result instead of an interruption when the turn stops for the handoff', async () => {
    const events = createAsyncQueue<Record<string, unknown>>()
    const connection = {
      events: events.iterable,
      send: vi.fn(),
      close: vi.fn(),
      reconcile: vi.fn().mockResolvedValue('current')
    }
    runtimeDriverRegistry.register({
      type: 'test-runtime',
      capabilities: ['agent-session'],
      connect: vi.fn().mockResolvedValue(connection),
      validateSession: vi.fn(),
      listAvailableTools: vi.fn().mockResolvedValue([])
    })

    const service = new AgentSessionRuntimeService()
    const manager = new AiStreamManager()
    serviceRefs.instances = {
      AiStreamManager: manager,
      AgentSessionRuntimeService: service,
      // Mirrors `AiService.streamText`'s agent-session branch (the production pass-through).
      AiService: {
        streamText: async (request: {
          runtime: { sessionId: string; turnId: string }
          requestOptions: { signal: AbortSignal }
        }) =>
          service.openTurnStream({
            sessionId: request.runtime.sessionId,
            turnId: request.runtime.turnId,
            signal: request.requestOptions.signal
          })
      },
      ClaudeCodeWarmQueryManager: {
        closeAll: vi.fn().mockResolvedValue(undefined),
        closeAgentSessionWarm: vi.fn().mockResolvedValue(undefined)
      },
      AnalyticsService: { trackTokenUsage: vi.fn() }
    }

    const handle = service.beginTurn({
      sessionId: SESSION_ID,
      topicId: TOPIC_ID,
      agentId: AGENT_ID,
      agentType: 'test-runtime',
      modelId: MODEL_A,
      assistantMessageId: ASSISTANT_MESSAGE_ID,
      userMessage: {
        id: USER_MESSAGE_ID,
        role: 'user',
        data: { parts: [{ type: 'text', text: 'make a plan' }] },
        status: 'success',
        modelId: null,
        messageSnapshot: null,
        createdAt: '',
        updatedAt: ''
      } as any
    })
    manager.startRuntimeTurn({
      topicId: TOPIC_ID,
      modelId: MODEL_A,
      request: {
        conversation: { id: SESSION_ID, topicId: TOPIC_ID },
        trigger: 'submit-message',
        messageId: ASSISTANT_MESSAGE_ID,
        messages: [
          { id: USER_MESSAGE_ID, role: 'user', parts: [{ type: 'text', text: 'make a plan' }] },
          { id: ASSISTANT_MESSAGE_ID, role: 'assistant', parts: [] }
        ],
        runtime: { kind: 'agent-session', sessionId: SESSION_ID, turnId: handle.turnId }
      },
      abortController: handle.abortController,
      listeners: handle.listeners
    })

    const seenChunks: Array<{ type?: string }> = []
    manager.addListener(TOPIC_ID, {
      id: 'test-probe',
      onChunk: (chunk: { type?: string }) => seenChunks.push(chunk),
      onDone: vi.fn(),
      onPaused: vi.fn(),
      onError: vi.fn(),
      isAlive: () => true
    })

    // The runtime's plan tool pauses on an approval card.
    events.push({
      type: 'chunk',
      chunk: {
        type: 'tool-input-available',
        toolCallId: TOOL_CALL_ID,
        toolName: 'exit_plan_mode',
        input: { plan: '# Plan' }
      }
    })
    events.push({
      type: 'tool-approval-request',
      request: {
        approvalId: APPROVAL_ID,
        toolCallId: TOOL_CALL_ID,
        toolName: 'exit_plan_mode',
        input: { plan: '# Plan' },
        presentation: 'stream'
      }
    })
    toolApprovalRegistry.register({
      approvalId: APPROVAL_ID,
      sessionId: SESSION_ID,
      toolCallId: TOOL_CALL_ID,
      toolName: 'exit_plan_mode',
      originalInput: { plan: '# Plan' },
      presentation: 'stream',
      resolve: vi.fn()
    })
    await vi.waitFor(() => expect(seenChunks.some((chunk) => chunk.type === 'tool-approval-request')).toBe(true))

    // The user approves the plan on a different execution model: Main resolves the plan as
    // approved and stops the turn so the renderer can restart execution on the chosen model.
    const result = service.respondToolApproval(APPROVAL_ID, { approved: true }, undefined, {
      executionModelId: MODEL_B
    })
    expect(result).toEqual({ dispatched: true, handoff: 'started' })

    // The dispatch resolved the runtime's permission continuation, so the plan tool's successful
    // result is on its way to the persistence accumulator as the teardown begins.
    events.push({
      type: 'chunk',
      chunk: { type: 'tool-output-available', toolCallId: TOOL_CALL_ID, output: 'Plan approved' }
    })

    await vi.waitFor(() => {
      expect(agentSessionMessageService.getSessionMessage(SESSION_ID, ASSISTANT_MESSAGE_ID).status).not.toBe('pending')
    })
    const message = agentSessionMessageService.getSessionMessage(SESSION_ID, ASSISTANT_MESSAGE_ID)
    expect(message.status).toBe('paused')
    const planPart = (message.data.parts ?? []).find(
      (part) => (part as { toolCallId?: string }).toolCallId === TOOL_CALL_ID
    )
    expect(planPart).toBeDefined()
    // The approved plan must reload as the successful tool result it was — not as an error.
    expect(planPart).toMatchObject({ state: 'output-available', output: 'Plan approved' })
    expect(planPart).not.toMatchObject({ state: 'output-error', errorText: 'Interrupted by user' })
  })
})
