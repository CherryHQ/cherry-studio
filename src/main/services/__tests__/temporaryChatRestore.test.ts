import '@data/services/MessageService'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { setupTestDatabase } from '@test-helpers/db'
import { MockMainCacheServiceUtils } from '@test-mocks/main/CacheService'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import { fileEntryTable } from '@data/db/schemas/file'
import { chatMessageFileRefTable } from '@data/db/schemas/fileRelations'
import { topicTable } from '@data/db/schemas/topic'
import { TemporaryChatService } from '@main/ai/TemporaryChatService'
import { BaseService } from '@main/core/lifecycle'
import { hashDbFile } from '@main/data/db/restore/hashDbFile'
import * as journal from '@main/data/db/restore/restoreJournal'
import { FileManager } from '@main/services/file/FileManager'
import { BACKUP_BACKGROUND_TASKS_ERROR_CODE } from '@shared/types/backup'

import { BackupManager } from '../LegacyBackupManager'

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory()
})

describe('temporary chat promotion during restore', () => {
  const dbh = setupTestDatabase()
  let temporary: TemporaryChatService
  let manager: FileManager
  let backup: BackupManager
  let extraction: string
  let directory: string
  let checkpoint: ReturnType<typeof vi.spyOn>

  beforeEach(async () => {
    MockMainCacheServiceUtils.resetMocks()
    directory = path.dirname(dbh.sqlite.name)
    extraction = path.join(directory, 'archive')
    for (const name of ['files', 'archive/IndexedDB', 'archive/Local Storage', 'archive/.claude']) {
      await mkdir(path.join(directory, name), { recursive: true })
    }
    await dbh.sqlite.backup(path.join(extraction, 'cherrystudio.sqlite'))
    await writeFile(path.join(extraction, 'cache.json'), '{}')
    await writeFile(
      path.join(extraction, 'metadata.json'),
      JSON.stringify({
        version: 7,
        appName: 'Cherry Studio',
        platform: process.platform,
        resources: { database: true, cache: true, indexedDB: true, localStorage: true, appClaude: true, data: false }
      })
    )
    const paths: Record<string, string> = {
      'app.userdata': directory,
      'app.userdata.data': path.join(directory, 'Data'),
      'app.database.file': dbh.sqlite.name,
      'app.database.migrations': path.resolve('migrations/sqlite-drizzle'),
      'feature.backup.restore.file': path.join(directory, 'restore-journal.json'),
      'feature.backup.restore.staging': path.join(directory, 'restore-staging'),
      'feature.files.data': path.join(directory, 'files'),
      'feature.agents.claude.root': path.join(directory, 'Data/Agents/.claude')
    }
    vi.mocked(application.getPath).mockImplementation((key, filename) =>
      path.join(paths[key] ?? path.join(directory, key), filename ?? '')
    )
    BaseService.resetInstances()
    manager = new FileManager()
    temporary = new TemporaryChatService()
    backup = new BackupManager()
    const hold = () => ({ dispose: vi.fn() })
    const services: Record<string, unknown> = {
      FileManager: manager,
      TemporaryChatService: temporary,
      AgentLifecycleService: {
        pauseIngress: hold,
        pauseExecution: hold,
        drainIngress: async () => ({ stragglerIds: [] }),
        drainInFlight: async () => ({ stragglerIds: [] }),
        listActiveWork: () => []
      },
      AiStreamManager: {
        pause: hold,
        drainInFlight: async () => ({ stragglerIds: [] }),
        hasLiveStreams: () => false
      },
      JobManager: {
        pause: hold,
        drainInFlight: async () => ({ stragglerIds: [], startupRecoveryPending: false })
      },
      AgentJobsService: { pause: hold, drainInFlight: async () => ({ settled: true }) }
    }
    const container = application.getContainer()
    vi.mocked(application.get).mockImplementation(
      (name) => (services[name] ?? container.get(name)) as ReturnType<typeof application.get>
    )
    checkpoint = vi.spyOn(application.get('DbService'), 'checkpointTruncate').mockImplementation(() => {
      dbh.sqlite.pragma('wal_checkpoint(TRUNCATE)')
    })
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    // The DB harness owns its root and database; remove only this suite's fixtures.
    for (const name of ['archive', 'files', 'feature.temporary_chat.temp', 'restore-journal.json', 'restore-staging']) {
      await rm(path.join(directory, name), { recursive: true, force: true })
    }
  })

  async function suspendedSave() {
    const topic = temporary.createTopic({})
    await temporary.appendMessage(topic.id, {
      role: 'assistant',
      data: { parts: [{ type: 'file', mediaType: 'video/mp4', url: 'data:video/mp4;base64,dmlkZW8=' }] }
    })
    const entered = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    const create = manager.createInternalEntry.bind(manager)
    vi.spyOn(manager, 'createInternalEntry').mockImplementationOnce(async (input) => {
      entered.resolve()
      await release.promise
      return create(input)
    })
    const saving = temporary.persist(topic.id)
    await entered.promise
    return { topic, saving, release }
  }

  it('waits for attachment promotion before capturing the restore fingerprint and keeps admission closed', async () => {
    const { topic, saving, release } = await suspendedSave()
    const admitted = Promise.withResolvers<void>()
    const drain = temporary.drainInFlight.bind(temporary)
    vi.spyOn(temporary, 'drainInFlight').mockImplementation((options) => {
      admitted.resolve()
      return drain(options)
    })
    const restoring = backup['restoreDirect'](extraction)
    // Race against restore completion so a missing drain fails promptly instead of hanging.
    await Promise.race([admitted.promise, restoring])
    const late = temporary.createTopic({})
    try {
      expect(checkpoint).not.toHaveBeenCalled()
      expect(journal.readRestoreJournal()).toEqual({ kind: 'none' })
      await expect(temporary.persist(late.id)).rejects.toThrow('paused')
      expect(dbh.db.select().from(fileEntryTable).all()).toHaveLength(0)
    } finally {
      release.resolve()
      await saving
      await restoring
    }
    expect(dbh.db.select().from(topicTable).all()).toMatchObject([{ id: topic.id }])
    const [entry] = dbh.db.select().from(fileEntryTable).all()
    expect(dbh.db.select().from(chatMessageFileRefTable).all()).toMatchObject([{ fileEntryId: entry.id }])
    expect(await readFile(manager.getPhysicalPath(entry.id), 'utf8')).toBe('video')
    const result = journal.readRestoreJournal()
    expect(result.kind).toBe('ok')
    if (result.kind !== 'ok') throw new Error('Expected restore journal')
    expect(result.journal.db.fingerprint).toBe(await hashDbFile(dbh.sqlite.name))
    await expect(temporary.persist(late.id)).rejects.toThrow('paused')
  })

  it('fails restore closed on a promotion timeout and allows saving again after releasing the hold', async () => {
    const { saving, release } = await suspendedSave()
    const drain = temporary.drainInFlight.bind(temporary)
    vi.spyOn(temporary, 'drainInFlight').mockImplementation(() => drain({ timeoutMs: 1 }))
    try {
      await expect(backup['restoreDirect'](extraction)).rejects.toThrow(BACKUP_BACKGROUND_TASKS_ERROR_CODE)
      expect(checkpoint).not.toHaveBeenCalled()
      expect(journal.readRestoreJournal()).toEqual({ kind: 'none' })
    } finally {
      release.resolve()
      await saving
    }
    const next = temporary.createTopic({})
    await expect(temporary.persist(next.id)).resolves.toMatchObject({ topicId: next.id })
  })

  it('releases admission if committing the restore journal fails', async () => {
    vi.spyOn(journal, 'writeRestoreJournal').mockImplementationOnce(() => {
      throw new Error('disk full')
    })
    await expect(backup['restoreDirect'](extraction)).rejects.toThrow('disk full')
    expect(journal.readRestoreJournal()).toEqual({ kind: 'none' })
    const topic = temporary.createTopic({})
    await expect(temporary.persist(topic.id)).resolves.toMatchObject({ topicId: topic.id })
  })

  it('keeps independent pause holds until each owner releases its hold', async () => {
    const topic = temporary.createTopic({})
    const first = temporary.pause('backup')
    const second = temporary.pause('restore')
    first.dispose()
    first.dispose()
    await expect(temporary.persist(topic.id)).rejects.toThrow('paused')
    expect(await temporary.drainInFlight({ timeoutMs: 1 })).toEqual({ stragglerIds: [] })
    second.dispose()
    await expect(temporary.persist(topic.id)).resolves.toMatchObject({ topicId: topic.id })
  })
})
