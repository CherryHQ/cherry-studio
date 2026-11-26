import { setupTestDatabase } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import { v7 as uuid } from 'uuid'
import { beforeEach, describe, expect, it } from 'vitest'

import { application } from '@application'
import { runtimeId, type ProductInputState } from '@cherrystudio/agent-runtime'
import { agentTable } from '@data/db/schemas/agent'
import { agentSessionTable } from '@data/db/schemas/agentSession'
import { agentSessionMessageTable } from '@data/db/schemas/agentSessionMessage'
import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import { agentSessionContextService as contexts } from '@data/services/AgentSessionContextService'
import { agentSessionMessageService as messages } from '@data/services/AgentSessionMessageService'
import { applyNativeSubmissionResult, prepareNativeSubmission } from '@main/ai/agentSession/nativeSubmission'
import { preparePiBranch, reservePiBranchTx } from '@main/ai/runtime/pi/piContext'
import { reserveDurableBranchTx } from '@main/ai/runtime/piDurable/durableContext'

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
    const context = preparePiBranch(sessionId, undefined, 'native-session')
    contexts.bindContext(context.id, 'native-session')
    contextId = context.id
    messageId = uuid()
    messages.saveMessage({
      sessionId,
      message: { id: messageId, role: 'user', data: { parts: [{ type: 'text', text: 'original' }] } }
    })
  })

  function nativeInput(id = 'native-input'): ProductInputState {
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

  it('reconciles only inputs linked to pending replies in their original context, including legacy parents', () => {
    const parent = messageId
    const linked = messages.saveMessage({
      sessionId,
      message: { role: 'user', data: { parts: [{ type: 'text', text: 'linked' }] } }
    })
    const reply = messages.saveMessage({
      sessionId,
      parentId: parent,
      message: { role: 'assistant', status: 'pending', data: { parts: [] } }
    })
    for (const id of [parent, linked.id]) prepareNativeSubmission(sessionId, id, contextId, 'steer')
    expect(messages.pendingReplyInputs({ sessionId, contextId })).toMatchObject([
      { sessionId, contextId, runId: reply.id, inputId: parent }
    ])
    dbh.db
      .update(agentSessionMessageTable)
      .set({ replyId: reply.id })
      .where(eq(agentSessionMessageTable.id, linked.id))
      .run()
    expect(messages.pendingReplyInputs({ sessionId, contextId })).toMatchObject([
      { sessionId, contextId, runId: reply.id, inputId: linked.id }
    ])
    expect(messages.pendingReplyInputs({ sessionId, contextId: uuid() })).toEqual([])
    dbh.db
      .update(agentSessionMessageTable)
      .set({ status: 'success' })
      .where(eq(agentSessionMessageTable.id, reply.id))
      .run()
    expect(messages.pendingReplyInputs({ sessionId, contextId })).toEqual([])
  })

  it('keeps placement immutable across repeated observations and late submission results', () => {
    prepareNativeSubmission(sessionId, messageId, contextId, 'follow-up')
    expect(messages.saveInputTimelinePosition(sessionId, messageId, contextId, 10)).toBe(11)
    applyNativeSubmissionResult(sessionId, contextId, { status: 'acknowledged', ...nativeInput() })
    applyNativeSubmissionResult(sessionId, contextId, {
      status: 'rejected',
      inputId: runtimeId(messageId),
      error: { operation: 'submit', code: 'busy', message: 'late' }
    })
    expect(messages.saveInputTimelinePosition(sessionId, messageId, contextId, 15)).toBeUndefined()
    expect(messages.lastTimelinePosition(sessionId)).toBe(11)
    expect(messages.inputBinding(sessionId, messageId)).toEqual({ contextId, nativeInputId: null })
  })

  it('keeps a late event on the captured context and ignores another branch', () => {
    prepareNativeSubmission(sessionId, messageId, contextId, 'reject')
    const edited = messages.saveMessage({
      sessionId,
      parentId: contexts.context(contextId).anchorMessageId!,
      message: { role: 'user', data: { parts: [{ type: 'text', text: 'edited' }] } }
    })
    const other = application
      .get('DbService')
      .withWriteTx((tx) => reservePiBranchTx(tx, sessionId, edited.id, 'other-thread'))
    contexts.bindContext(other.id, 'other-thread')
    expect(messages.saveInputTimelinePosition(sessionId, messageId, other.id)).toBeUndefined()
    expect(messages.inputBinding(sessionId, messageId)).toEqual({ contextId, nativeInputId: null })
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
    messages.resolveCrashOrphanedMessages(messages.findCrashOrphanedAssistantMessages(), [sessionId])
    expect(messages.getSessionMessage(sessionId, nativeAssistant)).toMatchObject({
      status: 'pending',
      runtimeResumeToken: 'native-session'
    })
    expect(messages.getSessionMessage(sessionId, legacyAssistant)).toMatchObject({
      status: 'error',
      runtimeResumeToken: null
    })
  })

  it('leaves a native placeholder for its owner but cleans an unbound input on a sibling branch', () => {
    prepareNativeSubmission(sessionId, messageId, contextId, 'reject')
    const nativeAssistant = uuid()
    messages.saveMessage({
      sessionId,
      parentId: messageId,
      message: {
        id: nativeAssistant,
        role: 'assistant',
        status: 'pending',
        data: { parts: [] }
      }
    })
    const legacyInput = uuid()
    messages.saveMessage({
      sessionId,
      parentId: messageId,
      message: {
        id: legacyInput,
        role: 'user',
        status: 'success',
        data: { parts: [{ type: 'text', text: 'legacy' }] }
      }
    })
    const legacyAssistant = uuid()
    messages.saveMessage({
      sessionId,
      parentId: legacyInput,
      message: {
        id: legacyAssistant,
        role: 'assistant',
        status: 'pending',
        data: { parts: [] }
      }
    })
    expect(messages.findCrashOrphanedAssistantMessages().map((row) => row.id)).toEqual([legacyAssistant])
    messages.resolveCrashOrphanedMessages(messages.findCrashOrphanedAssistantMessages(), [sessionId])
    expect(messages.getSessionMessage(sessionId, nativeAssistant).status).toBe('pending')
    expect(messages.getSessionMessage(sessionId, legacyAssistant).status).toBe('error')
  })

  it('preserves a pending Durable reply when its branch parent and current agent point to Pi', () => {
    const agentId = uuid()
    dbh.db.insert(agentTable).values({ id: agentId, type: 'pi', name: 'Pi', instructions: '', orderKey: 'a0' }).run()
    dbh.db.update(agentSessionTable).set({ agentId }).where(eq(agentSessionTable.id, sessionId)).run()
    prepareNativeSubmission(sessionId, messageId, contextId, 'reject')
    const durableInput = messages.saveMessage({
      sessionId,
      message: { role: 'user', data: { parts: [{ type: 'text', text: 'saved on Durable' }] } }
    })
    const context = application
      .get('DbService')
      .withWriteTx((tx) => reserveDurableBranchTx(tx, sessionId, durableInput.id, uuid()))
    prepareNativeSubmission(sessionId, durableInput.id, context.id, 'reject')
    const reply = messages.saveMessage({
      sessionId,
      parentId: messageId,
      message: { role: 'assistant', status: 'pending', data: { parts: [] } }
    })
    dbh.db
      .update(agentSessionMessageTable)
      .set({ replyId: reply.id })
      .where(eq(agentSessionMessageTable.id, durableInput.id))
      .run()
    expect(messages.findCrashOrphanedAssistantMessages(['pi'])).toEqual([])
  })

  it('cascades the input binding with its owning session without preventing permanent deletion', () => {
    prepareNativeSubmission(sessionId, messageId, contextId, 'reject')
    dbh.db.delete(agentSessionTable).where(eq(agentSessionTable.id, sessionId)).run()
    expect(dbh.db.select().from(agentSessionMessageTable).all()).toEqual([])
    expect(dbh.sqlite.pragma('foreign_key_check')).toEqual([])
  })

  // Catches a crashed Pi placeholder blocking edits forever, or recovery erasing its native identity.
  it('terminalizes placeholders for the selected native owner while preserving resume identities', () => {
    const agentId = uuid()
    dbh.db.insert(agentTable).values({ id: agentId, type: 'pi', name: 'Pi', instructions: '', orderKey: 'a0' }).run()
    dbh.db.update(agentSessionTable).set({ agentId }).where(eq(agentSessionTable.id, sessionId)).run()
    prepareNativeSubmission(sessionId, messageId, contextId, 'reject')
    const previous = uuid()
    messages.saveMessage({
      sessionId,
      parentId: messageId,
      runtimeResumeToken: 'native-session',
      message: { id: previous, role: 'assistant', status: 'success', data: { parts: [] } }
    })
    const pending = uuid()
    messages.saveMessage({
      sessionId,
      parentId: previous,
      message: { id: pending, role: 'assistant', status: 'pending', data: { parts: [] } }
    })
    dbh.db.update(agentTable).set({ type: 'claude-code' }).where(eq(agentTable.id, agentId)).run()
    expect(messages.findCrashOrphanedAssistantMessages(['claude-code'])).toEqual([])
    const stale = messages.findCrashOrphanedAssistantMessages(['pi'])
    expect(stale.map((row) => row.id)).toEqual([pending])
    messages.resolveCrashOrphanedMessages(stale, [sessionId])
    expect(messages.getSessionMessage(sessionId, pending).status).toBe('error')
    expect(messages.getLastRuntimeResumeToken(sessionId)).toBe('native-session')
    expect(messages.inputBinding(sessionId, messageId)).toEqual({ contextId, nativeInputId: null })
    expect(contexts.context(contextId)).toMatchObject({ bindingState: 'bound', nativeThreadId: 'native-session' })
  })
})
