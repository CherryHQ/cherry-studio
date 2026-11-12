import '@data/services/AgentGlobalSkillService'
import { randomUUID } from 'node:crypto'

import { setupTestDatabase } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'

import { agentTable } from '@data/db/schemas/agent'
import { agentRuntimeBackendTable, type AgentRuntimeLocator } from '@data/db/schemas/agentRuntimeBackend'
import { agentSessionTable } from '@data/db/schemas/agentSession'
import { agentSessionContextTable } from '@data/db/schemas/agentSessionContext'
import { agentSessionMessageTable } from '@data/db/schemas/agentSessionMessage'
import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import { userModelTable } from '@data/db/schemas/userModel'
import { userProviderTable } from '@data/db/schemas/userProvider'
import { agentService } from '@data/services/AgentService'
import { agentSessionService } from '@data/services/AgentSessionService'

import { AgentSessionRuntimeSeeder } from '../AgentSessionRuntimeSeeder'
import { RetiredAgentRuntimeSeeder } from '../RetiredAgentRuntimeSeeder'

// Catch Agent normalization redirecting saved history, including retries and native/backend disagreement.
describe('session runtime upgrade', () => {
  const dbh = setupTestDatabase()
  const upgrade = new AgentSessionRuntimeSeeder()
  beforeEach(() => {
    dbh.db
      .insert(agentWorkspaceTable)
      .values({ id: 'work', type: 'user', path: '/work', name: 'Work', orderKey: 'a0' })
      .run()
  })

  function session(type: string | null, deletedAt: number | null = null) {
    const id = randomUUID()
    if (type)
      dbh.db
        .insert(agentTable)
        .values({
          id,
          type,
          name: id,
          instructions: 'Keep instructions',
          configuration: { permission_mode: 'default' },
          orderKey: 'a0',
          deletedAt
        })
        .run()
    dbh.db
      .insert(agentSessionTable)
      .values({ id, agentId: type ? id : null, name: id, workspaceId: 'work', orderKey: 'a0', deletedAt })
      .run()
    return id
  }

  function context(sessionId: string, locator: AgentRuntimeLocator) {
    const backendId = randomUUID()
    dbh.db.insert(agentRuntimeBackendTable).values({ id: backendId, locator, state: 'bound' }).run()
    dbh.db
      .insert(agentSessionContextTable)
      .values({ sessionId, backendId, nativeThreadId: randomUUID(), bindingState: 'bound' })
      .run()
  }

  it('keeps native ownership, deleted history and messages while fresh conversations use Durable', () => {
    const pi = session('pi')
    const claude = session('claude-code')
    const deleted = session('pi', 100)
    const durable = session('pi-durable')
    dbh.db
      .insert(agentSessionMessageTable)
      .values({
        id: 'message',
        sessionId: pi,
        role: 'user',
        data: { parts: [{ type: 'text', text: 'Keep my history' }] },
        runtimeResumeToken: 'native-pi',
        status: 'success'
      })
      .run()
    const before = dbh.db.select().from(agentSessionMessageTable).all()
    const timestamps = dbh.db
      .select({ id: agentSessionTable.id, updatedAt: agentSessionTable.updatedAt })
      .from(agentSessionTable)
      .all()
    upgrade.run(dbh.db)
    upgrade.run(dbh.db)
    for (const [id, expected] of [
      [pi, 'pi'],
      [claude, 'claude-code'],
      [deleted, 'pi'],
      [durable, 'pi-durable']
    ]) {
      expect(agentSessionService.getRuntimeType(id)).toBe(expected)
    }
    expect(
      dbh.db
        .select()
        .from(agentTable)
        .all()
        .every(({ type, instructions }) => type === 'pi-durable' && instructions === 'Keep instructions')
    ).toBe(true)
    expect(dbh.db.select().from(agentSessionMessageTable).all()).toEqual(before)
    expect(
      dbh.db.select({ id: agentSessionTable.id, updatedAt: agentSessionTable.updatedAt }).from(agentSessionTable).all()
    ).toEqual(timestamps)
    const created = agentSessionService.create({
      agentId: pi,
      name: 'New',
      workspace: { type: 'user', workspaceId: 'work' }
    })
    expect(created.runtimeType).toBe('pi-durable')
    expect(agentSessionService.getRuntimeType(created.id)).toBe('pi-durable')
    const childId = dbh.db.transaction((tx) => agentSessionService.createChildArchiveTx(tx, pi, 'Child'))
    expect(agentSessionService.getRuntimeType(childId)).toBe('pi')
    expect(dbh.db.select().from(agentSessionTable).where(eq(agentSessionTable.id, deleted)).get()?.deletedAt).toBe(100)
  })

  it('uses native evidence, quarantines conflicts and does not rebind unresolved sessions on retry', () => {
    const native = session('pi-durable')
    context(native, { version: 1, kind: 'pi' })
    const orphan = session(null)
    const conflict = session('pi')
    context(conflict, { version: 1, kind: 'pi-durable', fileName: 'conflict.sqlite' })
    context(conflict, { version: 1, kind: 'claude-code', configDir: '/claude' })
    const unknown = session('unsupported')
    upgrade.run(dbh.db)
    upgrade.run(dbh.db)
    expect(agentSessionService.getRuntimeType(native)).toBe('pi')
    for (const id of [orphan, conflict, unknown]) {
      expect(agentSessionService.getById(id).runtimeType).toBeUndefined()
      expect(() => agentSessionService.getRuntimeType(id)).toThrow('unresolved')
    }
    context(native, { version: 1, kind: 'pi-durable', fileName: 'wrong.sqlite' })
    expect(() => agentSessionService.getRuntimeType(native)).toThrow('conflicts')
  })

  it('retains pending retired-runtime conversion ownership', () => {
    const retired = session('dsh')
    new RetiredAgentRuntimeSeeder().run(dbh.db)
    upgrade.run(dbh.db)
    expect(agentSessionService.getRuntimeType(retired)).toBe('pi')
    expect(agentService.getAgent(retired)?.type).toBe('pi-durable')
  })

  it('rolls back session bindings when Agent normalization cannot commit', () => {
    const id = session('claude-code')
    dbh.sqlite.exec(
      "CREATE TRIGGER fail_agent_upgrade BEFORE UPDATE OF type ON agent BEGIN SELECT RAISE(ABORT, 'upgrade interrupted'); END"
    )
    try {
      expect(() => upgrade.run(dbh.db)).toThrow()
      expect(dbh.db.select().from(agentSessionTable).where(eq(agentSessionTable.id, id)).get()?.runtimeType).toBeNull()
      expect(agentService.getAgent(id)?.type).toBe('claude-code')
    } finally {
      dbh.sqlite.exec('DROP TRIGGER fail_agent_upgrade')
    }
    upgrade.run(dbh.db)
    expect(agentSessionService.getRuntimeType(id)).toBe('claude-code')
    expect(agentService.getAgent(id)?.type).toBe('pi-durable')
  })

  it('normalizes public and internal Agent creation without changing the source history', () => {
    const id = session('claude-code')
    upgrade.run(dbh.db)
    dbh.db.insert(userProviderTable).values({ providerId: 'provider', name: 'Provider', orderKey: 'a0' }).run()
    dbh.db
      .insert(userModelTable)
      .values({
        id: 'provider::model',
        providerId: 'provider',
        modelId: 'model',
        name: 'Model',
        capabilities: [],
        supportsStreaming: true,
        orderKey: 'a0'
      })
      .run()
    for (const type of ['pi', 'claude-code', 'pi-durable'] as const) {
      const created = agentService.createAgentWithId(randomUUID(), {
        type,
        name: type,
        instructions: 'New',
        model: 'provider::model'
      })
      expect(created.type).toBe('pi-durable')
    }
    expect(agentSessionService.getRuntimeType(id)).toBe('claude-code')
  })
})
