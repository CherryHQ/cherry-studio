import { resolve } from 'node:path'

import { setupTestDatabase } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import { v4 as uuid } from 'uuid'
import { describe, expect, it } from 'vitest'

import { applyMigrations } from '@data/db/applyMigrations'
import { agentSessionTable } from '@data/db/schemas/agentSession'
import { agentSessionContextTable } from '@data/db/schemas/agentSessionContext'
import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'

import { agentSessionContextService as contexts } from '../AgentSessionContextService'
import { agentSessionMessageService as messages } from '../AgentSessionMessageService'
import { agentSessionService as sessions } from '../AgentSessionService'

describe('child archive migration', () => {
  const dbh = setupTestDatabase({ beforeMigration: '0032_woozy_human_torch' })

  // Catches a schema upgrade losing existing message trees or inferring native ownership from old display content.
  it('migrates populated parent history without inventing child bindings', () => {
    const workspaceId = uuid()
    dbh.db
      .insert(agentWorkspaceTable)
      .values({ id: workspaceId, name: 'Work', type: 'user', path: '/test', orderKey: 'a0' })
      .run()
    const root = uuid()
    const contextId = uuid()
    const backendId = uuid()
    const messageId = uuid()
    dbh.sqlite
      .prepare(
        'INSERT INTO agent_session (id, workspace_id, name, order_key, last_activity_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
      )
      .run(root, workspaceId, 'Root', 'a0', 1, 1, 1)
    dbh.sqlite
      .prepare('INSERT INTO agent_runtime_backend (id, locator, state, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
      .run(backendId, JSON.stringify({ version: 1, kind: 'pi' }), 'bound', 1, 1)
    dbh.sqlite
      .prepare(
        'INSERT INTO agent_session_context (id, session_id, backend_id, intended_thread_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
      )
      .run(contextId, root, backendId, 'existing-thread', 1, 1)
    dbh.sqlite
      .prepare(`INSERT INTO agent_session_message (id, session_id, role, status, data, created_at, updated_at)
      VALUES (?, ?, 'assistant', 'success', ?, 1, 1)`)
      .run(messageId, root, JSON.stringify({ parts: [{ type: 'text', text: 'Legacy child display' }] }))
    const folder = resolve('migrations/sqlite-drizzle')
    applyMigrations(dbh.db, folder)
    expect(messages.getSessionMessage(root, messageId).data.parts).toEqual([
      { type: 'text', text: 'Legacy child display' }
    ])
    expect(contexts.context(contextId)).toMatchObject({ sessionId: root, parentContextId: null, subagentId: null })
    expect(dbh.db.select().from(agentSessionTable).all()).toMatchObject([{ id: root, ownerSessionId: null }])
    expect(dbh.sqlite.pragma('foreign_key_check')).toEqual([])
  })
})

describe('child archive ownership', () => {
  const dbh = setupTestDatabase()

  // Catches child identity collisions, accidental writable-root admission and orphan archives after deletion.
  it('keeps parent-scoped child archives independent and cascades their ownership through trash and delete', () => {
    const workspaceId = uuid()
    dbh.db
      .insert(agentWorkspaceTable)
      .values({ id: workspaceId, name: 'Work', type: 'user', path: '/test', orderKey: 'a0' })
      .run()
    const root = uuid()
    dbh.db.insert(agentSessionTable).values({ id: root, workspaceId, name: 'Root', orderKey: 'a0' }).run()
    const parent = contexts.preparePiBranch(root)
    const child = contexts.child(parent.id, 'native-child', 'native-child', 'spawn', 'Child')
    const messageId = uuid()
    messages.saveMessage({
      sessionId: child.sessionId,
      message: { id: messageId, role: 'assistant', data: { parts: [{ type: 'text', text: 'Child output' }] } }
    })
    expect(contexts.child(parent.id, 'native-child', 'native-child', 'spawn', 'Child').id).toBe(child.id)
    expect(child.sessionId).not.toBe(root)
    expect(() => contexts.preparePiBranch(child.sessionId)).toThrow('native owner')
    expect(() => contexts.child(parent.id, 'native-child', 'different', 'spawn', 'Child')).toThrow('identity')
    expect(messages.listAllRuntimeResumeTokens()).toContain('native-child')
    expect(messages.listRuntimeResumeTokensBySession([root]).get(root)).toEqual(
      new Set([parent.intendedThreadId, 'native-child'])
    )
    dbh.db.transaction((tx) => sessions.trashByIdsTx(tx, [root]))
    expect(
      dbh.db.select().from(agentSessionTable).where(eq(agentSessionTable.id, child.sessionId)).get()?.deletedAt
    ).not.toBeNull()
    sessions.restore(root)
    expect(
      dbh.db.select().from(agentSessionTable).where(eq(agentSessionTable.id, child.sessionId)).get()?.deletedAt
    ).toBeNull()
    dbh.db.delete(agentSessionTable).where(eq(agentSessionTable.id, root)).run()
    expect(dbh.db.select().from(agentSessionTable).all()).toEqual([])
    expect(dbh.db.select().from(agentSessionContextTable).all()).toEqual([])
    expect(messages.listAllRuntimeResumeTokens().size).toBe(0)
    expect(() => messages.getSessionMessage(child.sessionId, messageId)).toThrow()
  })
})
