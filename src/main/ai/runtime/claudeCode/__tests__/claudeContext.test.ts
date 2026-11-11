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

import { BranchRuntimeMismatchError } from '../../branchRuntimeMismatch'
import { preparePiBranch } from '../../pi/piContext'
import { prepareDurableBranch } from '../../piDurable/durableContext'
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
  try {
    prepareClaudeBranch(sessionId, '/test/another-config')
    expect.fail('Expected a runtime mismatch')
  } catch (error) {
    expect(error).toBeInstanceOf(BranchRuntimeMismatchError)
    expect(error).toMatchObject({
      name: 'BranchRuntimeMismatchError',
      i18nKey: 'branch_runtime_mismatch',
      detailI18nKey: 'branch_runtime_mismatch_detail'
    })
  }
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

it.each([
  ['Claude Code', (id: string) => prepareClaudeBranch(id, '/test/claude'), 'Pi', preparePiBranch],
  ['Claude Code', (id: string) => prepareClaudeBranch(id, '/test/claude'), 'Pi durable', prepareDurableBranch],
  ['Pi', preparePiBranch, 'Claude Code', (id: string) => prepareClaudeBranch(id, '/test/claude')],
  ['Pi', preparePiBranch, 'Pi durable', prepareDurableBranch],
  ['Pi durable', prepareDurableBranch, 'Claude Code', (id: string) => prepareClaudeBranch(id, '/test/claude')],
  ['Pi durable', prepareDurableBranch, 'Pi', preparePiBranch]
])('rejects a %s branch when preparing another runtime', (_owner, prepareOwner, _runtime, prepareOther) => {
  const context = prepareOwner(sessionId)
  const beforeContexts = sessionContexts()
  const beforeBackends = dbh.db.select().from(agentRuntimeBackendTable).all()
  try {
    prepareOther(sessionId)
    expect.fail('Expected a runtime mismatch')
  } catch (error) {
    expect(error).toBeInstanceOf(BranchRuntimeMismatchError)
    expect(error).toMatchObject({
      i18nKey: 'branch_runtime_mismatch',
      detailI18nKey: 'branch_runtime_mismatch_detail'
    })
  }
  expect(sessionContexts()).toEqual(beforeContexts)
  expect(dbh.db.select().from(agentRuntimeBackendTable).all()).toEqual(beforeBackends)
  expect(contexts.context(context.id).backendId).toBe(context.backendId)
})
