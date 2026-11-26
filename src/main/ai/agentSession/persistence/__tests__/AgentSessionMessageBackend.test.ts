import { setupTestDatabase } from '@test-helpers/db'
import { asc, eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { agentSessionTable } from '@data/db/schemas/agentSession'
import { agentSessionMessagePartTable } from '@data/db/schemas/agentSessionMessage'
import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import { agentSessionMessageService } from '@data/services/AgentSessionMessageService'
import { prepareClaudeBranch } from '@main/ai/runtime/claudeCode/claudeContext'
import { createClearContextPart } from '@shared/data/types/uiParts'

import { PersistenceListener, TerminalPersistenceError } from '../../../streamManager/listeners/PersistenceListener'
import { markLocalInput, prepareNativeSubmission } from '../../nativeSubmission'
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

  it('persists createClearContextPart for an empty successful reply to a locally handled input', async () => {
    const context = prepareClaudeBranch(sessionId, '/tmp/claude')
    const user = agentSessionMessageService.saveMessage({
      sessionId,
      message: { role: 'user', status: 'success', data: { parts: [{ type: 'text', text: '/clear' }] } }
    })
    const reply = agentSessionMessageService.saveMessage({
      sessionId,
      parentId: user.id,
      message: { role: 'assistant', status: 'pending', data: { parts: [] } }
    })
    agentSessionMessageService.linkReply(sessionId, [user.id], reply.id)
    prepareNativeSubmission(sessionId, user.id, context.id, 'follow-up')
    markLocalInput(sessionId, context.id, user.id)

    const backend = new AgentSessionMessageBackend({
      sessionId,
      assistantMessageId: reply.id,
      partPlacement: () => ({ partIds: [], positions: new Map() })
    })
    const listener = new PersistenceListener({ topicId: 'agent-session:session-1', backend, onPersistFailed: vi.fn() })
    await listener.onDone({ status: 'success', finalMessage: { id: reply.id, role: 'assistant', parts: [] } })

    expect(agentSessionMessageService.getSessionMessage(sessionId, reply.id)).toMatchObject({
      status: 'success',
      data: { parts: [createClearContextPart()] }
    })
  })

  it('appends createClearContextPart after hidden parts without duplicating an existing boundary', async () => {
    const context = prepareClaudeBranch(sessionId, '/tmp/claude')
    const user = agentSessionMessageService.saveMessage({
      sessionId,
      message: { role: 'user', status: 'success', data: { parts: [{ type: 'text', text: '/clear' }] } }
    })
    const reply = agentSessionMessageService.saveMessage({
      sessionId,
      parentId: user.id,
      message: { role: 'assistant', status: 'pending', data: { parts: [] } }
    })
    agentSessionMessageService.linkReply(sessionId, [user.id], reply.id)
    prepareNativeSubmission(sessionId, user.id, context.id, 'follow-up')
    markLocalInput(sessionId, context.id, user.id)

    const backend = new AgentSessionMessageBackend({
      sessionId,
      assistantMessageId: reply.id,
      partPlacement: () => ({ partIds: ['step-part-1'], positions: new Map() })
    })
    backend.persistAssistant({
      status: 'success',
      finalMessage: { id: reply.id, role: 'assistant', parts: [{ type: 'step-start' }] }
    })
    expect(agentSessionMessageService.getSessionMessage(sessionId, reply.id).data.parts).toEqual([
      { type: 'step-start' },
      createClearContextPart()
    ])

    backend.persistAssistant({
      status: 'success',
      finalMessage: {
        id: reply.id,
        role: 'assistant',
        parts: [{ type: 'step-start' }, createClearContextPart()]
      }
    })
    expect(agentSessionMessageService.getSessionMessage(sessionId, reply.id).data.parts).toEqual([
      { type: 'step-start' },
      createClearContextPart()
    ])
  })

  it('supports unlinked fallback when assistant parentId is a locally handled user input', () => {
    const context = prepareClaudeBranch(sessionId, '/tmp/claude')
    const user = agentSessionMessageService.saveMessage({
      sessionId,
      message: { role: 'user', status: 'success', data: { parts: [{ type: 'text', text: '/clear' }] } }
    })
    const reply = agentSessionMessageService.saveMessage({
      sessionId,
      parentId: user.id,
      message: { role: 'assistant', status: 'pending', data: { parts: [] } }
    })
    prepareNativeSubmission(sessionId, user.id, context.id, 'follow-up')
    markLocalInput(sessionId, context.id, user.id)

    const backend = new AgentSessionMessageBackend({ sessionId, assistantMessageId: reply.id })
    backend.persistAssistant({ status: 'success', finalMessage: undefined })

    expect(agentSessionMessageService.getSessionMessage(sessionId, reply.id)).toMatchObject({
      status: 'success',
      data: { parts: [createClearContextPart()] }
    })
  })

  it('preserves visible output, non-locally-handled slash text, mixed inputs, and non-success statuses', () => {
    const context = prepareClaudeBranch(sessionId, '/tmp/claude')

    const localVisibleUser = agentSessionMessageService.saveMessage({
      sessionId,
      message: { role: 'user', status: 'success', data: { parts: [{ type: 'text', text: '/goal' }] } }
    })
    const localVisibleReply = agentSessionMessageService.saveMessage({
      sessionId,
      parentId: localVisibleUser.id,
      message: { role: 'assistant', status: 'pending', data: { parts: [] } }
    })
    agentSessionMessageService.linkReply(sessionId, [localVisibleUser.id], localVisibleReply.id)
    prepareNativeSubmission(sessionId, localVisibleUser.id, context.id, 'follow-up')
    markLocalInput(sessionId, context.id, localVisibleUser.id)
    new AgentSessionMessageBackend({ sessionId, assistantMessageId: localVisibleReply.id }).persistAssistant({
      status: 'success',
      finalMessage: { id: localVisibleReply.id, role: 'assistant', parts: [{ type: 'text', text: 'No goal is set.' }] }
    })
    expect(agentSessionMessageService.getSessionMessage(sessionId, localVisibleReply.id).data.parts).toEqual([
      { type: 'text', text: 'No goal is set.' }
    ])

    const nonLocalSlashUser = agentSessionMessageService.saveMessage({
      sessionId,
      message: { role: 'user', status: 'success', data: { parts: [{ type: 'text', text: '/clear' }] } }
    })
    const nonLocalSlashReply = agentSessionMessageService.saveMessage({
      sessionId,
      parentId: nonLocalSlashUser.id,
      message: { role: 'assistant', status: 'pending', data: { parts: [] } }
    })
    agentSessionMessageService.linkReply(sessionId, [nonLocalSlashUser.id], nonLocalSlashReply.id)
    prepareNativeSubmission(sessionId, nonLocalSlashUser.id, context.id, 'follow-up')
    new AgentSessionMessageBackend({ sessionId, assistantMessageId: nonLocalSlashReply.id }).persistAssistant({
      status: 'success',
      finalMessage: { id: nonLocalSlashReply.id, role: 'assistant', parts: [] }
    })
    expect(agentSessionMessageService.getSessionMessage(sessionId, nonLocalSlashReply.id).data.parts).toEqual([])

    const normalUser = agentSessionMessageService.saveMessage({
      sessionId,
      message: { role: 'user', status: 'success', data: { parts: [{ type: 'text', text: 'Hello' }] } }
    })
    const mixedLocalUser = agentSessionMessageService.saveMessage({
      sessionId,
      message: { role: 'user', status: 'success', data: { parts: [{ type: 'text', text: '/clear' }] } }
    })
    const mixedReply = agentSessionMessageService.saveMessage({
      sessionId,
      parentId: normalUser.id,
      message: { role: 'assistant', status: 'pending', data: { parts: [] } }
    })
    agentSessionMessageService.linkReply(sessionId, [normalUser.id, mixedLocalUser.id], mixedReply.id)
    prepareNativeSubmission(sessionId, mixedLocalUser.id, context.id, 'follow-up')
    markLocalInput(sessionId, context.id, mixedLocalUser.id)
    new AgentSessionMessageBackend({ sessionId, assistantMessageId: mixedReply.id }).persistAssistant({
      status: 'success',
      finalMessage: { id: mixedReply.id, role: 'assistant', parts: [] }
    })
    expect(agentSessionMessageService.getSessionMessage(sessionId, mixedReply.id).data.parts).toEqual([])

    for (const terminalStatus of ['error', 'paused'] as const) {
      const localUser = agentSessionMessageService.saveMessage({
        sessionId,
        message: { role: 'user', status: 'success', data: { parts: [{ type: 'text', text: '/clear' }] } }
      })
      const terminalReply = agentSessionMessageService.saveMessage({
        sessionId,
        parentId: localUser.id,
        message: { role: 'assistant', status: 'pending', data: { parts: [] } }
      })
      agentSessionMessageService.linkReply(sessionId, [localUser.id], terminalReply.id)
      prepareNativeSubmission(sessionId, localUser.id, context.id, 'follow-up')
      markLocalInput(sessionId, context.id, localUser.id)
      new AgentSessionMessageBackend({ sessionId, assistantMessageId: terminalReply.id }).persistAssistant({
        status: terminalStatus,
        finalMessage: { id: terminalReply.id, role: 'assistant', parts: [] }
      })
      expect(agentSessionMessageService.getSessionMessage(sessionId, terminalReply.id)).toMatchObject({
        status: terminalStatus,
        data: { parts: [] }
      })
    }
  })

  it('persists finalMessage.partIds when a boundary is appended without partPlacement and ignores mismatched ids', () => {
    const context = prepareClaudeBranch(sessionId, '/tmp/claude')
    const user = agentSessionMessageService.saveMessage({
      sessionId,
      message: { role: 'user', status: 'success', data: { parts: [{ type: 'text', text: '/clear' }] } }
    })
    const reply = agentSessionMessageService.saveMessage({
      sessionId,
      parentId: user.id,
      message: { role: 'assistant', status: 'pending', data: { parts: [] } }
    })
    agentSessionMessageService.linkReply(sessionId, [user.id], reply.id)
    prepareNativeSubmission(sessionId, user.id, context.id, 'follow-up')
    markLocalInput(sessionId, context.id, user.id)

    const liveBoundaryPartId = '01900000-0000-7000-8000-000000000099'
    new AgentSessionMessageBackend({ sessionId, assistantMessageId: reply.id }).persistAssistant({
      status: 'success',
      finalMessage: {
        id: reply.id,
        role: 'assistant',
        parts: [createClearContextPart()],
        partIds: [liveBoundaryPartId]
      }
    })
    expect(
      dbh.db
        .select({ id: agentSessionMessagePartTable.id })
        .from(agentSessionMessagePartTable)
        .where(eq(agentSessionMessagePartTable.messageId, reply.id))
        .orderBy(asc(agentSessionMessagePartTable.seq))
        .all()
        .map((row) => row.id)
    ).toEqual([liveBoundaryPartId])

    const mismatchedReply = agentSessionMessageService.saveMessage({
      sessionId,
      parentId: user.id,
      message: { role: 'assistant', status: 'pending', data: { parts: [] } }
    })
    agentSessionMessageService.linkReply(sessionId, [user.id], mismatchedReply.id)
    new AgentSessionMessageBackend({ sessionId, assistantMessageId: mismatchedReply.id }).persistAssistant({
      status: 'success',
      finalMessage: {
        id: mismatchedReply.id,
        role: 'assistant',
        parts: [{ type: 'step-start' }],
        partIds: ['stale-step-id']
      }
    })
    const savedRows = dbh.db
      .select({ id: agentSessionMessagePartTable.id })
      .from(agentSessionMessagePartTable)
      .where(eq(agentSessionMessagePartTable.messageId, mismatchedReply.id))
      .orderBy(asc(agentSessionMessagePartTable.seq))
      .all()
    expect(savedRows).toHaveLength(2)
    expect(savedRows.map((row) => row.id)).not.toContain('stale-step-id')
  })
})
