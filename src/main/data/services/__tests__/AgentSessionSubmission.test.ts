import { setupTestDatabase } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import { v7 as uuid } from 'uuid'
import { beforeEach, describe, expect, it } from 'vitest'

import { application } from '@application'
import { runtimeId } from '@cherrystudio/agent-runtime'
import { agentSessionTable } from '@data/db/schemas/agentSession'
import { agentSessionMessageTable } from '@data/db/schemas/agentSessionMessage'
import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import { agentSessionContextService as contexts } from '@data/services/AgentSessionContextService'
import { agentSessionMessageService as messages } from '@data/services/AgentSessionMessageService'

// These contracts prevent native retries from using edited content or losing earlier terminal evidence.
describe('message-owned native submission', () => {
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
    const backend = contexts.allocateBackend('pi')
    const context = contexts.allocateContext(sessionId, backend.id, 'native-session')
    contexts.bindContext(context.id, 'native-session')
    contextId = context.id
    messageId = uuid()
    messages.saveMessage({
      sessionId,
      message: { id: messageId, role: 'user', data: { parts: [{ type: 'text', text: 'original' }] } }
    })
  })

  it('keeps admission unknown despite display success and rejects reusing or changing a submitted message', () => {
    const draft = messages.prepareSubmission(sessionId, messageId, contextId, 'reject')
    expect(draft).toEqual({ inputId: messageId, text: 'original', whenBusy: 'reject' })
    expect(messages.readSubmission(sessionId, messageId).submission.facts).toEqual([])
    expect(messages.getSessionMessage(sessionId, messageId).status).toBe('success')
    expect(messages.getSessionMessage(sessionId, messageId)).not.toHaveProperty('submission')
    expect(() => messages.prepareSubmission(sessionId, messageId, contextId, 'steer')).toThrow('already submitted')
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
    expect(messages.readSubmission(sessionId, messageId).draft.text).toBe('original')
  })

  it('preserves terminal evidence across a late receipt and allows two inputs to share one response', () => {
    const second = uuid()
    const response = uuid()
    messages.saveMessage({
      sessionId,
      message: { id: second, role: 'user', data: { parts: [{ type: 'text', text: 'follow up' }] } }
    })
    messages.saveMessage({
      sessionId,
      message: { id: response, role: 'assistant', data: { parts: [{ type: 'text', text: 'answer to both' }] } }
    })
    for (const id of [messageId, second]) {
      messages.prepareSubmission(sessionId, id, contextId, 'follow-up')
      application.get('DbService').withWriteTx((tx) =>
        messages.mergeSubmissionTx(
          tx,
          sessionId,
          id,
          {
            inputId: runtimeId(id),
            facts: ['placed'],
            outcome: 'completed'
          },
          response
        )
      )
      application.get('DbService').withWriteTx((tx) =>
        messages.mergeSubmissionTx(tx, sessionId, id, {
          inputId: runtimeId(id),
          facts: ['accepted']
        })
      )
      expect(messages.readSubmission(sessionId, id).submission).toMatchObject({
        outcome: 'completed',
        facts: ['placed', 'accepted'],
        responseMessageId: response
      })
    }
  })

  it('rejects a response, input identity or native target from another context', () => {
    messages.prepareSubmission(sessionId, messageId, contextId, 'reject')
    expect(() =>
      application.get('DbService').withWriteTx((tx) =>
        messages.mergeSubmissionTx(tx, sessionId, messageId, {
          inputId: runtimeId('other'),
          facts: ['accepted']
        })
      )
    ).toThrow('identity')
    expect(() =>
      application.get('DbService').withWriteTx((tx) =>
        messages.mergeSubmissionTx(tx, sessionId, messageId, {
          inputId: runtimeId(messageId),
          facts: ['accepted'],
          nativeInput: {
            id: runtimeId('input'),
            session: { id: runtimeId('other-thread'), backendId: runtimeId('other-backend') }
          }
        })
      )
    ).toThrow('identity')
    expect(messages.readSubmission(sessionId, messageId).submission.facts).toEqual([])
  })

  it('rejects altered stored content before recovery and leaves legacy crash cleanup off a native submission', () => {
    messages.prepareSubmission(sessionId, messageId, contextId, 'reject')
    const assistantId = uuid()
    messages.saveMessage({
      sessionId,
      runtimeResumeToken: 'keep-native',
      message: {
        id: assistantId,
        role: 'assistant',
        status: 'pending',
        data: { parts: [] }
      }
    })
    expect(messages.findCrashOrphanedAssistantMessages()).toEqual([])
    messages.resolveCrashOrphanedMessages([{ id: assistantId, data: { parts: [] } }], [sessionId])
    const row = dbh.db
      .select()
      .from(agentSessionMessageTable)
      .where(eq(agentSessionMessageTable.id, assistantId))
      .get()!
    expect([row.status, row.runtimeResumeToken]).toEqual(['pending', 'keep-native'])
    dbh.db
      .update(agentSessionMessageTable)
      .set({ data: { parts: [{ type: 'text', text: 'changed out of band' }] } })
      .where(eq(agentSessionMessageTable.id, messageId))
      .run()
    expect(() => messages.readSubmission(sessionId, messageId)).toThrow('changed')
  })
})
