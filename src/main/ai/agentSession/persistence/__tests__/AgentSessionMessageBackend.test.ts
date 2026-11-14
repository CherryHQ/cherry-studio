import { setupTestDatabase } from '@test-helpers/db'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { agentSessionTable } from '@data/db/schemas/agentSession'
import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import { agentSessionMessageService } from '@data/services/AgentSessionMessageService'

import { PersistenceListener, TerminalPersistenceError } from '../../../streamManager/listeners/PersistenceListener'
import type { StreamDoneResult } from '../../../streamManager/types'
import { AgentSessionMessageBackend } from '../AgentSessionMessageBackend'

const sessionId = 'session-1'
const assistantMessageId = '018f6ed6-73b8-7f40-8d0d-9bb2f8f1d002'

/** The durable retry marker a runtime enqueues on the live stream; persistence keeps it as history. */
const apiRetryPart = {
  type: 'data-agent-api-retry',
  id: 'agent-api-retry-assistant-1',
  data: { attempt: 7, maxRetries: 10, retryDelayMs: 36_000, errorStatus: 500, startedAt: '2026-01-01T00:00:00.000Z' }
} as never

describe('AgentSessionMessageBackend', () => {
  const dbh = setupTestDatabase()

  beforeEach(() => {
    dbh.db
      .insert(agentWorkspaceTable)
      .values({ id: 'workspace-1', name: 'Workspace', path: '/tmp/workspace', type: 'user', orderKey: 'a0' })
      .run()
    dbh.db
      .insert(agentSessionTable)
      .values({ id: sessionId, workspaceId: 'workspace-1', name: 'Session', orderKey: 'a0' })
      .run()
    agentSessionMessageService.saveMessage({
      sessionId,
      message: { id: assistantMessageId, role: 'assistant', status: 'pending', data: { parts: [] } }
    })
  })
  afterEach(() => vi.restoreAllMocks())

  it('terminalizes its placeholder when the persistence listener catches a write failure', async () => {
    vi.spyOn(agentSessionMessageService, 'saveMessage').mockImplementationOnce(() => {
      throw new Error('write failed')
    })
    const backend = new AgentSessionMessageBackend({ sessionId, assistantMessageId })
    const listener = new PersistenceListener({ topicId: 'agent-session:session-1', backend, onPersistFailed: vi.fn() })
    await expect(
      listener.onDone({ status: 'success', finalMessage: { id: assistantMessageId, role: 'assistant', parts: [] } })
    ).rejects.toBeInstanceOf(TerminalPersistenceError)
    expect(agentSessionMessageService.getSessionMessage(sessionId, assistantMessageId).status).toBe('error')
  })

  it('downgrades an empty successful reply and skips the success hook', async () => {
    const afterPersist = vi.fn().mockResolvedValue(undefined)
    const backend = new AgentSessionMessageBackend({ sessionId, assistantMessageId, afterPersist })
    const listener = new PersistenceListener({ topicId: 'agent-session:session-1', backend, onPersistFailed: vi.fn() })
    await listener.onDone({ status: 'success', finalMessage: undefined })
    const saved = agentSessionMessageService.getSessionMessage(sessionId, assistantMessageId)
    expect(saved.status).toBe('error')
    expect(saved.data.parts).toContainEqual(expect.objectContaining({ type: 'data-error' }))
    expect(afterPersist).not.toHaveBeenCalled()
  })

  it('runs the success hook for a reply that has a visible part', async () => {
    // The negative case above also holds when `persistedSuccess` never gets set at all, so only
    // this direction proves the assignment actually runs.
    const afterPersist = vi.fn().mockResolvedValue(undefined)
    const backend = new AgentSessionMessageBackend({ sessionId, assistantMessageId, afterPersist })
    const listener = new PersistenceListener({ topicId: 'agent-session:session-1', backend, onPersistFailed: vi.fn() })
    await listener.onDone({
      status: 'success',
      finalMessage: {
        id: assistantMessageId,
        role: 'assistant',
        parts: [{ type: 'step-start' }, { type: 'text', text: 'done' }]
      } as never
    })

    expect(afterPersist).toHaveBeenCalledWith(expect.objectContaining({ id: assistantMessageId }))
  })

  it('keeps an empty paused turn paused and persists a visible resume hint', async () => {
    const backend = new AgentSessionMessageBackend({ sessionId, assistantMessageId })
    const listener = new PersistenceListener({ topicId: 'agent-session:session-1', backend, onPersistFailed: vi.fn() })
    await listener.onPaused({ status: 'paused', finalMessage: undefined })
    expect(agentSessionMessageService.getSessionMessage(sessionId, assistantMessageId)).toMatchObject({
      status: 'paused',
      data: { parts: [{ type: 'data-agent-paused', data: {} }] }
    })
  })

  it('hands terminal dispatch an error view of a downgraded success', async () => {
    // Half a fix is storage alone: the row is written as `error`, but dispatch still published
    // `onDone`, so subscribers (journal, task sentinel, runtime) reported a completed turn for one
    // the database classifies as failed.
    const backend = new AgentSessionMessageBackend({ sessionId, assistantMessageId })
    const listener = new PersistenceListener({ topicId: 'agent-session:session-1', backend, onPersistFailed: vi.fn() })
    const done: StreamDoneResult = { status: 'success', finalMessage: undefined }
    await listener.onDone(done)

    expect(agentSessionMessageService.getSessionMessage(sessionId, assistantMessageId).status).toBe('error')
    expect(done.persistence).toHaveProperty('downgradedToError', true)
    expect(done.downgradedTo?.error).toMatchObject({ name: 'AgentRuntimeError' })
  })

  it('hands terminal dispatch an error view of a retry-only turn', async () => {
    // The durable `data-agent-api-retry` survives persistence filtering but is excluded from answer
    // visibility, so a clean SDK success lands here and must not read as success downstream.
    const backend = new AgentSessionMessageBackend({ sessionId, assistantMessageId })
    const listener = new PersistenceListener({ topicId: 'agent-session:session-1', backend, onPersistFailed: vi.fn() })
    const done: StreamDoneResult = {
      status: 'success',
      finalMessage: { id: assistantMessageId, role: 'assistant', parts: [apiRetryPart] }
    }
    await listener.onDone(done)

    const saved = agentSessionMessageService.getSessionMessage(sessionId, assistantMessageId)
    expect(saved.status).toBe('error')
    // The retry marker survives as history — the downgrade is about classification, not erasure.
    expect(saved.data.parts).toContainEqual(apiRetryPart)
    expect(done.persistence).toHaveProperty('downgradedToError', true)
    expect(done.downgradedTo?.error).toMatchObject({ name: 'AgentRuntimeError' })
  })

  it('downgrades hidden-only success to a terminal error', async () => {
    const backend = new AgentSessionMessageBackend({ sessionId, assistantMessageId })
    const listener = new PersistenceListener({ topicId: 'agent-session:session-1', backend, onPersistFailed: vi.fn() })
    await listener.onDone({
      status: 'success',
      finalMessage: {
        id: assistantMessageId,
        role: 'assistant',
        parts: [{ type: 'step-start' }, { type: 'text', text: '   ' }]
      } as never
    })
    const saved = agentSessionMessageService.getSessionMessage(sessionId, assistantMessageId)
    expect(saved.status).toBe('error')
    expect(saved.data.parts).toContainEqual(expect.objectContaining({ type: 'data-error' }))
  })

  it('downgrades a success turn whose only content is a cardless dynamic provider tool', async () => {
    // Claude Code emits native tools (EnterPlanMode) as dynamic provider calls
    // (`dynamic: true`, `providerExecuted: true`, `cherry.tool.type: 'provider'`) that
    // chooseTool gives no card — the turn succeeded but renders nothing without the downgrade.
    const afterPersist = vi.fn().mockResolvedValue(undefined)
    const backend = new AgentSessionMessageBackend({ sessionId, assistantMessageId, afterPersist })
    const listener = new PersistenceListener({ topicId: 'agent-session:session-1', backend, onPersistFailed: vi.fn() })
    await listener.onDone({
      status: 'success',
      finalMessage: {
        id: assistantMessageId,
        role: 'assistant',
        parts: [
          { type: 'step-start' },
          {
            type: 'dynamic-tool',
            toolCallId: 'toolu_01-plan',
            toolName: 'EnterPlanMode',
            state: 'output-available',
            input: {},
            output: 'Plan mode entered',
            providerExecuted: true,
            callProviderMetadata: {
              cherry: { transport: 'claude-agent', tool: { type: 'provider', name: 'EnterPlanMode' } }
            }
          }
        ]
      } as never
    })
    const saved = agentSessionMessageService.getSessionMessage(sessionId, assistantMessageId)
    expect(saved.status).toBe('error')
    expect(saved.data.parts).toContainEqual(expect.objectContaining({ type: 'data-error' }))
    expect(afterPersist).not.toHaveBeenCalled()
  })

  it('keeps a success turn whose dynamic MCP tool renders a card', async () => {
    const afterPersist = vi.fn().mockResolvedValue(undefined)
    const backend = new AgentSessionMessageBackend({ sessionId, assistantMessageId, afterPersist })
    const listener = new PersistenceListener({ topicId: 'agent-session:session-1', backend, onPersistFailed: vi.fn() })
    await listener.onDone({
      status: 'success',
      finalMessage: {
        id: assistantMessageId,
        role: 'assistant',
        parts: [
          { type: 'step-start' },
          {
            type: 'dynamic-tool',
            toolCallId: 'toolu_01-mcp',
            toolName: 'mcp__cherry-tools__web_fetch',
            state: 'output-available',
            input: { url: 'https://example.com' },
            output: 'content',
            providerExecuted: true,
            callProviderMetadata: {
              cherry: { transport: 'claude-agent', tool: { type: 'mcp', serverId: 'cherry-tools' } }
            }
          }
        ]
      } as never
    })
    expect(agentSessionMessageService.getSessionMessage(sessionId, assistantMessageId).status).toBe('success')
    expect(afterPersist).toHaveBeenCalledWith(expect.objectContaining({ id: assistantMessageId }))
  })

  it('keeps a Pi builtin-only completion successful because the renderer cards it', () => {
    const backend = new AgentSessionMessageBackend({ sessionId, assistantMessageId })
    // Production Pi parts are dynamic, provider-executed, and stamped
    // `cherry.transport='pi-agent'` + `cherry.tool.type='builtin'` (piStreamAdapter). The renderer
    // recognizes Pi's builtin names before that metadata, so `vcc_recall` renders a timeline card:
    // the turn has visible content and must not be downgraded to an error.
    const parts = [
      {
        type: 'dynamic-tool',
        toolCallId: 'toolu_01-recall',
        toolName: 'vcc_recall',
        state: 'output-available',
        input: { query: 'earlier plan' },
        output: 'Earlier conversation turns',
        providerExecuted: true,
        callProviderMetadata: {
          cherry: { transport: 'pi-agent', tool: { type: 'builtin', name: 'vcc_recall' } },
          pi: { toolName: 'vcc_recall' }
        }
      }
    ] as never
    expect(backend.persistAssistant({ finalMessage: { parts } as never, status: 'success' })).not.toHaveProperty(
      'downgradedToError'
    )
  })

  it('persists an unknown runtime checkpoint intact without exposing it in public messages', async () => {
    const anchor = {
      checkpoint: { runtime: 'future-runtime', native: { cursor: [7, 'entry'], version: 2 }, token: 'opaque-token' }
    }
    const backend = new AgentSessionMessageBackend({ sessionId, assistantMessageId, forkAnchor: () => anchor })
    const listener = new PersistenceListener({ topicId: 'agent-session:session-1', backend, onPersistFailed: vi.fn() })
    await listener.onDone({
      status: 'success',
      finalMessage: { id: assistantMessageId, role: 'assistant', parts: [{ type: 'text', text: 'Completed answer' }] }
    })
    const raw = agentSessionMessageService.readForkPrefixTx(dbh.db, sessionId, assistantMessageId)![0]
    expect(raw.data.runtimeAnchor).toEqual(anchor)
    expect(agentSessionMessageService.getSessionMessage(sessionId, assistantMessageId).data).not.toHaveProperty(
      'runtimeAnchor'
    )
  })

  it.each(['valid', 'invalid', 'write-failure'] as const)(
    'preserves the completed answer while validating its checkpoint envelope: %s',
    async (scenario) => {
      if (scenario === 'write-failure')
        vi.spyOn(agentSessionMessageService, 'saveMessage').mockImplementationOnce(() => {
          throw new Error('checkpoint write failed')
        })
      const anchor = { checkpoint: { runtime: 'pi', runtimeSessionId: 'native-1', leafId: 'leaf-1' } } as const
      const backend = new AgentSessionMessageBackend({
        sessionId,
        assistantMessageId,
        forkAnchor: () => (scenario === 'invalid' ? { checkpoint: { runtime: '' } } : anchor)
      })
      const listener = new PersistenceListener({
        topicId: 'agent-session:session-1',
        backend,
        onPersistFailed: vi.fn()
      })
      const parts = [{ type: 'text' as const, text: 'Completed answer' }]
      await listener.onDone({ status: 'success', finalMessage: { id: assistantMessageId, role: 'assistant', parts } })
      const saved = agentSessionMessageService.getSessionMessage(sessionId, assistantMessageId)
      expect(saved).toMatchObject({ status: 'success', data: { parts } })
      expect(saved.data).not.toHaveProperty('runtimeAnchor')
      const raw = agentSessionMessageService.readForkPrefixTx(dbh.db, sessionId, assistantMessageId)![0]
      expect(raw.data.runtimeAnchor).toEqual(scenario === 'valid' ? anchor : undefined)
    }
  )
})
