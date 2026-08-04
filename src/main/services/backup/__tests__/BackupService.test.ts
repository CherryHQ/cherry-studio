import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import type { RestoreJournalV2 } from '@data/db/restore/restoreJournalV2'
import { writeRestoreJournalV2 } from '@data/db/restore/restoreJournalV2'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { armPreparedRestore, cancelPreparedRestore, prepareRestore } from '../restore/prepareRestore'

interface PrepareRestoreModule {
  armPreparedRestore: typeof armPreparedRestore
  cancelPreparedRestore: typeof cancelPreparedRestore
  prepareRestore: typeof prepareRestore
}

/**
 * The service is driven directly here, exactly the way the Phase 4 IPC layer
 * will: the handlers add sender policy and error mapping, nothing else, so the
 * behaviour worth proving lives on these methods.
 */
const {
  acknowledgeMock,
  abandonMock,
  armPreparedMock,
  armRollbackMock,
  cancelRebuildMock,
  loggerMock,
  postPromotionMock
} = vi.hoisted(() => ({
  acknowledgeMock: vi.fn(() => ({ acknowledged: true, restoreId: 'restore-1', removed: 1 })),
  abandonMock: vi.fn(() => ({ restoreId: 'restore-1', pendingBaseIds: ['kb-1'] })),
  armPreparedMock: vi.fn<(restoreId: string) => Promise<void>>(async () => undefined),
  armRollbackMock: vi.fn<() => Promise<void>>(async () => undefined),
  cancelRebuildMock: vi.fn(async () => undefined),
  loggerMock: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  postPromotionMock: vi.fn<
    (shouldContinue: () => boolean) => Promise<{ ran: boolean; enqueuedBaseIds: string[]; pending: boolean }>
  >(async () => ({ ran: false, enqueuedBaseIds: [], pending: false }))
}))

vi.mock('@logger', () => ({ loggerService: { withContext: () => loggerMock } }))
// The derived-work behaviour itself is proven in postPromotion.test.ts; what
// matters here is that the service tracks the promise it starts.
vi.mock('../restore/postPromotion', () => ({ runPostPromotionWork: postPromotionMock }))
vi.mock('../restore/acknowledgeRestore', () => ({
  acknowledgeRestore: acknowledgeMock,
  abandonKnowledgeRebuild: abandonMock
}))
vi.mock('../restore/prepareRestore', async (importOriginal) => ({
  ...(await importOriginal<PrepareRestoreModule>()),
  armPreparedRestore: armPreparedMock
}))
vi.mock('../restore/rollbackRestore', () => ({ armRestoreRollback: armRollbackMock }))

const { exportArchiveMock, transportMock } = vi.hoisted(() => ({
  exportArchiveMock: vi.fn<(input: { outPath: string }) => Promise<unknown>>(),
  transportMock: {
    upload: vi.fn<(localPath: string, name: string) => Promise<void>>(async () => undefined),
    download: vi.fn(async () => undefined),
    list: vi.fn<() => Promise<Array<{ name: string; modifiedAt: number; size: number }>>>(async () => []),
    remove: vi.fn<(name: string) => Promise<void>>(async () => undefined),
    check: vi.fn(async () => true)
  }
}))

vi.mock('../export/exportArchive', () => ({ exportArchive: exportArchiveMock }))
vi.mock('../export/exportOperation', () => ({ sweepStaleExportOperations: vi.fn(async () => undefined) }))
vi.mock('../destinations/destinationConfig', () => ({
  resolveDestination: vi.fn(async () => ({ kind: 'webdav', maxBackups: 1 }))
}))
vi.mock('../destinations/destinationTransport', () => ({ createTransport: () => transportMock }))
vi.mock('@main/utils/system', () => ({ getHostname: () => 'work-laptop', getDeviceType: () => 'mac' }))

let userDataDir = ''
const broadcastMock = vi.hoisted(() => vi.fn())

vi.mock('@application', () => ({
  application: {
    get: vi.fn((name: string) => {
      if (name === 'KnowledgeService') return { cancelRestoredMaterialRebuild: cancelRebuildMock }
      if (name === 'IpcApiService') return { broadcast: broadcastMock }
      throw new Error(`Unexpected service in BackupService test: ${name}`)
    }),
    getPath: vi.fn((key: string) => {
      if (key === 'feature.backup.restore.file') return join(userDataDir, 'restore-journal.json')
      if (key === 'feature.backup.temp') return join(userDataDir, 'backup-temp')
      throw new Error(`Unexpected path key in BackupService test: ${key}`)
    })
  }
}))

import { BaseService } from '@main/core/lifecycle/BaseService'
import { getDependencies, getPhase } from '@main/core/lifecycle/decorators'
import { DependencyResolver } from '@main/core/lifecycle/DependencyResolver'
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
    preset: 'full',
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

/** Drive the protected lifecycle hooks the container would call. */
function init(service: InstanceType<typeof BackupService>): void {
  ;(service as unknown as { onInit: () => void }).onInit()
}

function ready(service: InstanceType<typeof BackupService>): void {
  ;(service as unknown as { onReady: () => void }).onReady()
}

function scheduleAllReady(service: InstanceType<typeof BackupService>): void {
  ;(service as unknown as { onAllReady: () => void }).onAllReady()
}

/**
 * `onAllReady` only schedules the pass — the framework does not await that hook,
 * so it yields a quiet window to cold-start IO first. Tests that want the pass
 * itself have to spend that window.
 */
function allReady(service: InstanceType<typeof BackupService>): void {
  scheduleAllReady(service)
  // To the timer rather than by a duration: the window's length is the
  // service's tuning knob, and nothing here should have an opinion on it.
  vi.advanceTimersToNextTimer()
}

function stop(service: InstanceType<typeof BackupService>): Promise<void> {
  return (service as unknown as { onStop: () => Promise<void> }).onStop()
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

    it('initializes after the path registry is frozen and declares its same-phase owner dependency', () => {
      // Journal paths resolve through `application.getPath`, so BeforeReady
      // would be too early. Phase ordering to DbService/PreferenceService is
      // enforced by the container, never by @DependsOn; KnowledgeService is a
      // same-phase peer this service calls, so that one IS declared.
      expect(getPhase(BackupService)).toBe(Phase.WhenReady)
      expect(getDependencies(BackupService)).toEqual(['KnowledgeService'])
    })

    it('starts after KnowledgeService and stops before it', () => {
      // Both directions matter and they are the same fact: post-promotion work
      // calls the Knowledge owner while running, and `onStop` joins that pass.
      // The container starts in resolved order and stops in its reverse.
      const dependencies = ['KnowledgeService']
      const order = new DependencyResolver().resolve([
        ...dependencies.map((name) => ({ name, dependencies: [], priority: 0, phase: Phase.WhenReady })),
        {
          name: 'BackupService',
          dependencies: getDependencies(BackupService),
          priority: 0,
          phase: getPhase(BackupService)
        }
      ])

      expect(order.at(-1)).toBe('BackupService')
      expect([...order].reverse().at(0)).toBe('BackupService')
      for (const dependency of dependencies) {
        expect(order.indexOf(dependency)).toBeLessThan(order.indexOf('BackupService'))
      }
    })

    it('keeps restore transitions independent of runtime quiescence and lifecycle shutdown', () => {
      for (const relativePath of ['../restore/prepareRestore.ts', '../restore/rollbackRestore.ts']) {
        const source = readFileSync(resolve(__dirname, relativePath), 'utf8')

        expect(source, relativePath).not.toMatch(
          /exportQuiesce|McpRuntimeService|relaunchAfterShutdown|application\.shutdown/
        )
        expect(source, relativePath).toContain('application.relaunch()')
      }
    })
  })

  describe('status', () => {
    it('is idle with no restore when nothing has happened', () => {
      expect(service.getStatus()).toEqual({ operation: null, restore: { kind: 'none' } })
    })

    it('reports the durable journal state and id', () => {
      writeRestoreJournalV2(preparedJournal())

      expect(service.getStatus().restore).toEqual({
        kind: 'journal',
        state: 'prepared',
        restoreId: RESTORE_ID
      })
    })

    it('carries the last completed step while promoting', () => {
      writeRestoreJournalV2({ ...preparedJournal(), state: 'promoting', step: 'live-aside' })

      expect(service.getStatus().restore).toMatchObject({ state: 'promoting', step: 'live-aside' })
    })

    it('reports a completed restore whose units are not all in place', () => {
      writeRestoreJournalV2({
        ...preparedJournal(),
        state: 'completed',
        summary: { knowledgeBaseIds: [] },
        resourcesIncomplete: true
      })

      expect(service.getStatus().restore).toMatchObject({ state: 'completed', resourcesIncomplete: true })
    })

    it('reports Knowledge rebuild pending until every summary base is complete', () => {
      const completed = {
        ...preparedJournal(),
        state: 'completed' as const,
        ownerSummary: { knowledge: { baseIds: ['kb-1'], requiresRebuild: true } }
      }
      writeRestoreJournalV2(completed)
      expect(service.getStatus().restore).toMatchObject({ knowledgeRebuildPending: true })

      writeRestoreJournalV2({
        ...completed,
        ownerProgress: { knowledge: { completedBaseIds: ['kb-1'] } }
      })
      expect(service.getStatus().restore).not.toHaveProperty('knowledgeRebuildPending')

      writeRestoreJournalV2({
        ...completed,
        ownerProgress: { knowledge: { completedBaseIds: [], abandoned: true } }
      })
      expect(service.getStatus().restore).not.toHaveProperty('knowledgeRebuildPending')
    })

    it('surfaces the degradation report the journal carries', () => {
      const degradations = [{ kind: 'restore-db:note', reason: 'path-unportable (2 rows)' }]
      writeRestoreJournalV2({ ...preparedJournal(), degradations })

      expect(service.getStatus().restore).toMatchObject({ degradations })
    })

    it('omits the degradation report when the restore reduced nothing', () => {
      writeRestoreJournalV2(preparedJournal())

      expect(service.getStatus().restore).not.toHaveProperty('degradations')
    })

    it('reports an unparseable journal as unreadable instead of as absent', () => {
      // "Absent" would tell a caller it is safe to start a fresh restore over
      // whatever the unreadable journal is still protecting.
      writeFileSync(journalPath(), '{ not json')

      expect(service.getStatus().restore.kind).toBe('unreadable')
    })
  })

  describe('post-promotion work', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('leaves the boot alone until the quiet window has passed', async () => {
      // `onAllReady` is a supplement the framework never awaits, so running the
      // pass inside it would put database and Knowledge work on top of
      // cold-start IO (docs/references/lifecycle/lifecycle-usage.md).
      postPromotionMock.mockResolvedValue({ ran: true, enqueuedBaseIds: [], pending: false })
      scheduleAllReady(service)

      expect(postPromotionMock).not.toHaveBeenCalled()

      vi.advanceTimersToNextTimer()
      expect(postPromotionMock).toHaveBeenCalledOnce()
    })

    it('never starts a pass when shutdown lands inside the quiet window', async () => {
      postPromotionMock.mockResolvedValue({ ran: true, enqueuedBaseIds: [], pending: false })
      scheduleAllReady(service)

      await stop(service)
      vi.advanceTimersByTime(60_000)

      expect(postPromotionMock).not.toHaveBeenCalled()
    })

    it('starts the rebuild once everything is ready and joins it on stop', async () => {
      // Un-joined, the rebuild would enqueue into a job manager that is already
      // tearing down — the shutdown has to wait for it to notice.
      let finish = (): void => {}
      postPromotionMock.mockImplementationOnce(
        () => new Promise((resolve) => (finish = () => resolve({ ran: true, enqueuedBaseIds: [], pending: false })))
      )
      allReady(service)

      let stopped = false
      const stopping = stop(service).then(() => (stopped = true))
      await Promise.resolve()
      expect(stopped).toBe(false)

      finish()
      await stopping
      expect(stopped).toBe(true)
    })

    it('tells the rebuild to stop enqueuing as soon as shutdown begins', async () => {
      let shouldContinue = (): boolean => true
      postPromotionMock.mockImplementationOnce(async (probe: () => boolean) => {
        shouldContinue = probe
        return { ran: true, enqueuedBaseIds: [], pending: false }
      })
      allReady(service)
      expect(shouldContinue()).toBe(true)

      await stop(service)

      expect(shouldContinue()).toBe(false)
    })

    it('logs a failed rebuild instead of failing the shutdown', async () => {
      postPromotionMock.mockRejectedValueOnce(new Error('reindex queue is gone'))
      allReady(service)

      await expect(stop(service)).resolves.toBeUndefined()
      expect(loggerMock.error).toHaveBeenCalled()
    })

    it('stops the scheduler, joins its pass, cancels restore jobs, then acknowledges an explicit give-up', async () => {
      let shouldContinue = (): boolean => true
      let finish = (): void => {}
      postPromotionMock.mockImplementationOnce(
        (probe: () => boolean) =>
          new Promise((resolve) => {
            shouldContinue = probe
            finish = () => resolve({ ran: true, enqueuedBaseIds: ['kb-1'], pending: true })
          })
      )
      allReady(service)

      const acknowledging = service.acknowledgeRestore('abandon')
      expect(abandonMock).toHaveBeenCalledOnce()
      expect(shouldContinue()).toBe(false)
      expect(cancelRebuildMock).not.toHaveBeenCalled()

      finish()
      await expect(acknowledging).resolves.toMatchObject({ acknowledged: true })
      expect(cancelRebuildMock).toHaveBeenCalledWith('restore-1')
      expect(acknowledgeMock).toHaveBeenCalledOnce()
    })
  })

  describe('stage progress', () => {
    it('binds the running operation to the stage the pipeline names', async () => {
      broadcastMock.mockClear()

      await service.runExclusive('export', async (_signal, reportStage) => {
        reportStage('snapshotting-db')
      })

      expect(broadcastMock).toHaveBeenCalledWith('backup.progress', {
        operation: 'export',
        stage: 'snapshotting-db'
      })
    })

    // Progress is a label; the request's own resolution reports the outcome. A
    // window torn down mid-export must not turn a good archive into a failure.
    it('survives a broadcast that throws', async () => {
      broadcastMock.mockClear()
      broadcastMock.mockImplementationOnce(() => {
        throw new Error('no window')
      })

      await expect(
        service.runExclusive('export', async (_signal, reportStage) => {
          reportStage('preparing')
          return 'finished'
        })
      ).resolves.toBe('finished')
    })
  })

  describe('operation exclusion', () => {
    it('accepts operations after the lifecycle restarts the same service instance', async () => {
      await stop(service)
      init(service)

      await expect(service.runExclusive('export', async () => 'ok')).resolves.toBe('ok')
    })

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

    it('serializes restore arming with export and reports the transition operation', async () => {
      let finish = (): void => {}
      armPreparedMock.mockImplementationOnce(
        async () =>
          new Promise<void>((resolve) => {
            finish = resolve
          })
      )

      const arming = service.armRestore(RESTORE_ID)
      await vi.waitFor(() => expect(armPreparedMock).toHaveBeenCalledOnce())

      expect(service.getStatus().operation).toBe('arm-restore')
      await expect(service.runExclusive('export', async () => undefined)).rejects.toMatchObject({
        running: 'arm-restore',
        requested: 'export'
      })

      finish()
      await arming
      expect(service.getStatus().operation).toBeNull()
    })

    it('serializes rollback arming with restore preparation', async () => {
      let finish = (): void => {}
      armRollbackMock.mockImplementationOnce(
        async () =>
          new Promise<void>((resolve) => {
            finish = resolve
          })
      )

      const rollback = service.rollbackRestore()
      await vi.waitFor(() => expect(armRollbackMock).toHaveBeenCalledOnce())

      expect(service.getStatus().operation).toBe('rollback-restore')
      await expect(service.runExclusive('prepare-restore', async () => undefined)).rejects.toBeInstanceOf(
        BackupBusyError
      )

      finish()
      await rollback
    })
  })

  describe('cancellation', () => {
    it('reports nothing to cancel when idle', () => {
      expect(service.cancelOperation()).toBe(false)
    })

    it('aborts the signal the in-flight operation is holding', async () => {
      let observed: AbortSignal | undefined
      await service.runExclusive('export', async (signal) => {
        observed = signal
        expect(signal.aborted).toBe(false)
        expect(service.cancelOperation()).toBe(true)
        expect(signal.aborted).toBe(true)
      })

      expect(observed?.aborted).toBe(true)
    })

    it('gives each operation its own signal, so a cancellation cannot reach the next one', async () => {
      const first = await service.runExclusive('export', async (signal) => {
        service.cancelOperation()
        return signal
      })
      const second = await service.runExclusive('export', async (signal) => signal)

      expect(first.aborted).toBe(true)
      expect(second.aborted).toBe(false)
    })

    it('has nothing to cancel once the operation finished', async () => {
      await service.runExclusive('export', async () => 'done')

      expect(service.cancelOperation()).toBe(false)
    })

    it('does not cancel an irreversible arm transition', async () => {
      let finish = (): void => {}
      armPreparedMock.mockImplementationOnce(
        async () =>
          new Promise<void>((resolve) => {
            finish = resolve
          })
      )
      const arming = service.armRestore(RESTORE_ID)
      await vi.waitFor(() => expect(armPreparedMock).toHaveBeenCalledOnce())

      expect(service.cancelOperation()).toBe(false)

      finish()
      await arming
    })

    it('does not cancel an irreversible rollback transition', async () => {
      let finish = (): void => {}
      armRollbackMock.mockImplementationOnce(
        async () =>
          new Promise<void>((resolve) => {
            finish = resolve
          })
      )
      const rollback = service.rollbackRestore()
      await vi.waitFor(() => expect(armRollbackMock).toHaveBeenCalledOnce())

      expect(service.cancelOperation()).toBe(false)

      finish()
      await rollback
    })

    it('joins an irreversible arm during service shutdown without aborting it', async () => {
      let finish = (): void => {}
      armPreparedMock.mockImplementationOnce(
        async () =>
          new Promise<void>((resolve) => {
            finish = resolve
          })
      )
      const arming = service.armRestore(RESTORE_ID)
      await vi.waitFor(() => expect(armPreparedMock).toHaveBeenCalledOnce())

      let stopped = false
      const stopping = stop(service).then(() => {
        stopped = true
      })
      await Promise.resolve()

      expect(stopped).toBe(false)
      expect(service.cancelOperation()).toBe(false)

      finish()
      await Promise.all([arming, stopping])
      expect(stopped).toBe(true)
    })

    it('aborts and joins an in-flight operation during service shutdown', async () => {
      let observed: AbortSignal | undefined
      let workSettled = false
      const operation = service.runExclusive(
        'export',
        (signal) =>
          new Promise<string>((resolve) => {
            observed = signal
            signal.addEventListener(
              'abort',
              () => {
                workSettled = true
                resolve('cancelled-cleanly')
              },
              { once: true }
            )
          })
      )
      await vi.waitFor(() => expect(observed).toBeDefined())

      await stop(service)

      expect(observed?.aborted).toBe(true)
      expect(workSettled).toBe(true)
      await expect(operation).resolves.toBe('cancelled-cleanly')
      await expect(service.runExclusive('export', async () => 'late')).rejects.toThrow(/shutting down/)
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
        expect.objectContaining({ state: 'completed', restoreId: RESTORE_ID })
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

describe('BackupService.exportToDestination', () => {
  let service: InstanceType<typeof BackupService>
  const calls: string[] = []

  beforeEach(() => {
    calls.length = 0
    userDataDir = mkdtempSync(join(tmpdir(), 'cs-backup-destination-'))
    BaseService.resetInstances()
    vi.clearAllMocks()
    service = new BackupService()
    init(service)

    exportArchiveMock.mockImplementation(async ({ outPath }) => {
      writeFileSync(outPath, 'archive')
      return { outPath, manifest: { degradations: [] } }
    })
    transportMock.upload.mockImplementation(async () => {
      calls.push('upload')
    })
    transportMock.list.mockImplementation(async () => {
      calls.push('list')
      return [
        { name: 'cherry-studio.20260102000000.work-laptop.mac.zip', modifiedAt: 2, size: 1 },
        { name: 'cherry-studio.20260101000000.work-laptop.mac.zip', modifiedAt: 1, size: 1 }
      ]
    })
    transportMock.remove.mockImplementation(async () => {
      calls.push('remove')
    })
  })

  afterEach(() => {
    rmSync(userDataDir, { recursive: true, force: true })
  })

  // The order is the whole safety property: pruning first is how a limit of 1
  // turned a failed upload into a user with no backups at all.
  it('uploads before it prunes', async () => {
    await service.exportToDestination('webdav')

    expect(calls[0]).toBe('upload')
    expect(calls).toContain('remove')
  })

  it('prunes nothing when the upload fails', async () => {
    transportMock.upload.mockRejectedValueOnce(new Error('network down'))

    await expect(service.exportToDestination('webdav')).rejects.toThrow('network down')

    expect(transportMock.remove).not.toHaveBeenCalled()
  })

  it('removes the staged archive whether or not the upload lands', async () => {
    transportMock.upload.mockImplementationOnce(async (localPath) => {
      expect(readFileSync(localPath, 'utf8')).toBe('archive')
      throw new Error('network down')
    })

    await expect(service.exportToDestination('webdav')).rejects.toThrow('network down')

    const staged = exportArchiveMock.mock.calls[0][0].outPath
    expect(() => readFileSync(staged)).toThrow()
  })

  it('sends the name the user typed instead of the generated one', async () => {
    await service.exportToDestination('webdav', 'before-the-big-update')

    expect(transportMock.upload).toHaveBeenCalledWith(expect.any(String), 'before-the-big-update.zip')
  })
})
