import { setupTestDatabase } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import { v7 as uuid } from 'uuid'
import { beforeEach, describe, expect, it } from 'vitest'

import { application } from '@application'
import { runtimeId, type InputState } from '@cherrystudio/agent-runtime'
import { agentSessionTable } from '@data/db/schemas/agentSession'
import { agentSessionMessageTable } from '@data/db/schemas/agentSessionMessage'
import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import { agentSessionContextService as contexts } from '@data/services/AgentSessionContextService'
import { agentSessionMessageService as messages } from '@data/services/AgentSessionMessageService'
import {
  applyNativeSubmissionResult,
  bindNativeInput,
  prepareNativeSubmission
} from '@main/ai/agentSession/nativeSubmission'

describe('message-owned native input bindings', () => {
  const dbh = setupTestDatabase()
  let sessionId: string
  let contextId: string
  let messageId: string

  beforeEach(() => {
    sessionId = uuid()
    const workspaceId = uuid()
    dbh.db
      .insert(agentWorkspaceTable)
      .values({ id: workspaceId, name: 'Work', path: '/test', type: 'user', orderKey: 'a0' })
      .run()
    dbh.db.insert(agentSessionTable).values({ id: sessionId, workspaceId, name: 'Session', orderKey: 'a0' }).run()
    const backend = application
      .get('DbService')
      .withWriteTx((tx) => contexts.ensureBackendTx(tx, { version: 1, kind: 'pi' }, 'bound'))
    const context = contexts.allocateContext(sessionId, backend.id, 'native-session')
    contexts.bindContext(context.id, 'native-session')
    contextId = context.id
    messageId = uuid()
    messages.saveMessage({
      sessionId,
      message: { id: messageId, role: 'user', data: { parts: [{ type: 'text', text: 'original' }] } }
    })
  })

  function nativeInput(id = 'native-input'): InputState {
    const context = contexts.context(contextId)
    return {
      inputId: runtimeId(messageId),
      facts: ['accepted'],
      nativeInput: {
        session: { backendId: runtimeId(context.backendId), id: runtimeId(context.nativeThreadId!) },
        id: runtimeId(id)
      }
    }
  }

  it('keeps the original input immutable without exposing its private binding to message clients', () => {
    prepareNativeSubmission(sessionId, messageId, contextId, 'reject')
    expect(messages.getSessionMessage(sessionId, messageId)).not.toHaveProperty('inputContextId')
    expect(messages.getSessionMessage(sessionId, messageId)).not.toHaveProperty('nativeInputId')
    expect(() => prepareNativeSubmission(sessionId, messageId, contextId, 'steer')).toThrow('already bound')
    expect(() =>
      messages.updateSessionMessage(sessionId, messageId, { data: { parts: [{ type: 'text', text: 'edited' }] } })
    ).toThrow()
    expect(() => messages.deleteSessionMessage(sessionId, messageId)).toThrow()
    expect(() =>
      messages.saveMessage({
        sessionId,
        message: { id: messageId, role: 'user', data: { parts: [{ type: 'text', text: 'edited' }] } }
      })
    ).toThrow()
    expect(messages.getSessionMessage(sessionId, messageId).data.parts).toEqual([{ type: 'text', text: 'original' }])
  })

  it.each(['rejected', 'unsupported'] as const)('removes only the attempted binding after %s', (status) => {
    prepareNativeSubmission(sessionId, messageId, contextId, 'reject')
    applyNativeSubmissionResult(sessionId, contextId, {
      status,
      inputId: runtimeId(messageId),
      error: { operation: 'submit', code: 'busy', message: 'not admitted' }
    })
    expect(messages.hasContextInput(sessionId, contextId)).toBe(false)
    messages.updateSessionMessage(sessionId, messageId, { data: { parts: [{ type: 'text', text: 'edited' }] } })
    expect(messages.getSessionMessage(sessionId, messageId).data.parts).toEqual([{ type: 'text', text: 'edited' }])
    messages.deleteSessionMessage(sessionId, messageId)
    expect(() => messages.getSessionMessage(sessionId, messageId)).toThrow()
  })

  it('does not make an uncertain input editable or eligible for another submission', () => {
    prepareNativeSubmission(sessionId, messageId, contextId, 'reject')
    applyNativeSubmissionResult(sessionId, contextId, {
      status: 'unknown',
      inputId: runtimeId(messageId),
      error: { operation: 'submit', code: 'disconnected', message: 'receipt unavailable' }
    })
    expect(messages.inputBinding(sessionId, messageId)?.contextId).toBe(contextId)
    expect(() => prepareNativeSubmission(sessionId, messageId, contextId, 'reject')).toThrow('already bound')
    expect(() => messages.deleteSessionMessage(sessionId, messageId)).toThrow()
  })

  it('finds a retained message from a native-only snapshot and rejects retargeting the association', () => {
    prepareNativeSubmission(sessionId, messageId, contextId, 'reject')
    const input = nativeInput()
    bindNativeInput(sessionId, contextId, input)
    expect(bindNativeInput(sessionId, contextId, { nativeInput: input.nativeInput!, facts: ['queued'] })).toBe(
      messageId
    )
    expect(() => bindNativeInput(sessionId, contextId, nativeInput('different-input'))).toThrow('identity')
    expect(() =>
      bindNativeInput(sessionId, contextId, {
        ...input,
        nativeInput: { ...input.nativeInput!, session: { ...input.nativeInput!.session, id: runtimeId('other') } }
      })
    ).toThrow('target')
    expect(messages.inputMessageId(sessionId, contextId, 'native-input')).toBe(messageId)
    expect(messages.inputMessageId(uuid(), contextId, 'native-input')).toBeUndefined()
  })

  it('keeps a late event on the captured context and ignores another branch', () => {
    prepareNativeSubmission(sessionId, messageId, contextId, 'reject')
    const other = contexts.allocateContext(sessionId, contexts.context(contextId).backendId, 'other-thread')
    contexts.bindContext(other.id, 'other-thread')
    expect(bindNativeInput(sessionId, other.id, { inputId: runtimeId(messageId), facts: ['accepted'] })).toBeUndefined()
    bindNativeInput(sessionId, contextId, nativeInput())
    expect(messages.inputBinding(sessionId, messageId)).toEqual({ contextId, nativeInputId: 'native-input' })
  })

  it('cleans an orphan from the legacy context without clearing a different native context in the same session', () => {
    prepareNativeSubmission(sessionId, messageId, contextId, 'reject')
    const nativeAssistant = uuid()
    const legacyAssistant = uuid()
    for (const [id, token] of [
      [nativeAssistant, 'native-session'],
      [legacyAssistant, 'legacy-session']
    ])
      messages.saveMessage({
        sessionId,
        runtimeResumeToken: token,
        message: { id, role: 'assistant', status: 'pending', data: { parts: [] } }
      })
    expect(messages.findCrashOrphanedAssistantMessages().map((row) => row.id)).toEqual([legacyAssistant])
    messages.resolveCrashOrphanedMessages(
      [nativeAssistant, legacyAssistant].map((id) => ({ id, data: { parts: [] } })),
      [sessionId]
    )
    expect(messages.getSessionMessage(sessionId, nativeAssistant)).toMatchObject({
      status: 'pending',
      runtimeResumeToken: 'native-session'
    })
    expect(messages.getSessionMessage(sessionId, legacyAssistant)).toMatchObject({
      status: 'error',
      runtimeResumeToken: null
    })
  })

  it('cascades the input binding with its owning session without preventing permanent deletion', () => {
    prepareNativeSubmission(sessionId, messageId, contextId, 'reject')
    bindNativeInput(sessionId, contextId, nativeInput())
    dbh.db.delete(agentSessionTable).where(eq(agentSessionTable.id, sessionId)).run()
    expect(dbh.db.select().from(agentSessionMessageTable).all()).toEqual([])
    expect(dbh.sqlite.pragma('foreign_key_check')).toEqual([])
  })
})
