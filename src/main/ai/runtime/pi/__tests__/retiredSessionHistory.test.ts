import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { SessionManager } from '@earendil-works/pi-coding-agent'
import { setupTestDatabase } from '@test-helpers/db'
import { MockMainDbServiceUtils } from '@test-mocks/main/DbService'
import Database from 'better-sqlite3'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import { agentTable } from '@data/db/schemas/agent'
import { agentSessionTable } from '@data/db/schemas/agentSession'
import { agentSessionMessageTable } from '@data/db/schemas/agentSessionMessage'
import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import { userModelTable } from '@data/db/schemas/userModel'
import { userProviderTable } from '@data/db/schemas/userProvider'
import { RetiredAgentRuntimeSeeder } from '@data/db/seeding/seeders/retiredAgentRuntimeSeeder'
import { SeedRunner } from '@data/db/seeding/SeedRunner'
import * as runtimeMigration from '@data/services/retiredAgentRuntimeMigration'
import {
  getRetiredAgentSessionMigration,
  listRetiredAgentSessionMigrations
} from '@data/services/retiredAgentRuntimeMigration'
import { AgentSessionRuntimeService } from '@main/ai/agentSession/AgentSessionRuntimeService'
import { AgentSessionForkOperations } from '@main/ai/agentSession/fork/AgentSessionForkOperations'
import { AsyncEventQueue } from '@main/ai/runtime/AsyncEventQueue'
import { RuntimeForkAnchorSchema } from '@main/ai/runtime/fork'
import { runtimeDriverRegistry } from '@main/ai/runtime/registry'
import type { AgentRuntimeConnectInput, AgentRuntimeEvent } from '@main/ai/runtime/types'
import { BaseService } from '@main/core/lifecycle'
import { BROWSER_TOOL_GROUP } from '@shared/ai/browserTools'

import { forkPiSession } from '../piFork'
import { PiRuntimeConnection } from '../PiRuntimeConnection'
import { PiRuntimeDriver } from '../PiRuntimeDriver'
import { resolveResumeTokenSessionFile } from '../piSessionFile'
import { ensureRetiredSessionHistory, migrateRetiredSessionHistories } from '../retiredSessionHistory'

describe('retired DSH session migration', () => {
  const dbh = setupTestDatabase()
  let directory: string
  const seeder = new RetiredAgentRuntimeSeeder()

  beforeEach(() => {
    directory = mkdtempSync(path.join(tmpdir(), 'cherry-runtime-migration-'))
    vi.mocked(application.getPath).mockImplementation((key, filename) =>
      path.join(directory, key === 'feature.agents.forks' ? 'forks' : 'sessions', filename ?? '')
    )
    dbh.db
      .insert(userProviderTable)
      .values({ providerId: 'legacy-provider', name: 'Preserved provider', orderKey: 'a0' })
      .run()
    dbh.db
      .insert(userModelTable)
      .values({
        id: 'legacy-provider::legacy-model',
        providerId: 'legacy-provider',
        modelId: 'legacy-model',
        name: 'Original model',
        capabilities: [],
        supportsStreaming: true,
        orderKey: 'a0'
      })
      .run()
    dbh.db
      .insert(agentTable)
      .values([
        {
          id: 'legacy',
          type: 'dsh',
          name: 'Existing agent',
          instructions: 'Keep this instruction',
          model: 'legacy-provider::legacy-model',
          orderKey: 'a0',
          configuration: { permission_mode: 'plan', language: 'zh-cn' },
          disabledTools: ['read', 'read_image', 'pwsh', 'subagent', 'mcp__server__tool']
        },
        {
          id: 'archived',
          type: 'dsh',
          name: 'Archived agent',
          instructions: '',
          orderKey: 'a1',
          deletedAt: 100,
          configuration: { permission_mode: 'bypassPermissions' }
        },
        { id: 'untouched', type: 'pi', name: 'Pi agent', instructions: '', orderKey: 'a2' }
      ])
      .run()
    dbh.db
      .insert(agentWorkspaceTable)
      .values({ id: 'workspace', name: 'Workspace', path: directory, type: 'user', orderKey: 'a0' })
      .run()
    dbh.db
      .insert(agentSessionTable)
      .values([
        {
          id: 'conversation',
          name: 'Old conversation',
          workspaceId: 'workspace',
          agentId: 'legacy',
          orderKey: 'a0',
          lastActivityAt: 100
        },
        { id: 'empty', name: 'Empty conversation', workspaceId: 'workspace', agentId: 'legacy', orderKey: 'a1' },
        {
          id: 'archived-session',
          name: 'Archived conversation',
          workspaceId: 'workspace',
          agentId: 'archived',
          orderKey: 'a2',
          deletedAt: 100
        }
      ])
      .run()
    dbh.db
      .insert(agentSessionMessageTable)
      .values([
        {
          id: 'user-1',
          sessionId: 'conversation',
          role: 'user',
          status: 'success',
          createdAt: 10,
          data: {
            nativeSessionId: 'old-edit-id',
            parts: [
              { type: 'text', text: 'Remember the migration marker: cherry-pi-928.' },
              { type: 'file', mediaType: 'text/plain', filename: 'notes.txt', url: 'file:///tmp/cherry-notes.txt' }
            ]
          },
          runtimeResumeToken: 'old-dsh-token'
        },
        {
          id: 'assistant-1',
          sessionId: 'conversation',
          role: 'assistant',
          status: 'success',
          createdAt: 20,
          data: {
            runtimeAnchor: { checkpoint: { runtime: 'dsh', runtimeSessionId: 'old-dsh-token', boundary: 1 } },
            parts: [
              { type: 'text', text: 'The marker is cherry-pi-928.' },
              {
                type: 'dynamic-tool',
                toolName: 'bash',
                toolCallId: 'old-tool',
                state: 'output-available',
                input: { command: 'touch forbidden-replay' },
                output: 'finished previously'
              }
            ]
          },
          runtimeResumeToken: 'old-dsh-token'
        },
        {
          id: 'user-2',
          sessionId: 'conversation',
          role: 'user',
          status: 'success',
          createdAt: 30,
          data: { parts: [{ type: 'text', text: 'Second turn' }] }
        },
        {
          id: 'assistant-2',
          sessionId: 'conversation',
          role: 'assistant',
          status: 'success',
          createdAt: 40,
          data: { parts: [{ type: 'text', text: 'Second response' }] },
          runtimeResumeToken: 'old-dsh-token'
        }
      ])
      .run()
  })

  afterEach(() => {
    vi.mocked(application.getPath).mockReset()
    rmSync(directory, { recursive: true, force: true })
  })

  it.each(['dispatch', 'prewarm'])(
    'retains imported context and resume identity after %s retries migration',
    async (retry) => {
      BaseService.resetInstances()
      seeder.run(dbh.db)
      const migration = getRetiredAgentSessionMigration(dbh.db, 'conversation')!
      const sessions = path.join(directory, 'sessions')
      writeFileSync(sessions, 'blocked history directory')
      await migrateRetiredSessionHistories()

      const events = new AsyncEventQueue<AgentRuntimeEvent>()
      const contexts: string[] = []
      const start = vi
        .spyOn(PiRuntimeConnection.prototype, 'start')
        .mockImplementation(async function (this: PiRuntimeConnection) {
          const input = (this as unknown as { input: AgentRuntimeConnectInput }).input
          const file = resolveResumeTokenSessionFile(input.resumeToken!, sessions)
          const manager = file
            ? SessionManager.open(file, sessions, directory)
            : SessionManager.inMemory(directory, { id: input.resumeToken })
          contexts.push(JSON.stringify(manager.buildContextEntries()))
          return Object.assign(this, { events, send: () => {}, close: () => events.close() })
        })
      const runtime = new AgentSessionRuntimeService()
      runtimeDriverRegistry.register(new PiRuntimeDriver())
      try {
        await runtime.primeConnection('conversation')
        expect(getRetiredAgentSessionMigration(dbh.db, 'conversation')).toEqual(migration)
        expect(contexts).toEqual([])

        rmSync(sessions)
        mkdirSync(sessions)
        if (retry === 'dispatch') await ensureRetiredSessionHistory('conversation')
        await runtime.primeConnection('conversation')
        await vi.waitFor(() => expect(contexts[0]).toContain('cherry-pi-928'))
        expect(runtime.inspect('conversation')?.resumeToken).toBe(migration.resumeToken)
        expect(getRetiredAgentSessionMigration(dbh.db, 'conversation')).toBeUndefined()
      } finally {
        await runtime.closeSession('conversation')
        start.mockRestore()
        runtimeDriverRegistry.clearForTest()
      }
    }
  )

  it('converts active and archived agents while preserving identity, permissions, workspace and history', () => {
    const original = dbh.db.select().from(agentTable).where(eq(agentTable.id, 'legacy')).get()!
    new SeedRunner(dbh.db).runAll([seeder])
    const migrated = dbh.db.select().from(agentTable).where(eq(agentTable.id, 'legacy')).get()!
    expect(migrated.updatedAt).toBe(original.updatedAt)
    expect(migrated.model).toBe('legacy-provider::legacy-model')
    expect(migrated).toMatchObject({
      type: 'pi',
      name: 'Existing agent',
      instructions: 'Keep this instruction',
      configuration: { permission_mode: 'default', language: 'zh-cn' },
      disabledTools: ['read', 'bash', 'legacy-dsh:mcp__server__tool']
    })
    expect(dbh.db.select().from(agentTable).where(eq(agentTable.id, 'archived')).get()).toMatchObject({
      type: 'pi',
      deletedAt: 100,
      configuration: { permission_mode: 'bypassPermissions' }
    })
    expect(dbh.db.select().from(agentSessionTable).where(eq(agentSessionTable.id, 'conversation')).get()).toMatchObject(
      { agentId: 'legacy', workspaceId: 'workspace', lastActivityAt: 100 }
    )
    expect(
      dbh.db.select().from(agentSessionMessageTable).where(eq(agentSessionMessageTable.id, 'assistant-1')).get()
        ?.runtimeResumeToken
    ).toBe('old-dsh-token')
    expect(listRetiredAgentSessionMigrations(dbh.db)).toHaveLength(3)
    const journal = listRetiredAgentSessionMigrations(dbh.db)
    new SeedRunner(dbh.db).runAll([seeder])
    expect(listRetiredAgentSessionMigrations(dbh.db)).toEqual(journal)
  })

  it('persists resumable context, attachments and inert tool history and regenerates historical fork boundaries', async () => {
    seeder.run(dbh.db)
    const migration = getRetiredAgentSessionMigration(dbh.db, 'conversation')!
    await ensureRetiredSessionHistory('conversation')
    const file = resolveResumeTokenSessionFile(migration.resumeToken, path.join(directory, 'sessions'))!
    const manager = SessionManager.open(file, path.dirname(file), directory)
    expect(manager.getSessionId()).toBe(migration.resumeToken)
    const serialized = JSON.stringify(manager.buildContextEntries())
    expect(serialized).toContain('cherry-pi-928')
    expect(serialized).toContain('/tmp/cherry-notes.txt')
    expect(serialized).toContain('finished previously')
    expect(serialized).not.toContain('"type":"toolCall"')
    expect(existsSync(path.join(directory, 'forbidden-replay'))).toBe(false)
    const row = dbh.db
      .select()
      .from(agentSessionMessageTable)
      .where(eq(agentSessionMessageTable.id, 'assistant-1'))
      .get()!
    expect(row.runtimeResumeToken).toBe(migration.resumeToken)
    expect(getRetiredAgentSessionMigration(dbh.db, 'conversation')).toBeUndefined()
    expect(
      dbh.db.select().from(agentSessionMessageTable).where(eq(agentSessionMessageTable.id, 'user-1')).get()?.data
        .nativeSessionId
    ).toBeUndefined()
    const checkpoint = (
      row.data.runtimeAnchor as { checkpoint: { runtime: string; runtimeSessionId: string; leafId: string } }
    ).checkpoint
    expect(checkpoint).toMatchObject({ runtime: 'pi', runtimeSessionId: migration.resumeToken })
    const artifactDirectory = path.join(directory, 'fork-artifacts')
    mkdirSync(artifactDirectory)
    const forked = await forkPiSession({
      sourceSessionId: 'conversation',
      checkpoint,
      checkpoints: [checkpoint],
      targetSessionId: 'child',
      targetCwd: directory,
      artifactDirectory,
      signal: new AbortController().signal
    })
    const fork = SessionManager.open(forked.publish[0].source, path.dirname(forked.publish[0].source), directory)
    const forkContext = JSON.stringify(fork.buildContextEntries())
    expect(forkContext).toContain('cherry-pi-928')
    expect(forkContext).not.toContain('Second response')
    const before = readFileSync(file, 'utf8')
    await ensureRetiredSessionHistory('conversation')
    expect(readFileSync(file, 'utf8')).toBe(before)
  })

  it('preserves the browser capability opt-out instead of requiring legacy tool repair', () => {
    dbh.db
      .update(agentTable)
      .set({ disabledTools: [BROWSER_TOOL_GROUP] })
      .where(eq(agentTable.id, 'legacy'))
      .run()
    seeder.run(dbh.db)
    expect(dbh.db.select().from(agentTable).where(eq(agentTable.id, 'legacy')).get()?.disabledTools).toEqual([
      BROWSER_TOOL_GROUP
    ])
  })

  it('preserves mixed-case native restrictions and case-sensitive MCP identities under bypass permissions', () => {
    dbh.db
      .update(agentTable)
      .set({
        configuration: { permission_mode: 'bypassPermissions' },
        disabledTools: ['Bash', 'Write', 'READ', 'Edit', 'Read_Image', 'PwSh', 'mcp__Server__Tool']
      })
      .where(eq(agentTable.id, 'legacy'))
      .run()
    seeder.run(dbh.db)
    expect(dbh.db.select().from(agentTable).where(eq(agentTable.id, 'legacy')).get()).toMatchObject({
      configuration: { permission_mode: 'bypassPermissions' },
      disabledTools: ['bash', 'write', 'read', 'edit', 'legacy-dsh:mcp__Server__Tool']
    })
  })

  it.each([false, true])('preserves queued turn boundaries when the later turn completed: %s', async (completed) => {
    dbh.db
      .update(agentSessionMessageTable)
      .set({
        data: {
          parts: [{ type: 'text', text: 'Second response' }],
          runtimeAnchor: {
            checkpoint: { runtime: 'dsh', runtimeSessionId: 'old-dsh-token', boundary: 2 },
            excludedMessageIds: ['user-3']
          }
        }
      })
      .where(eq(agentSessionMessageTable.id, 'assistant-2'))
      .run()
    dbh.db
      .insert(agentSessionMessageTable)
      .values({
        id: 'user-3',
        sessionId: 'conversation',
        role: 'user',
        status: 'success',
        createdAt: 35,
        data: { parts: [{ type: 'text', text: 'Third queued prompt' }] }
      })
      .run()
    if (completed) {
      dbh.db
        .insert(agentSessionMessageTable)
        .values({
          id: 'assistant-3',
          sessionId: 'conversation',
          role: 'assistant',
          status: 'success',
          createdAt: 50,
          data: { parts: [{ type: 'text', text: 'Third response' }] }
        })
        .run()
    }
    seeder.run(dbh.db)
    await ensureRetiredSessionHistory('conversation')
    const row = dbh.db
      .select()
      .from(agentSessionMessageTable)
      .where(eq(agentSessionMessageTable.id, 'assistant-2'))
      .get()!
    const anchor = RuntimeForkAnchorSchema.parse(row.data.runtimeAnchor)
    expect(anchor.excludedMessageIds).toContain('user-3')
    const file = resolveResumeTokenSessionFile(row.runtimeResumeToken!, path.join(directory, 'sessions'))!
    const manager = SessionManager.open(file, path.dirname(file), directory)
    const markers = ['Second turn', 'Second response', 'Third queued prompt', 'Third response']
    const order = manager
      .buildContextEntries()
      .map((entry) => markers.find((marker) => JSON.stringify(entry).includes(marker)))
      .filter(Boolean)
    expect(order).toEqual(completed ? markers : markers.slice(0, 2))
    const artifactDirectory = path.join(directory, 'queued-fork')
    mkdirSync(artifactDirectory)
    const forked = await forkPiSession({
      sourceSessionId: 'conversation',
      checkpoint: anchor.checkpoint,
      checkpoints: [anchor.checkpoint],
      targetSessionId: 'child',
      targetCwd: directory,
      artifactDirectory,
      signal: new AbortController().signal
    })
    const fork = SessionManager.open(forked.publish[0].source, path.dirname(forked.publish[0].source), directory)
    const context = JSON.stringify(fork.buildContextEntries())
    expect(context).toContain('Second response')
    expect(context).not.toContain('Third queued prompt')
    expect(context).not.toContain('Third response')
  })

  it('retains the old native identity on filesystem failure and safely retries without duplicating history', async () => {
    seeder.run(dbh.db)
    writeFileSync(path.join(directory, 'sessions'), 'not a directory')
    await expect(ensureRetiredSessionHistory('conversation')).rejects.toThrow()
    expect(getRetiredAgentSessionMigration(dbh.db, 'conversation')).toBeDefined()
    expect(
      dbh.db.select().from(agentSessionMessageTable).where(eq(agentSessionMessageTable.id, 'assistant-1')).get()
        ?.runtimeResumeToken
    ).toBe('old-dsh-token')
    rmSync(path.join(directory, 'sessions'))
    await Promise.all([ensureRetiredSessionHistory('conversation'), ensureRetiredSessionHistory('conversation')])
    expect(getRetiredAgentSessionMigration(dbh.db, 'conversation')).toBeUndefined()
  })

  it('retries after a generated history file could not be committed to the database', async () => {
    seeder.run(dbh.db)
    const commit = vi.spyOn(runtimeMigration, 'commitRetiredAgentSessionMigration')
    commit.mockImplementationOnce(() => {
      throw new Error('interrupted before commit')
    })
    await expect(ensureRetiredSessionHistory('conversation')).rejects.toThrow('interrupted before commit')
    expect(getRetiredAgentSessionMigration(dbh.db, 'conversation')).toBeDefined()
    expect(
      dbh.db.select().from(agentSessionMessageTable).where(eq(agentSessionMessageTable.id, 'assistant-1')).get()
        ?.runtimeResumeToken
    ).toBe('old-dsh-token')
    commit.mockRestore()
    await ensureRetiredSessionHistory('conversation')
    const token = dbh.db
      .select()
      .from(agentSessionMessageTable)
      .where(eq(agentSessionMessageTable.id, 'assistant-1'))
      .get()!.runtimeResumeToken!
    const file = resolveResumeTokenSessionFile(token, path.join(directory, 'sessions'))!
    expect(SessionManager.open(file, path.dirname(file), directory).buildContextEntries()).toHaveLength(4)
  })

  it('does not commit stale history when database content changes during file generation', async () => {
    seeder.run(dbh.db)
    const migrating = ensureRetiredSessionHistory('conversation')
    dbh.db
      .update(agentSessionMessageTable)
      .set({ data: { parts: [{ type: 'text', text: 'Updated history' }] } })
      .where(eq(agentSessionMessageTable.id, 'user-1'))
      .run()
    await expect(migrating).rejects.toThrow('history changed')
    expect(getRetiredAgentSessionMigration(dbh.db, 'conversation')).toBeDefined()
    await ensureRetiredSessionHistory('conversation')
    const token = dbh.db
      .select()
      .from(agentSessionMessageTable)
      .where(eq(agentSessionMessageTable.id, 'assistant-1'))
      .get()!.runtimeResumeToken!
    const file = resolveResumeTokenSessionFile(token, path.join(directory, 'sessions'))!
    expect(JSON.stringify(SessionManager.open(file, path.dirname(file), directory).buildContextEntries())).toContain(
      'Updated history'
    )
  })

  it('keeps queued messages out of imported model context and historical fork boundaries', async () => {
    dbh.db
      .insert(agentSessionMessageTable)
      .values({
        id: 'queued',
        sessionId: 'conversation',
        role: 'user',
        status: 'pending',
        createdAt: 15,
        data: { parts: [{ type: 'text', text: 'Must wait for dispatch' }] }
      })
      .run()
    seeder.run(dbh.db)
    await ensureRetiredSessionHistory('conversation')
    const row = dbh.db
      .select()
      .from(agentSessionMessageTable)
      .where(eq(agentSessionMessageTable.id, 'assistant-1'))
      .get()!
    const file = resolveResumeTokenSessionFile(row.runtimeResumeToken!, path.join(directory, 'sessions'))!
    expect(
      JSON.stringify(SessionManager.open(file, path.dirname(file), directory).buildContextEntries())
    ).not.toContain('Must wait for dispatch')
    expect(row.data.runtimeAnchor).toMatchObject({ excludedMessageIds: ['queued'] })
    expect(
      dbh.db.select().from(agentSessionMessageTable).where(eq(agentSessionMessageTable.id, 'queued')).get()?.status
    ).toBe('pending')
  })

  it('retains published DSH fork files after replacing their recovery tokens and restarting recovery', async () => {
    const sessionId = randomUUID()
    dbh.db
      .insert(agentSessionTable)
      .values({ id: sessionId, name: 'Published fork', agentId: 'legacy', workspaceId: 'workspace', orderKey: 'a3' })
      .run()
    dbh.db
      .insert(agentSessionMessageTable)
      .values({
        sessionId,
        role: 'assistant',
        status: 'success',
        runtimeResumeToken: 'published-old-token',
        data: { parts: [{ type: 'text', text: 'Forked history' }] }
      })
      .run()
    seeder.run(dbh.db)
    const operationId = randomUUID()
    const forks = path.join(directory, 'forks')
    const artifactDirectory = path.join(forks, operationId)
    mkdirSync(artifactDirectory, { recursive: true })
    const source = path.join(artifactDirectory, 'source.jsonl')
    const target = path.join(directory, 'original-dsh-history.jsonl')
    writeFileSync(source, 'original DSH native history')
    writeFileSync(target, 'original DSH native history')
    const journal = path.join(forks, `${operationId}.json`)
    writeFileSync(
      journal,
      JSON.stringify({
        version: 1,
        operationId,
        targetSessionId: sessionId,
        resumeToken: 'published-old-token',
        createdAt: Date.now(),
        artifactDirectory,
        published: [{ source, target }]
      })
    )
    await new AgentSessionForkOperations().recover()
    expect(existsSync(journal)).toBe(false)
    await ensureRetiredSessionHistory(sessionId)
    await new AgentSessionForkOperations().recover()
    expect(readFileSync(target, 'utf8')).toBe('original DSH native history')
    expect(readFileSync(source, 'utf8')).toBe('original DSH native history')
  })

  it('migrates a restored pre-removal backup through the same startup seeder', async () => {
    const backupFile = path.join(directory, 'old-backup.db')
    await dbh.sqlite.backup(backupFile)
    new SeedRunner(dbh.db).runAll([seeder])
    await migrateRetiredSessionHistories()
    const restoredSqlite = new Database(backupFile)
    const restored = drizzle({ client: restoredSqlite, casing: 'snake_case' })
    try {
      MockMainDbServiceUtils.setDb(restored)
      new SeedRunner(restored).runAll([seeder])
      await migrateRetiredSessionHistories()
      expect(restored.select().from(agentTable).where(eq(agentTable.id, 'legacy')).get()?.type).toBe('pi')
      expect(listRetiredAgentSessionMigrations(restored)).toEqual([])
      const message = restored
        .select()
        .from(agentSessionMessageTable)
        .where(eq(agentSessionMessageTable.id, 'assistant-1'))
        .get()!
      const file = resolveResumeTokenSessionFile(message.runtimeResumeToken!, path.join(directory, 'sessions'))!
      expect(JSON.stringify(SessionManager.open(file, path.dirname(file), directory).buildContextEntries())).toContain(
        'cherry-pi-928'
      )
    } finally {
      restoredSqlite.close()
      MockMainDbServiceUtils.setDb(dbh.db)
    }
  })

  it('completes empty and archived sessions without discarding their database records', async () => {
    seeder.run(dbh.db)
    await migrateRetiredSessionHistories()
    expect(listRetiredAgentSessionMigrations(dbh.db)).toEqual([])
    expect(dbh.db.select().from(agentSessionTable).all()).toHaveLength(3)
    expect(dbh.db.select().from(agentSessionMessageTable).all()).toHaveLength(4)
  })
})
