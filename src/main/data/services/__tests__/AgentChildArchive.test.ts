import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { setupTestDatabase } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import { v4 as uuid } from 'uuid'
import { expect, it } from 'vitest'

import { applyMigrations } from '@data/db/applyMigrations'
import { agentSessionTable } from '@data/db/schemas/agentSession'
import { agentSessionContextTable } from '@data/db/schemas/agentSessionContext'
import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'

import { agentSessionContextService as contexts } from '../AgentSessionContextService'
import { agentSessionMessageService as messages } from '../AgentSessionMessageService'
import { agentSessionService as sessions } from '../AgentSessionService'

const dbh = setupTestDatabase()

// Catches a schema upgrade losing existing message trees or inferring native ownership from old display content.
it('migrates populated parent history without inventing child bindings', () => {
  const workspaceId = uuid()
  dbh.db
    .insert(agentWorkspaceTable)
    .values({ id: workspaceId, name: 'Work', type: 'user', path: '/test', orderKey: 'a0' })
    .run()
  const root = uuid()
  dbh.db.insert(agentSessionTable).values({ id: root, workspaceId, name: 'Root', orderKey: 'a0' }).run()
  const context = contexts.preparePiBranch(root)
  const messageId = uuid()
  messages.saveMessage({
    sessionId: root,
    message: { id: messageId, role: 'assistant', data: { parts: [{ type: 'text', text: 'Legacy child display' }] } }
  })
  dbh.sqlite.exec('DROP INDEX agent_session_context_child_uniq; DROP INDEX agent_session_owner_idx;')
  for (const column of ['parent_context_id', 'subagent_id', 'spawn_tool_call_id'])
    dbh.sqlite.exec(`ALTER TABLE agent_session_context DROP COLUMN ${column}`)
  dbh.sqlite.exec('ALTER TABLE agent_session DROP COLUMN owner_session_id')
  const folder = resolve('migrations/sqlite-drizzle')
  const journal = JSON.parse(readFileSync(resolve(folder, 'meta/_journal.json'), 'utf8')) as {
    entries: Array<{ tag: string; when: number }>
  }
  const migration = journal.entries.find((entry) => entry.tag === '0032_woozy_human_torch')!
  dbh.sqlite.prepare('DELETE FROM __drizzle_migrations WHERE created_at >= ?').run(migration.when)
  applyMigrations(dbh.db, folder)
  expect(messages.getSessionMessage(root, messageId).data.parts).toEqual([
    { type: 'text', text: 'Legacy child display' }
  ])
  expect(contexts.context(context.id)).toMatchObject({ sessionId: root, parentContextId: null, subagentId: null })
  expect(dbh.db.select().from(agentSessionTable).all()).toMatchObject([{ id: root, ownerSessionId: null }])
  expect(dbh.sqlite.pragma('foreign_key_check')).toEqual([])
})

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
