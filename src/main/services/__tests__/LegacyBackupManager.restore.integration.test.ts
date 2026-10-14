import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { setupTestDatabase } from '@test-helpers/db'
import { resolveMigrationsPath } from '@test-helpers/db/internal/migrationsPath'
import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import { checkpointTruncateAssert } from '@data/db/restore/checkpoint'
import { hashDbFile } from '@data/db/restore/hashDbFile'
import { readRestoreJournal, removeRestoreJournal } from '@data/db/restore/restoreJournal'
import { runRestorePromotion } from '@data/db/restore/restorePromotion'
import { agentTable } from '@data/db/schemas/agent'
import { agentSessionTable } from '@data/db/schemas/agentSession'
import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import { userModelTable } from '@data/db/schemas/userModel'
import { userProviderTable } from '@data/db/schemas/userProvider'
import { agentSessionMessageService } from '@data/services/AgentSessionMessageService'
import { AgentLifecycleService } from '@main/ai/agents/AgentLifecycleService'
import { AgentSessionRuntimeService } from '@main/ai/agentSession/AgentSessionRuntimeService'
import { runtimeDriverRegistry } from '@main/ai/runtime/registry'
import type { AgentRuntimeConnection } from '@main/ai/runtime/types'
import { BaseService } from '@main/core/lifecycle/BaseService'

import { BackupManager } from '../LegacyBackupManager'

const MESSAGE_ID = '018f6ed6-73b8-7f40-8d0d-9bb2f8f1d100'

describe('restore with Agent runtime activity', () => {
  const dbh = setupTestDatabase()
  let runtime: AgentSessionRuntimeService
  let backup: BackupManager
  let extractionDir: string
  let livePath: string

  beforeEach(async () => {
    BaseService.resetInstances()
    runtime = new AgentSessionRuntimeService()
    const lifecycle = new AgentLifecycleService()
    backup = new BackupManager()
    livePath = dbh.sqlite.name
    const userData = dirname(livePath)
    extractionDir = join(userData, 'archive')
    const paths: Record<string, string> = {
      'app.userdata': userData,
      'app.userdata.data': userData,
      'app.database.migrations': resolveMigrationsPath(),
      'feature.backup.restore.file': join(userData, 'restore-journal.json'),
      'feature.backup.restore.staging': join(userData, 'restore-staging')
    }
    vi.spyOn(application, 'getPath').mockImplementation((key, filename) => {
      const base = key === 'app.database.file' ? livePath : paths[key]
      if (!base) throw new Error(`Unexpected path: ${key}`)
      return filename ? join(base, filename) : base
    })
    const drained = async () => ({ stragglerIds: [] })
    const pause = () => ({ dispose() {} })
    const services: Record<string, unknown> = {
      AgentSessionRuntimeService: runtime,
      AgentLifecycleService: lifecycle,
      AgentSessionDeliveryService: { pause, drainInFlight: drained, listActiveWork: () => [] },
      ChannelManager: { pause, drainInFlight: drained, listActiveWork: () => [] },
      AgentJobsService: { pause, drainInFlight: drained },
      JobManager: { pause, drainInFlight: async () => ({ stragglerIds: [], startupRecoveryPending: false }) },
      AiStreamManager: { pause, drainInFlight: drained, hasLiveStreams: () => false }
    }
    const container = application.getContainer()
    const get = container.get.bind(container)
    vi.spyOn(container, 'get').mockImplementation(
      ((name: string) => services[name] ?? get(name)) as typeof container.get
    )
    vi.spyOn(application.get('DbService'), 'checkpointTruncate').mockImplementation(() =>
      checkpointTruncateAssert(dbh.sqlite)
    )

    dbh.sqlite.pragma('journal_mode = WAL')
    dbh.db
      .insert(agentTable)
      .values({ id: 'agent', type: 'claude-code', name: 'Original', instructions: '', orderKey: 'a0' })
      .run()
    dbh.db
      .insert(agentWorkspaceTable)
      .values({ id: 'workspace', name: 'Workspace', path: userData, type: 'user', orderKey: 'a0' })
      .run()
    dbh.db
      .insert(agentSessionTable)
      .values({ id: 'session', agentId: 'agent', workspaceId: 'workspace', name: 'Session', orderKey: 'a0' })
      .run()
    agentSessionMessageService.saveMessage({
      sessionId: 'session',
      message: { id: MESSAGE_ID, role: 'assistant', status: 'success', data: { parts: [] } }
    })
    mkdirSync(join(extractionDir, 'Data'), { recursive: true })
    await dbh.sqlite.backup(join(extractionDir, 'Data', 'test.db'))
    const archived = new Database(join(extractionDir, 'Data', 'test.db'))
    archived.prepare('UPDATE agent SET name = ? WHERE id = ?').run('Restored', 'agent')
    archived.close()
    writeFileSync(join(extractionDir, 'cache.json'), '{}')
    writeFileSync(
      join(extractionDir, 'metadata.json'),
      JSON.stringify({
        appName: 'Cherry Studio',
        version: 7,
        platform: process.platform,
        resources: { cache: true, database: false, appClaude: false, data: true, indexedDB: false, localStorage: false }
      })
    )
  })

  afterEach(async () => {
    await runtime['onStop']()
    Object.assign(application, { isQuitting: false })
    runtimeDriverRegistry.clearForTest()
    removeRestoreJournal()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  async function retainOutput(close: () => Promise<void> = async () => {}) {
    runtime.beginTurn({
      sessionId: 'session',
      topicId: 'agent-session:session',
      agentId: 'agent',
      agentType: 'claude-code',
      modelId: 'claude-code::claude-sonnet-4-5',
      assistantMessageId: MESSAGE_ID
    })
    const entry = runtime['entries'].get('session')!
    entry.runtimeState.connection = {
      kind: 'connected',
      connection: { close } as AgentRuntimeConnection,
      occupancy: { background: { responder: 'interactive', awaitingReply: false } }
    }
    runtime.markTurnTerminal('session', 'success')
    runtime['enqueueBackgroundFlowChunk'](entry, MESSAGE_ID, { type: 'text-start', id: 'detached' })
    runtime['enqueueBackgroundFlowChunk'](entry, MESSAGE_ID, {
      type: 'text-delta',
      id: 'detached',
      delta: 'Retained output'
    })
    runtime['enqueueBackgroundFlowChunk'](entry, MESSAGE_ID, { type: 'text-end', id: 'detached' })
    await vi.waitFor(() => expect(entry.backgroundFlowAccumulators?.get(MESSAGE_ID)?.latest?.parts).toHaveLength(1))
    expect(runtime.listActiveWork()).toEqual([])
    return entry.backgroundFlowAccumulators!.get(MESSAGE_ID)!
  }

  it('promotes the backup after relaunch cleanup without changing the staged fingerprint', async () => {
    await retainOutput()
    await backup['restoreDirect'](extractionDir)
    const journal = readRestoreJournal()
    expect(journal.kind).toBe('ok')
    if (journal.kind !== 'ok') throw new Error('Restore journal missing')
    await runtime['onStop']()
    checkpointTruncateAssert(dbh.sqlite)
    expect(await hashDbFile(livePath)).toBe(journal.journal.db.fingerprint)
    expect(agentSessionMessageService.getSessionMessage('session', MESSAGE_ID).data.parts).toEqual([
      expect.objectContaining({ type: 'text', text: 'Retained output' })
    ])

    // Model the next process with a sealed copy so the harness keeps its own connection.
    const bootPath = join(dirname(livePath), 'boot.db')
    copyFileSync(livePath, bootPath)
    livePath = bootPath
    await runRestorePromotion()
    const promoted = new Database(livePath, { readonly: true })
    try {
      expect(promoted.prepare('SELECT name FROM agent WHERE id = ?').get('agent')).toEqual({ name: 'Restored' })
      expect(readRestoreJournal()).toMatchObject({ kind: 'ok', journal: { state: 'completed' } })
    } finally {
      promoted.close()
    }
  })

  it.each([false, true])('waits for retained output before staging (timeout=%s)', async (timesOut) => {
    const closing = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    const accumulator = await retainOutput(async () => closing.resolve())
    accumulator.done = Promise.all([accumulator.done, release.promise]).then(() => undefined)
    vi.useFakeTimers()
    const restore = backup['restoreDirect'](extractionDir)
    const outcome = restore.then(
      () => undefined,
      (error: Error) => error
    )
    try {
      await closing.promise
      expect(readRestoreJournal()).toEqual({ kind: 'none' })
      if (timesOut) {
        await vi.advanceTimersByTimeAsync(30_000)
        expect(await outcome).toMatchObject({
          message: expect.stringContaining('Background data writes did not quiesce')
        })
        expect(readRestoreJournal()).toEqual({ kind: 'none' })
        expect(runtime.isWriteQuiesced).toBe(false)
      } else {
        release.resolve()
        expect(await outcome).toBeUndefined()
        expect(readRestoreJournal()).toMatchObject({ kind: 'ok', journal: { state: 'staged' } })
        expect(agentSessionMessageService.getSessionMessage('session', MESSAGE_ID).data.parts).toEqual([
          expect.objectContaining({ type: 'text', text: 'Retained output' })
        ])
      }
    } finally {
      release.resolve()
      await restore.catch(() => {})
    }
  })

  function preparePrewarm(traceId: string | null = null) {
    dbh.db.insert(userProviderTable).values({ providerId: 'claude-code', name: 'Test', orderKey: 'a0' }).run()
    dbh.db
      .insert(userModelTable)
      .values({
        id: 'claude-code::claude-sonnet-4-5',
        providerId: 'claude-code',
        modelId: 'claude-sonnet-4-5',
        name: 'Test',
        capabilities: [],
        supportsStreaming: true,
        orderKey: 'a0'
      })
      .run()
    dbh.db.update(agentTable).set({ model: 'claude-code::claude-sonnet-4-5' }).run()
    dbh.db.update(agentSessionTable).set({ traceId }).run()
    runtimeDriverRegistry.register({
      type: 'claude-code',
      capabilities: ['agent-session'],
      validateSession: () => {},
      listAvailableTools: async () => [],
      connect: async () => {
        throw new Error('No external runtime needed for this database admission test')
      }
    })
  }

  it.each([null, 'a'.repeat(32)])(
    'keeps a staged restore valid during pending cleanup (traceId=%s)',
    async (traceId) => {
      preparePrewarm(traceId)
      await backup['restoreDirect'](extractionDir)
      const journal = readRestoreJournal()
      if (journal.kind !== 'ok') throw new Error('Restore journal missing')
      expect(runtime.isWriteQuiesced).toBe(true)
      expect(dbh.db.select({ traceId: agentSessionTable.traceId }).from(agentSessionTable).get()?.traceId).toBe(traceId)
      const cleanup = Promise.withResolvers<void>()
      vi.spyOn(runtime['forks'], 'cancel').mockReturnValue(cleanup.promise)
      const stopping = runtime['onStop']()
      try {
        runtime.acquireWarmLease('session', undefined)
        await runtime.primeConnection('session')
      } finally {
        cleanup.resolve()
        await stopping
      }
      await runtime.drainInFlight({ timeoutMs: 5000 })
      checkpointTruncateAssert(dbh.sqlite)
      expect
        .soft(dbh.db.select({ traceId: agentSessionTable.traceId }).from(agentSessionTable).get()?.traceId)
        .toBe(traceId)
      expect.soft(await hashDbFile(livePath)).toBe(journal.journal.db.fingerprint)
      const bootPath = join(dirname(livePath), 'boot.db')
      copyFileSync(livePath, bootPath)
      livePath = bootPath
      await runRestorePromotion()
      const promoted = new Database(livePath, { readonly: true })
      try {
        expect.soft(promoted.prepare('SELECT name FROM agent WHERE id = ?').get('agent')).toEqual({ name: 'Restored' })
        expect.soft(readRestoreJournal()).toMatchObject({ kind: 'ok', journal: { state: 'completed' } })
      } finally {
        promoted.close()
      }
    }
  )

  it.each(['application', 'runtime'] as const)('rejects prewarm after %s shutdown starts', async (owner) => {
    preparePrewarm()
    if (owner === 'application') {
      // Application marks quitting before earlier services finish stopping.
      Object.assign(application, { isQuitting: true })
    } else {
      await runtime['onStop']()
    }
    runtime.acquireWarmLease('session', undefined)
    await runtime.primeConnection('session')
    expect(dbh.db.select({ traceId: agentSessionTable.traceId }).from(agentSessionTable).get()?.traceId).toBeNull()
  })

  it('allows prewarm again after a restore pause is released', async () => {
    preparePrewarm()
    const hold = runtime.pause('restore')
    runtime.acquireWarmLease('session', undefined)
    await runtime.primeConnection('session')
    expect(dbh.db.select({ traceId: agentSessionTable.traceId }).from(agentSessionTable).get()?.traceId).toBeNull()
    hold.dispose()
    runtime.acquireWarmLease('session', undefined)
    await runtime.primeConnection('session')
    expect(dbh.db.select({ traceId: agentSessionTable.traceId }).from(agentSessionTable).get()?.traceId).toMatch(
      /^[\da-f]{32}$/
    )
  })
})
