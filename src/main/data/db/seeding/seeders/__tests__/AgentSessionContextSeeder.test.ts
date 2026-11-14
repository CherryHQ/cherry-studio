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
import { agentSessionService } from '@data/services/AgentSessionService'
import { getRetiredAgentSessionMigration } from '@data/services/retiredAgentRuntimeMigration'

import { AgentSessionContextSeeder } from '../AgentSessionContextSeeder'
import { AgentSessionRuntimeSeeder } from '../AgentSessionRuntimeSeeder'
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
    expect(contexts.map((row) => row.nativeThreadId).sort()).toEqual(['edited-pi', 'original-pi'])
    expect(contexts.every((row) => row.sessionId === id && row.bindingState === 'pending')).toBe(true)
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
      .set({ bindingState: 'bound', nativeThreadId: 'retained-pi' })
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
      WHEN NEW.native_thread_id = 'edited-pi' BEGIN SELECT RAISE(ABORT, 'context write failed'); END`)
    try {
      expect(() => new SeedRunner(dbh.db).runAll(upgradeSeeders)).toThrow('context write failed')
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
      { sessionId: id, nativeThreadId: migration.resumeToken, bindingState: 'pending' }
    ])
    expect(dbh.db.select().from(agentSessionMessageTable).all()).toEqual(before)
  })

  it('preserves Claude history after reassignment to a Pi Agent', () => {
    const id = session('claude-code')
    const piAgentId = session('pi')
    const nativeId = randomUUID()
    const backendId = randomUUID()
    dbh.db
      .insert(agentRuntimeBackendTable)
      .values({
        id: backendId,
        locator: { version: 1, kind: 'claude-code', configDir: '/claude' },
        state: 'bound'
      })
      .run()
    dbh.db
      .insert(agentSessionContextTable)
      .values({
        sessionId: id,
        backendId,
        nativeThreadId: nativeId,
        bindingState: 'bound'
      })
      .run()
    message(id, { role: 'assistant', runtimeResumeToken: nativeId })
    dbh.db.update(agentSessionTable).set({ agentId: piAgentId }).where(eq(agentSessionTable.id, id)).run()
    const originalContexts = dbh.db.select().from(agentSessionContextTable).all()
    const originalBackends = dbh.db.select().from(agentRuntimeBackendTable).all()
    const originalMessages = dbh.db.select().from(agentSessionMessageTable).all()

    new SeedRunner(dbh.db).runAll(upgradeSeeders)
    new AgentSessionRuntimeSeeder().run(dbh.db)

    expect(dbh.db.select().from(agentSessionContextTable).all()).toEqual(originalContexts)
    expect(dbh.db.select().from(agentRuntimeBackendTable).all()).toEqual(originalBackends)
    expect(dbh.db.select().from(agentSessionMessageTable).all()).toEqual(originalMessages)
    expect(agentSessionService.getRuntimeTypeTx(dbh.db, id)).toBe('claude-code')
    expect(journal()?.value).toEqual({ version: seeder.version })
  })

  it.each(['claude-code', 'pi-durable', 'unknown'])(
    'does not reinterpret tokens under a persisted %s session binding as Pi',
    (runtimeType) => {
      const id = session('pi')
      dbh.db.update(agentSessionTable).set({ runtimeType }).where(eq(agentSessionTable.id, id)).run()
      message(id, { runtimeResumeToken: 'existing-native-identity' })

      seeder.run(dbh.db)

      expect(dbh.db.select().from(agentSessionContextTable).all()).toEqual([])
      expect(dbh.db.select().from(agentRuntimeBackendTable).all()).toEqual([])
      expect(dbh.db.select().from(agentSessionTable).where(eq(agentSessionTable.id, id)).get()?.runtimeType).toBe(
        runtimeType
      )
    }
  )

  it('backfills a pinned Pi session after its Agent has been normalized to Durable', () => {
    const id = session('pi-durable')
    dbh.db.update(agentSessionTable).set({ runtimeType: 'pi' }).where(eq(agentSessionTable.id, id)).run()
    message(id, { runtimeResumeToken: 'preserved-pi' })
    dbh.db
      .insert(appStateTable)
      .values({ key: `seed:${seeder.name}`, value: { version: '1' } })
      .run()

    new SeedRunner(dbh.db).runAll(upgradeSeeders)
    new SeedRunner(dbh.db).runAll(upgradeSeeders)

    const rows = dbh.db
      .select({ context: agentSessionContextTable, backend: agentRuntimeBackendTable })
      .from(agentSessionContextTable)
      .innerJoin(agentRuntimeBackendTable, eq(agentSessionContextTable.backendId, agentRuntimeBackendTable.id))
      .all()
    expect(rows).toEqual([
      expect.objectContaining({
        context: expect.objectContaining({ sessionId: id, nativeThreadId: 'preserved-pi' }),
        backend: expect.objectContaining({ locator: { version: 1, kind: 'pi' } })
      })
    ])
    expect(journal()?.value).toEqual({ version: seeder.version })
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
