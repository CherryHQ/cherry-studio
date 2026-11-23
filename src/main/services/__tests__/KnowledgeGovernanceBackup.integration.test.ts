import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { resolveMigrationsPath } from '@test-helpers/db/internal/migrationsPath'
import { MockMainDbServiceUtils } from '@test-mocks/main/DbService'
import Database from 'better-sqlite3'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import StreamZip from 'node-stream-zip'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import { applyMigrations } from '@data/db/applyMigrations'
import { checkpointTruncateAssert } from '@data/db/restore/checkpoint'
import { readRestoreJournal } from '@data/db/restore/restoreJournal'
import { runRestorePromotion } from '@data/db/restore/restorePromotion'
import { knowledgeBaseTable, knowledgeItemTable } from '@data/db/schemas/knowledge'
import {
  knowledgeChunkGovernanceHistoryTable,
  knowledgeChunkGovernanceTable
} from '@data/db/schemas/knowledgeChunkGovernance'
import type { DbType } from '@data/db/types'
import { KnowledgeChunkGovernanceService } from '@data/services/KnowledgeChunkGovernanceService'
import type { PosixRelativeFilePath } from '@shared/utils/file'

import { BackupManager } from '../LegacyBackupManager'

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  const pause = () => ({ dispose: vi.fn() })
  const drain = async () => ({ stragglerIds: [], startupRecoveryPending: false })
  const overrides = {
    CacheService: { flushPersistForBackup: vi.fn() },
    AgentLifecycleService: {
      pauseIngress: pause,
      pauseExecution: pause,
      drainIngress: drain,
      drainInFlight: drain,
      listActiveWork: () => []
    },
    AiStreamManager: { pause, drainInFlight: drain, hasLiveStreams: () => false },
    JobManager: { pause, drainInFlight: drain },
    AgentJobsService: { pause, drainInFlight: async () => ({ settled: true }) }
  }
  return mockApplicationFactory(overrides)
})

describe('Knowledge governance through the real version 7 archive restore', () => {
  let root: string
  let sqlite: Database.Database | undefined
  let db: DbType
  const baseId = '11111111-1111-4111-8111-111111111111'
  const itemId = '22222222-2222-4222-8222-222222222222'
  const untouchedId = '33333333-3333-4333-8333-333333333333'
  const text = 'Original OCR é😀 with source evidence'
  const livePath = () => join(root, 'Data', 'cherrystudio.sqlite')
  const rawPath = () => join(root, 'Data', 'Knowledge', baseId, 'raw', 'source.md')
  const service = new KnowledgeChunkGovernanceService()
  const snapshot = () => ({
    bases: db.select().from(knowledgeBaseTable).all(),
    items: db.select().from(knowledgeItemTable).all(),
    records: db.select().from(knowledgeChunkGovernanceTable).all(),
    history: db.select().from(knowledgeChunkGovernanceHistoryTable).all()
  })
  const open = () => {
    sqlite = new Database(livePath())
    sqlite.pragma('foreign_keys = ON')
    sqlite.pragma('journal_mode = WAL')
    db = drizzle({ client: sqlite, casing: 'snake_case' })
    MockMainDbServiceUtils.setDb(db)
  }
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'cherry-governance-archive-'))
    mkdirSync(join(root, 'Data'), { recursive: true })
    vi.spyOn(application, 'getPath').mockImplementation((key, filename) => {
      const paths: Record<string, string> = {
        'app.userdata': root,
        'app.userdata.data': join(root, 'Data'),
        'app.database.file': livePath(),
        'app.database.migrations': resolveMigrationsPath(),
        'feature.backup.temp': join(root, 'backup-temp'),
        'feature.backup.restore.file': join(root, 'Data', 'restore-journal.json'),
        'feature.backup.restore.staging': join(root, 'restore-staging'),
        'feature.agents.claude.root': join(root, 'Data', 'Agents', '.claude')
      }
      if (!paths[key]) throw new Error(`Unexpected test path ${key}`)
      return (filename ? join(paths[key], filename) : paths[key]) as ReturnType<typeof application.getPath>
    })
    open()
    applyMigrations(db, resolveMigrationsPath())
    vi.spyOn(application.get('DbService'), 'checkpointTruncate').mockImplementation(() =>
      checkpointTruncateAssert(sqlite!)
    )
    writeFileSync(join(root, 'cache.json'), JSON.stringify({ source: 'backup-cache' }))
    mkdirSync(dirname(rawPath()), { recursive: true })
    writeFileSync(rawPath(), text)
    db.insert(knowledgeBaseTable)
      .values([
        { id: baseId, name: 'Governed', orderKey: 'a0', status: 'completed', chunkSize: 1024, chunkOverlap: 200 },
        { id: untouchedId, name: 'Untouched', orderKey: 'a1', status: 'completed', chunkSize: 1024, chunkOverlap: 200 }
      ])
      .run()
    db.insert(knowledgeItemTable)
      .values({
        id: itemId,
        baseId,
        type: 'note',
        status: 'completed',
        data: { source: 'Source', content: text, relativePath: 'raw/source.md' as PosixRelativeFilePath }
      })
      .run()
    const source = {
      baseId,
      itemId,
      unitId: 'a'.repeat(64),
      sourceContentHash: 'b'.repeat(64),
      charStart: 0,
      charEnd: text.length,
      originalText: text
    }
    const state = {
      excluded: true,
      labels: ['OCR', 'retained'],
      overrideText: 'A corrected retrieval view, not source bytes'
    }
    const retired = service.create(source, state)
    service.review({
      baseId,
      itemId,
      governanceId: retired.id,
      expectedRevision: 1,
      target: { source: { ...source, unitId: 'c'.repeat(64) }, expectedRevision: 0 }
    })
    const discarded = service.create(
      { ...source, unitId: 'd'.repeat(64) },
      { excluded: false, labels: ['discard history'], overrideText: null }
    )
    service.review({ baseId, itemId, governanceId: discarded.id, expectedRevision: 1 })
  })
  afterEach(() => {
    sqlite?.close()
    sqlite = undefined
    vi.restoreAllMocks()
    MockMainDbServiceUtils.resetMocks()
    rmSync(root, { recursive: true, force: true })
  })

  it.each([false, true])(
    'preserves complete decision ownership and history through archive, staging and promotion (slim=%s)',
    async (slim) => {
      const before = snapshot()
      const manager = new BackupManager()
      const archive = await manager.backup(null, 'governance.zip', join(root, 'exports'), slim)
      const zip = new StreamZip.async({ file: archive })
      try {
        const entries = Object.keys(await zip.entries())
        expect(entries).toContain('Data/cherrystudio.sqlite')
        expect(entries.some((p) => p.endsWith('-wal') || p.endsWith('-shm'))).toBe(false)
        expect(entries.includes(`Data/Knowledge/${baseId}/raw/source.md`)).toBe(!slim)
      } finally {
        await zip.close()
      }
      // Distinguish the captured archive from current live rows and files.
      db.delete(knowledgeChunkGovernanceTable).run()
      const liveBeforeRestore = snapshot()
      writeFileSync(rawPath(), 'changed after backup')
      writeFileSync(join(root, 'cache.json'), JSON.stringify({ source: 'later-cache' }))
      await manager.restore({} as Electron.IpcMainInvokeEvent, archive)
      expect(snapshot()).toEqual(liveBeforeRestore)
      expect(readFileSync(rawPath(), 'utf8')).toBe('changed after backup')
      const staged = readRestoreJournal()
      expect(staged.kind).toBe('ok')
      if (staged.kind !== 'ok') throw new Error('Expected staged journal')
      expect(staged.journal.state).toBe('staged')
      const stagedDb = new Database(join(root, staged.journal.db.promote), { readonly: true })
      try {
        const stagedOrm = drizzle({ client: stagedDb, casing: 'snake_case' })
        expect(stagedOrm.select().from(knowledgeChunkGovernanceTable).all()).toEqual(before.records)
        expect(stagedOrm.select().from(knowledgeChunkGovernanceHistoryTable).all()).toEqual(before.history)
      } finally {
        stagedDb.close()
      }
      sqlite!.close()
      sqlite = undefined
      await runRestorePromotion()
      expect(readRestoreJournal()).toMatchObject({ kind: 'ok', journal: { state: 'completed' } })
      open()
      expect(snapshot()).toEqual(before)
      expect(sqlite!.pragma('foreign_key_check')).toEqual([])
      expect(sqlite!.pragma('integrity_check', { simple: true })).toBe('ok')
      expect(service.listByBase(untouchedId)).toEqual([])
      const discarded = service.listByBase(baseId).find((row) => service.getDiscardedState(row) !== null)!
      service.restoreDiscard({ baseId, itemId, governanceId: discarded.id, expectedRevision: discarded.revision })
      expect(service.get(baseId, itemId, discarded.unitId)?.state.labels).toEqual(['discard history'])
      expect(service.readHistoryPage(baseId, itemId, discarded.unitId, { limit: 5 }).items[0].operation).toBe(
        'restore-discard'
      )
      expect(readFileSync(rawPath(), 'utf8')).toBe(slim ? 'changed after backup' : text)
      expect(JSON.parse(readFileSync(join(root, 'cache.json'), 'utf8'))).toEqual({ source: 'backup-cache' })
      expect(existsSync(join(root, 'restore-staging', staged.journal.restoreId))).toBe(false)
      db.delete(knowledgeItemTable).where(eq(knowledgeItemTable.id, itemId)).run()
      expect(db.select().from(knowledgeChunkGovernanceTable).all()).toEqual([])
      expect(db.select().from(knowledgeChunkGovernanceHistoryTable).all()).toEqual([])
      expect(db.select().from(knowledgeBaseTable).all()).toEqual(before.bases)
    }
  )
  it.each([false, true])(
    'does not overwrite newer live decisions when the promotion fingerprint expires (slim=%s)',
    async (slim) => {
      const manager = new BackupManager()
      const archive = await manager.backup(null, 'stale.zip', join(root, 'exports'), slim)
      await manager.restore({} as Electron.IpcMainInvokeEvent, archive)
      const before = snapshot()
      const discarded = service.listByBase(baseId).find((row) => service.getDiscardedState(row) !== null)!
      service.restoreDiscard({ baseId, itemId, governanceId: discarded.id, expectedRevision: discarded.revision })
      const newer = snapshot()
      expect(newer.history.length).toBe(before.history.length + 1)
      writeFileSync(rawPath(), 'newer live source')
      sqlite!.close()
      sqlite = undefined
      await runRestorePromotion()
      expect(readRestoreJournal()).toMatchObject({ kind: 'ok', journal: { state: 'expired' } })
      open()
      expect(snapshot()).toEqual(newer)
      expect(readFileSync(rawPath(), 'utf8')).toBe('newer live source')
      expect(sqlite!.pragma('foreign_key_check')).toEqual([])
    }
  )
})
