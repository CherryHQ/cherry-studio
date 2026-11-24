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
import { ensureAgentSessionRootTx } from '@data/services/agentSessionMessageTree'

import { prepareClaudeBranch, reserveClaudeBranchTx, resolveClaudeBranchResumeToken } from '../claudeContext'

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
  // A pending anchor captured under another backend is retargeted in place rather
  // than rejected: no native history exists to lose yet.
  const moved = prepareClaudeBranch(sessionId, '/test/another-config')
  expect(moved.id).toBe(context.id)
  const movedBackend = contexts.backend(moved.backendId)
  expect(movedBackend.locator.kind === 'claude-code' && movedBackend.locator.configDir).toBe('/test/another-config')
  expect(sessionContexts().map((row) => row.id)).toEqual([context.id])
  expect(
    dbh.db
      .select()
      .from(agentRuntimeBackendTable)
      .all()
      .map((row) => row.id)
  ).toEqual([context.backendId, moved.backendId])
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

it('uses a fresh Claude identity when the latest native token belongs to a foreign ancestor', () => {
  const foreign = application.get('DbService').withWriteTx((tx) => {
    const root = ensureAgentSessionRootTx(tx, sessionId)
    const backend = contexts.ensureBackendTx(
      tx,
      { version: 1, kind: 'pi-durable', fileName: 'foreign.sqlite' },
      'bound'
    )
    return contexts.reserveBranchTx(tx, {
      sessionId,
      backendId: backend.id,
      anchorMessageId: root,
      nativeThreadId: '1'
    })
  })
  contexts.bindContext(foreign.id, '1')
  const current = messages.saveMessage({
    sessionId,
    message: { role: 'user', data: { parts: [{ type: 'text', text: 'Continue' }] } }
  })

  const context = prepareClaudeBranch(sessionId, '/test/claude', '1', current.id)

  expect(contexts.backend(context.backendId).locator.kind).toBe('claude-code')
  expect(context.nativeThreadId).not.toBe('1')
  expect(context.nativeThreadId).toMatch(/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i)
  expect(resolveClaudeBranchResumeToken(sessionId, '/test/claude', '1', current.id)).toBeUndefined()
})

it('resolves a resume token only from the bound destination Claude branch', () => {
  const context = prepareClaudeBranch(sessionId, '/test/claude')
  contexts.bindContext(context.id, context.nativeThreadId!)

  expect(resolveClaudeBranchResumeToken(sessionId, '/test/claude')).toBe(context.nativeThreadId)
  expect(resolveClaudeBranchResumeToken(sessionId, '/test/other-claude')).toBeUndefined()
})
