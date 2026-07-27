import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import type { RestoreJournalV2 } from '@data/db/restore/restoreJournalV2'
import { writeRestoreJournalV2 } from '@data/db/restore/restoreJournalV2'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The service is driven directly here, exactly the way the Phase 4 IPC layer
 * will: the handlers add sender policy and error mapping, nothing else, so the
 * behaviour worth proving lives on these methods.
 */
const { loggerMock } = vi.hoisted(() => ({
  loggerMock: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}))

vi.mock('@logger', () => ({ loggerService: { withContext: () => loggerMock } }))

let userDataDir = ''

vi.mock('@application', () => ({
  application: {
    getPath: vi.fn((key: string) => {
      if (key !== 'feature.backup.restore.file') {
        throw new Error(`Unexpected path key in BackupService test: ${key}`)
      }
      return join(userDataDir, 'restore-journal.json')
    })
  }
}))

import { BaseService } from '@main/core/lifecycle/BaseService'
import { getDependencies, getPhase } from '@main/core/lifecycle/decorators'
import { Phase } from '@main/core/lifecycle/types'

import { BackupBusyError } from '../errors'

const { BackupService } = await import('../BackupService')

const RESTORE_ID = '11111111-2222-4333-8444-555555555555'

function journalPath(): string {
  return join(userDataDir, 'restore-journal.json')
}

function preparedJournal(): RestoreJournalV2 {
  return {
    version: 2,
    restoreId: RESTORE_ID,
    preset: 'lite',
    createdAt: '2026-07-27T00:00:00.000Z',
    state: 'prepared',
    db: {
      promote: `restore-staging/${RESTORE_ID}/backup.sqlite`,
      aside: 'cherrystudio.sqlite.pre-restore',
      chain: [{ folderMillis: 1_730_000_000_000, hash: 'hash-one' }]
    },
    resourceInstalls: []
  }
}

/** Drive the protected lifecycle hook the container would call. */
function ready(service: InstanceType<typeof BackupService>): void {
  ;(service as unknown as { onReady: () => void }).onReady()
}

describe('BackupService', () => {
  let service: InstanceType<typeof BackupService>

  beforeEach(() => {
    userDataDir = mkdtempSync(join(tmpdir(), 'cs-backup-service-'))
    BaseService.resetInstances()
    vi.clearAllMocks()
    service = new BackupService()
  })

  afterEach(() => {
    rmSync(userDataDir, { recursive: true, force: true })
  })

  describe('lifecycle registration', () => {
    it('is registered under the name the rest of main resolves', () => {
      // Importing the registry would drag every service — and electron — into
      // this suite. The registration is a two-line fact; assert it on the source.
      const source = readFileSync(resolve(__dirname, '../../../core/application/serviceRegistry.ts'), 'utf8')

      expect(source).toContain("import { BackupService } from '@main/services/backup'")
      expect(source).toMatch(/^ {2}BackupService,$/m)
    })

    it('initializes after the path registry is frozen and declares no same-phase dependency', () => {
      // Journal paths resolve through `application.getPath`, so BeforeReady
      // would be too early. Phase ordering to DbService/PreferenceService is
      // enforced by the container, never by @DependsOn.
      expect(getPhase(BackupService)).toBe(Phase.WhenReady)
      expect(getDependencies(BackupService)).toEqual([])
    })
  })

  describe('status', () => {
    it('is idle with no restore when nothing has happened', () => {
      expect(service.getStatus()).toEqual({ operation: null, restore: { kind: 'none' } })
    })

    it('reports the durable journal state, id, and preset', () => {
      writeRestoreJournalV2(preparedJournal())

      expect(service.getStatus().restore).toEqual({
        kind: 'journal',
        state: 'prepared',
        restoreId: RESTORE_ID,
        preset: 'lite'
      })
    })

    it('carries the last completed step while promoting', () => {
      writeRestoreJournalV2({ ...preparedJournal(), state: 'promoting', step: 'live-aside' })

      expect(service.getStatus().restore).toMatchObject({ state: 'promoting', step: 'live-aside' })
    })

    it('reports an unparseable journal as unreadable instead of as absent', () => {
      // "Absent" would tell a caller it is safe to start a fresh restore over
      // whatever the unreadable journal is still protecting.
      writeFileSync(journalPath(), '{ not json')

      expect(service.getStatus().restore.kind).toBe('unreadable')
    })
  })

  describe('operation exclusion', () => {
    it('reports the running operation while work is in flight', async () => {
      let observed: ReturnType<typeof service.getStatus> | undefined
      await service.runExclusive('export', async () => {
        observed = service.getStatus()
      })

      expect(observed?.operation).toBe('export')
      expect(service.getStatus().operation).toBeNull()
    })

    it('rejects a second operation naming both sides of the conflict', async () => {
      let rejection: unknown
      await service.runExclusive('export', async () => {
        rejection = await service.runExclusive('prepare-restore', async () => 'unreachable').catch((error) => error)
      })

      expect(rejection).toBeInstanceOf(BackupBusyError)
      expect(rejection).toMatchObject({ running: 'export', requested: 'prepare-restore' })
    })

    it('claims the slot synchronously, so two callers in one tick cannot both pass', async () => {
      const first = service.runExclusive('export', async () => 'first')
      const second = service.runExclusive('export', async () => 'second')

      await expect(first).resolves.toBe('first')
      await expect(second).rejects.toBeInstanceOf(BackupBusyError)
    })

    it('releases the slot when the operation throws', async () => {
      await expect(
        service.runExclusive('export', async () => {
          throw new Error('export blew up')
        })
      ).rejects.toThrow('export blew up')

      expect(service.getStatus().operation).toBeNull()
      await expect(service.runExclusive('export', async () => 'ok')).resolves.toBe('ok')
    })
  })

  describe('startup recovery reporting', () => {
    it('says nothing when no restore was attempted', () => {
      ready(service)

      expect(loggerMock.info).not.toHaveBeenCalled()
      expect(loggerMock.error).not.toHaveBeenCalled()
    })

    it('reports what the previous boot left behind', () => {
      writeRestoreJournalV2({ ...preparedJournal(), state: 'completed', summary: { knowledgeBaseIds: ['kb-1'] } })

      ready(service)

      expect(loggerMock.info).toHaveBeenCalledWith(
        'Restore journal present at startup',
        expect.objectContaining({ state: 'completed', restoreId: RESTORE_ID, preset: 'lite' })
      )
    })

    it('escalates an unreadable journal without touching it', () => {
      writeFileSync(journalPath(), '{ not json')

      ready(service)

      // Quarantine belongs to the preboot gate, which runs while no service is
      // alive; reporting it here must not race that ownership.
      expect(loggerMock.error).toHaveBeenCalled()
      expect(service.getStatus().restore.kind).toBe('unreadable')
    })
  })
})
