import { randomUUID } from 'node:crypto'

import { setupTestDatabase } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import { beforeEach, expect, it } from 'vitest'

import { application } from '@application'
import { agentRuntimeBackendTable } from '@data/db/schemas/agentRuntimeBackend'
import { agentSessionTable } from '@data/db/schemas/agentSession'
import { agentSessionContextTable } from '@data/db/schemas/agentSessionContext'
import { agentSessionMessageTable } from '@data/db/schemas/agentSessionMessage'
import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import { agentSessionContextService as contexts } from '@data/services/AgentSessionContextService'
import { agentSessionMessageService as messages } from '@data/services/AgentSessionMessageService'

import { prepareClaudeBranch, reserveClaudeBranchTx } from '../claudeContext'

const dbh = setupTestDatabase()
let sessionId: string
const sessionContexts = () =>
  dbh.db.select().from(agentSessionContextTable).where(eq(agentSessionContextTable.sessionId, sessionId)).all()
beforeEach(() => {
  const workspaceId = randomUUID()
  sessionId = randomUUID()
  dbh.db
    .insert(agentWorkspaceTable)
    .values({ id: workspaceId, name: 'Work', type: 'user', path: '/test', orderKey: 'a0' })
    .run()
  dbh.db.insert(agentSessionTable).values({ id: sessionId, workspaceId, name: 'Root', orderKey: 'a0' }).run()
})

it('reuses a reserved Claude identity only within its captured backend', () => {
  const context = prepareClaudeBranch(sessionId, '/test/claude')
  expect(context.bindingState).toBe('pending')
  expect(context.nativeThreadId).toBeTruthy()
  expect(prepareClaudeBranch(sessionId, '/test/claude').id).toBe(context.id)
  expect(() => prepareClaudeBranch(sessionId, '/test/another-config')).toThrow('another runtime backend')
  expect(sessionContexts().map((row) => row.id)).toEqual([context.id])
  expect(
    dbh.db
      .select()
      .from(agentRuntimeBackendTable)
      .all()
      .map((row) => row.id)
  ).toEqual([context.backendId])
})

it('rolls back an edit binding with its message metadata and then captures the selected branch', () => {
  const original = prepareClaudeBranch(sessionId, '/test/claude')
  const edited = messages.saveMessage({
    sessionId,
    message: { role: 'user', data: { parts: [{ type: 'text', text: 'Edited request' }] } }
  })
  const nativeId = randomUUID()
  expect(() =>
    application.get('DbService').withWriteTx((tx) => {
      reserveClaudeBranchTx(tx, sessionId, edited.id, nativeId)
      messages.setEditRuntimeTx(tx, sessionId, edited.id, nativeId)
      throw new Error('Edit was cancelled')
    })
  ).toThrow('cancelled')
  expect(sessionContexts().map((row) => row.id)).toEqual([original.id])
  expect(
    dbh.db.select().from(agentSessionMessageTable).where(eq(agentSessionMessageTable.id, edited.id)).get()?.data
      .nativeSessionId
  ).toBeUndefined()

  const branch = application.get('DbService').withWriteTx((tx) => {
    const reserved = reserveClaudeBranchTx(tx, sessionId, edited.id, nativeId)
    messages.setEditRuntimeTx(tx, sessionId, edited.id, nativeId)
    return reserved
  })
  expect(prepareClaudeBranch(sessionId, '/test/claude')).toMatchObject({
    id: branch.id,
    backendId: original.backendId,
    nativeThreadId: nativeId,
    bindingState: 'pending'
  })
  expect(contexts.context(original.id).nativeThreadId).toBe(original.nativeThreadId)
})

it('reconnects fresh after a stale-resume reset without violating the root anchor', () => {
  const rootContext = prepareClaudeBranch(sessionId, '/test/claude')
  const parent = messages.saveMessage({
    sessionId,
    runtimeResumeToken: 'healthy-parent',
    message: { role: 'assistant', data: { parts: [] } }
  })
  const staleChild = messages.saveMessage({
    sessionId,
    parentId: parent.id,
    runtimeResumeToken: 'stale-id',
    message: { role: 'assistant', data: { parts: [] } }
  })
  const sibling = messages.saveMessage({
    sessionId,
    parentId: parent.id,
    runtimeResumeToken: 'healthy-sibling',
    message: { role: 'assistant', data: { parts: [] } }
  })

  messages.clearRuntimeResumeTokens(sessionId, 'stale-id')
  messages.markStaleResumeResetBoundary(sessionId, staleChild.id)

  // Failed branch goes fresh instead of falling back to the healthy ancestor.
  expect(messages.getLastRuntimeResumeToken(sessionId, staleChild.id)).toBeNull()

  // Previously this threw `UNIQUE constraint failed:
  // agent_session_context.session_id, agent_session_context.anchor_message_id`
  // because the hidden root binding still occupied `(sessionId, root)` (#23519).
  const reconnected = prepareClaudeBranch(sessionId, '/test/claude', undefined, staleChild.id)
  expect(reconnected.anchorMessageId).toBe(staleChild.id)
  expect(reconnected.nativeThreadId).toBeTruthy()
  expect(reconnected.nativeThreadId).not.toBe(rootContext.nativeThreadId)
  expect(reconnected.backendId).toBe(rootContext.backendId)

  // Reconnect is idempotent — the fresh head-anchored binding is reused.
  expect(prepareClaudeBranch(sessionId, '/test/claude', undefined, staleChild.id).id).toBe(reconnected.id)

  // Healthy sibling paths exclude the boundary row and keep the root binding.
  expect(prepareClaudeBranch(sessionId, '/test/claude', undefined, sibling.id).id).toBe(rootContext.id)
  expect(messages.getLastRuntimeResumeToken(sessionId, sibling.id)).toBe('healthy-sibling')
  expect(sessionContexts()).toHaveLength(2)
})

it('rotates a reset-bound edit fork instead of reusing its dead identity', () => {
  prepareClaudeBranch(sessionId, '/test/claude')
  const edited = messages.saveMessage({
    sessionId,
    message: { role: 'user', data: { parts: [{ type: 'text', text: 'Edited request' }] } }
  })
  const deadId = randomUUID()
  const fork = application.get('DbService').withWriteTx((tx) => {
    const reserved = reserveClaudeBranchTx(tx, sessionId, edited.id, deadId)
    messages.setEditRuntimeTx(tx, sessionId, edited.id, deadId)
    return reserved
  })

  messages.clearNativeSessionIds(sessionId, deadId)
  messages.markStaleResumeResetBoundary(sessionId, edited.id)

  const rotated = prepareClaudeBranch(sessionId, '/test/claude', undefined, edited.id)
  expect(rotated.id).toBe(fork.id)
  expect(rotated.anchorMessageId).toBe(edited.id)
  expect(rotated.nativeThreadId).toBeTruthy()
  expect(rotated.nativeThreadId).not.toBe(deadId)
  expect(rotated.bindingState).toBe('pending')
})
