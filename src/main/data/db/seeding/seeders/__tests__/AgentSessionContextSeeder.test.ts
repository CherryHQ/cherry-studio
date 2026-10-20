import { randomUUID } from 'node:crypto'

import { setupTestDatabase } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import { agentTable } from '@data/db/schemas/agent'
import { agentRuntimeBackendTable } from '@data/db/schemas/agentRuntimeBackend'
import { agentSessionTable } from '@data/db/schemas/agentSession'
import { agentSessionContextTable } from '@data/db/schemas/agentSessionContext'
import { agentSessionMessageTable, type InsertAgentSessionMessageRow } from '@data/db/schemas/agentSessionMessage'
import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import { appStateTable } from '@data/db/schemas/appState'
import { seeders } from '@data/db/seeding/seederRegistry'
import { SeedRunner } from '@data/db/seeding/SeedRunner'
import { getRetiredAgentSessionMigration } from '@data/services/retiredAgentRuntimeMigration'

import { AgentSessionContextSeeder } from '../AgentSessionContextSeeder'
import { RetiredAgentRuntimeSeeder } from '../RetiredAgentRuntimeSeeder'

const upgradeSeeders = seeders.filter(({ name }) => name === 'retiredAgentRuntime' || name === 'agentSessionContext')

describe('AgentSessionContextSeeder', () => {
  const dbh = setupTestDatabase()
  const seeder = new AgentSessionContextSeeder()

  beforeEach(() => {
    dbh.db
      .insert(agentWorkspaceTable)
      .values({ id: 'workspace', name: 'Work', path: '/work', type: 'user', orderKey: 'a0' })
      .run()
  })
  afterEach(() => vi.restoreAllMocks())

  function session(type: string | null = 'pi') {
    const id = randomUUID()
    if (type) {
      dbh.db.insert(agentTable).values({ id, type, name: type, instructions: '', orderKey: 'a0' }).run()
    }
    dbh.db
      .insert(agentSessionTable)
      .values({ id, agentId: type ? id : null, workspaceId: 'workspace', name: 'History', orderKey: 'a0' })
      .run()
    return id
  }

  function message(sessionId: string, values: Partial<InsertAgentSessionMessageRow> = {}) {
    dbh.db
      .insert(agentSessionMessageTable)
      .values({
        id: randomUUID(),
        sessionId,
        role: 'user',
        status: 'success',
        data: { parts: [{ type: 'text', text: 'Preserved history' }] },
        ...values
      })
      .run()
  }

  function journal() {
    return dbh.db
      .select()
      .from(appStateTable)
      .where(eq(appStateTable.key, `seed:${seeder.name}`))
      .get()
  }

  it('leaves a fresh installation without empty runtime backends or contexts', () => {
    new SeedRunner(dbh.db).runAll(upgradeSeeders)
    expect(dbh.db.select().from(agentRuntimeBackendTable).all()).toEqual([])
    expect(dbh.db.select().from(agentSessionContextTable).all()).toEqual([])
    expect(journal()?.value).toEqual({ version: seeder.version })
  })

  it('upgrades existing users through the registry before DbService is ready, preserving all message facts', () => {
    new SeedRunner(dbh.db).runAll([new RetiredAgentRuntimeSeeder()])
    const id = session()
    message(id, { runtimeResumeToken: 'original-pi' })
    message(id, { runtimeResumeToken: 'original-pi', data: { parts: [], nativeSessionId: 'edited-pi' } })
    message(id, { status: 'pending', deliveryStatus: 'accepted' })
    const before = dbh.db.select().from(agentSessionMessageTable).all()
    vi.spyOn(application.get('DbService'), 'getDb').mockImplementation(() => {
      throw new Error('Database is not initialized')
    })
    vi.mocked(application.getPath).mockImplementation(() => {
      throw new Error('Seeding must not access native files')
    })

    new SeedRunner(dbh.db).runAll(upgradeSeeders)

    const contexts = dbh.db.select().from(agentSessionContextTable).all()
    expect(contexts.map((row) => row.intendedThreadId).sort()).toEqual(['edited-pi', 'original-pi'])
    expect(contexts.every((row) => row.sessionId === id && row.nativeThreadId === null)).toBe(true)
    expect(dbh.db.select().from(agentRuntimeBackendTable).all()).toHaveLength(1)
    expect(dbh.db.select().from(agentSessionMessageTable).all()).toEqual(before)
    expect(journal()?.value).toEqual({ version: seeder.version })
  })

  it('preserves confirmed identities when replayed after writes committed without the seed journal', () => {
    const id = session()
    message(id, { runtimeResumeToken: 'retained-pi' })
    seeder.run(dbh.db)
    const context = dbh.db.select().from(agentSessionContextTable).get()!
    dbh.db
      .update(agentSessionContextTable)
      .set({ intendedThreadId: null, nativeThreadId: 'retained-pi' })
      .where(eq(agentSessionContextTable.id, context.id))
      .run()
    const before = dbh.db.select().from(agentSessionContextTable).all()
    const backends = dbh.db.select().from(agentRuntimeBackendTable).all()

    new SeedRunner(dbh.db).runAll(upgradeSeeders)
    seeder.run(dbh.db)

    expect(dbh.db.select().from(agentSessionContextTable).all()).toEqual(before)
    expect(dbh.db.select().from(agentRuntimeBackendTable).all()).toEqual(backends)
    expect(journal()?.value).toEqual({ version: seeder.version })
  })

  it('rolls back the whole backfill on failure and leaves it retryable without a success journal', () => {
    const id = session()
    message(id, { runtimeResumeToken: 'original-pi', data: { parts: [], nativeSessionId: 'edited-pi' } })
    const before = dbh.db.select().from(agentSessionMessageTable).all()
    dbh.sqlite.exec(`CREATE TRIGGER reject_context BEFORE INSERT ON agent_session_context
      WHEN NEW.intended_thread_id = 'edited-pi' BEGIN SELECT RAISE(ABORT, 'context write failed'); END`)
    try {
      expect(() => new SeedRunner(dbh.db).runAll(upgradeSeeders)).toThrow()
      expect(dbh.db.select().from(agentRuntimeBackendTable).all()).toEqual([])
      expect(dbh.db.select().from(agentSessionContextTable).all()).toEqual([])
      expect(dbh.db.select().from(agentSessionMessageTable).all()).toEqual(before)
      expect(journal()).toBeUndefined()
    } finally {
      dbh.sqlite.exec('DROP TRIGGER reject_context')
    }

    new SeedRunner(dbh.db).runAll(upgradeSeeders)
    expect(dbh.db.select().from(agentSessionContextTable).all()).toHaveLength(2)
    expect(journal()?.value).toEqual({ version: seeder.version })
  })

  it('records the planned Pi identity for pending DSH conversion, never the old DSH tokens', () => {
    const id = session('dsh')
    message(id, { runtimeResumeToken: 'old-dsh', data: { parts: [], nativeSessionId: 'edited-dsh' } })
    const before = dbh.db.select().from(agentSessionMessageTable).all()

    new SeedRunner(dbh.db).runAll(upgradeSeeders)

    const migration = getRetiredAgentSessionMigration(dbh.db, id)!
    expect(migration).toBeDefined()
    expect(dbh.db.select().from(agentSessionContextTable).all()).toMatchObject([
      { sessionId: id, intendedThreadId: migration.resumeToken, nativeThreadId: null }
    ])
    expect(dbh.db.select().from(agentSessionMessageTable).all()).toEqual(before)
  })

  it('does not assume other harnesses or orphaned histories have Pi identities', () => {
    for (const type of ['dsh', 'codex', null]) {
      message(session(type), { runtimeResumeToken: 'unknown-native', data: { parts: [], nativeSessionId: 'edit' } })
    }
    const before = dbh.db.select().from(agentSessionMessageTable).all()
    seeder.run(dbh.db)
    expect(dbh.db.select().from(agentRuntimeBackendTable).all()).toEqual([])
    expect(dbh.db.select().from(agentSessionContextTable).all()).toEqual([])
    expect(dbh.db.select().from(agentSessionMessageTable).all()).toEqual(before)
  })
})
