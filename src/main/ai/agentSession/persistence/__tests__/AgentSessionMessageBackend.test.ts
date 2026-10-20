import { setupTestDatabase } from '@test-helpers/db'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { agentSessionTable } from '@data/db/schemas/agentSession'
import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import { agentSessionMessageService } from '@data/services/AgentSessionMessageService'

import { PersistenceListener, TerminalPersistenceError } from '../../../streamManager/listeners/PersistenceListener'
import { AgentSessionMessageBackend } from '../AgentSessionMessageBackend'

const sessionId = 'session-1'
const assistantMessageId = '018f6ed6-73b8-7f40-8d0d-9bb2f8f1d002'

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

  it('terminalizes an empty successful Agent reply on its reserved placeholder', async () => {
    const backend = new AgentSessionMessageBackend({ sessionId, assistantMessageId })
    const listener = new PersistenceListener({ topicId: 'agent-session:session-1', backend, onPersistFailed: vi.fn() })
    await listener.onDone({ status: 'success', finalMessage: undefined })
    expect(agentSessionMessageService.getSessionMessage(sessionId, assistantMessageId)).toMatchObject({
      status: 'success',
      data: { parts: [] }
    })
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
