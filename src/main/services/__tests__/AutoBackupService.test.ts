import { BaseService } from '@main/core/lifecycle/BaseService'
import { SchedulerService } from '@main/core/scheduler/SchedulerService'
import { BACKUP_ACTIVE_WRITERS_ERROR_CODE } from '@shared/types/backup'
import { MockMainCacheServiceExport, MockMainCacheServiceUtils } from '@test-mocks/main/CacheService'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AutoBackupService } from '../AutoBackupService'
import { BackupBusyError } from '../backup'

const mocks = vi.hoisted(() => ({
  applicationGet: vi.fn(),
  broadcastToType: vi.fn(),
  cancelOperation: vi.fn(() => true),
  exportToDestination: vi.fn(async (destination: string) => ({ name: `${destination}.cherrybackup`, degradations: [] }))
}))

vi.mock('@application', () => ({ application: { get: mocks.applicationGet } }))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() })
  }
}))

const enabledPreferences: Record<string, unknown> = {
  'data.backup.webdav.auto_sync': true,
  'data.backup.webdav.host': 'https://example.com/dav',
  'data.backup.webdav.user': 'user',
  'data.backup.webdav.pass': 'pass',
  'data.backup.webdav.path': '/backups',
  'data.backup.webdav.max_backups': 0,
  'data.backup.webdav.skip_backup_file': false,
  'data.backup.webdav.disable_stream': false,
  'data.backup.webdav.sync_interval': 1,
  'data.backup.s3.auto_sync': true,
  'data.backup.s3.endpoint': 'https://s3.example.com',
  'data.backup.s3.region': 'region',
  'data.backup.s3.bucket': 'bucket',
  'data.backup.s3.access_key_id': 'key',
  'data.backup.s3.secret_access_key': 'secret',
  'data.backup.s3.root': '/backups',
  'data.backup.s3.max_backups': 0,
  'data.backup.s3.skip_backup_file': false,
  'data.backup.s3.sync_interval': 1,
  'data.backup.local.auto_sync': true,
  'data.backup.local.dir': '/tmp',
  'data.backup.local.max_backups': 0,
  'data.backup.local.skip_backup_file': false,
  'data.backup.local.sync_interval': 1,
  'data.backup.nutstore.auto_sync': true,
  'data.backup.nutstore.token': 'encrypted-token',
  'data.backup.nutstore.path': '/backups',
  'data.backup.nutstore.max_backups': 0,
  'data.backup.nutstore.skip_backup_file': false,
  'data.backup.nutstore.sync_interval': 1
}

describe('AutoBackupService', () => {
  let service: AutoBackupService
  let scheduler: SchedulerService
  let preferences: Record<string, unknown>
  let preferenceListener: ((key: string, newValue: unknown, oldValue: unknown) => void) | undefined

  beforeEach(async () => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    MockMainCacheServiceUtils.resetMocks()
    BaseService.resetInstances()
    preferences = { ...enabledPreferences }

    const preferenceService = {
      get: vi.fn((key: string) => preferences[key]),
      subscribeMultipleChanges: vi.fn((_keys, listener) => {
        preferenceListener = listener
        return vi.fn()
      })
    }

    scheduler = new SchedulerService()
    service = new AutoBackupService()
    mocks.applicationGet.mockImplementation((name: string) => {
      if (name === 'PreferenceService') return preferenceService
      if (name === 'SchedulerService') return scheduler
      if (name === 'CacheService') return MockMainCacheServiceExport.cacheService
      if (name === 'IpcApiService') return { broadcastToType: mocks.broadcastToType }
      if (name === 'BackupService') {
        return { exportToDestination: mocks.exportToDestination, cancelOperation: mocks.cancelOperation }
      }
      throw new Error(`Unexpected service: ${name}`)
    })

    await scheduler._doInit()
    await service._doInit()
    await service._doAllReady()
  })

  afterEach(async () => {
    await service._doStop()
    await scheduler._doStop()
    vi.useRealTimers()
    BaseService.resetInstances()
  })

  const setPreference = (key: string, value: unknown) => {
    const oldValue = preferences[key]
    preferences[key] = value
    preferenceListener?.(key, value, oldValue)
  }

  const recreateService = async () => {
    await service._doStop()
    await scheduler._doStop()
    BaseService.resetInstances()

    scheduler = new SchedulerService()
    service = new AutoBackupService()
    await scheduler._doInit()
    await service._doInit()
    await service._doAllReady()
  }

  const callsFor = (destination: string) =>
    mocks.exportToDestination.mock.calls.filter(([calledDestination]) => calledDestination === destination)

  it('waits one full interval before the first automatic backup after application startup', async () => {
    await vi.advanceTimersByTimeAsync(59_000)
    expect(mocks.exportToDestination).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1_000)
    for (const destination of ['webdav', 's3', 'local', 'nutstore']) {
      expect(callsFor(destination)).toHaveLength(1)
    }
  })

  it('restores enabled automatic backup schedules after a service restart', async () => {
    await service._doStop()
    await service._doInit()

    for (const type of ['webdav', 's3', 'local', 'nutstore']) {
      expect(scheduler.has(`auto-backup:${type}`)).toBe(true)
    }
  })

  it('applies the startup grace period when the remaining interval is shorter', async () => {
    await vi.advanceTimersByTimeAsync(60_000)
    for (const destination of ['webdav', 's3', 'local', 'nutstore']) {
      expect(callsFor(destination)).toHaveLength(1)
    }

    await vi.advanceTimersByTimeAsync(30_000)
    await recreateService()

    await vi.advanceTimersByTimeAsync(59_000)
    for (const destination of ['webdav', 's3', 'local', 'nutstore']) {
      expect(callsFor(destination)).toHaveLength(1)
    }

    await vi.advanceTimersByTimeAsync(1_000)
    for (const destination of ['webdav', 's3', 'local', 'nutstore']) {
      expect(callsFor(destination)).toHaveLength(2)
    }
  })

  it('waits through the startup grace period when the persisted interval is already overdue', async () => {
    setPreference('data.backup.s3.auto_sync', false)
    setPreference('data.backup.local.auto_sync', false)
    setPreference('data.backup.nutstore.auto_sync', false)
    MockMainCacheServiceExport.cacheService.setPersist('backup.auto_sync.last_attempt_times', {
      webdav: Date.now() - 2 * 60_000,
      s3: null,
      local: null,
      nutstore: null
    })
    await recreateService()

    await vi.advanceTimersByTimeAsync(59_999)
    expect(callsFor('webdav')).toHaveLength(0)

    await vi.advanceTimersByTimeAsync(1)
    expect(callsFor('webdav')).toHaveLength(1)
  })

  it('preserves a remaining interval that is longer than the startup grace period', async () => {
    setPreference('data.backup.webdav.sync_interval', 5)
    setPreference('data.backup.s3.auto_sync', false)
    setPreference('data.backup.local.auto_sync', false)
    setPreference('data.backup.nutstore.auto_sync', false)
    MockMainCacheServiceExport.cacheService.setPersist('backup.auto_sync.last_attempt_times', {
      webdav: Date.now() - 3.5 * 60_000,
      s3: null,
      local: null,
      nutstore: null
    })
    await recreateService()

    await vi.advanceTimersByTimeAsync(89_999)
    expect(callsFor('webdav')).toHaveLength(0)

    await vi.advanceTimersByTimeAsync(1)
    expect(callsFor('webdav')).toHaveLength(1)
  })

  it('schedules from a manual completion when automatic backup is enabled later', async () => {
    setPreference('data.backup.webdav.auto_sync', false)
    setPreference('data.backup.s3.auto_sync', false)
    setPreference('data.backup.local.auto_sync', false)
    setPreference('data.backup.nutstore.auto_sync', false)

    service.recordManualBackupCompletion('webdav')
    await vi.advanceTimersByTimeAsync(30_000)
    await recreateService()
    setPreference('data.backup.webdav.auto_sync', true)

    await vi.advanceTimersByTimeAsync(29_000)
    expect(callsFor('webdav')).toHaveLength(0)

    await vi.advanceTimersByTimeAsync(1_000)
    expect(callsFor('webdav')).toHaveLength(1)
  })

  it('does not reschedule after automatic backup is disabled during an upload', async () => {
    setPreference('data.backup.s3.auto_sync', false)
    setPreference('data.backup.local.auto_sync', false)
    setPreference('data.backup.nutstore.auto_sync', false)

    let finishBackup: (() => void) | undefined
    mocks.exportToDestination.mockImplementationOnce(
      () =>
        new Promise<{ name: string; degradations: [] }>((resolve) => {
          finishBackup = () => resolve({ name: 'webdav.cherrybackup', degradations: [] })
        })
    )

    await vi.advanceTimersByTimeAsync(60_000)
    expect(callsFor('webdav')).toHaveLength(1)

    setPreference('data.backup.webdav.auto_sync', false)
    finishBackup?.()
    vi.runAllTicks()
    await vi.advanceTimersByTimeAsync(5 * 60_000)

    expect(callsFor('webdav')).toHaveLength(1)
    expect(scheduler.has('auto-backup:webdav')).toBe(false)
  })

  it('aborts an active automatic backup while stopping', async () => {
    setPreference('data.backup.s3.auto_sync', false)
    setPreference('data.backup.local.auto_sync', false)
    setPreference('data.backup.nutstore.auto_sync', false)

    let rejectBackup: ((error: Error) => void) | undefined
    mocks.exportToDestination.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          rejectBackup = reject
        })
    )
    mocks.cancelOperation.mockImplementationOnce(() => {
      rejectBackup?.(new DOMException('Automatic backup stopped', 'AbortError'))
      return true
    })

    await vi.advanceTimersByTimeAsync(60_000)
    await service._doStop()

    expect(mocks.cancelOperation).toHaveBeenCalledOnce()
  })

  it('preserves a busy-operation postponement after the service is recreated', async () => {
    setPreference('data.backup.s3.auto_sync', false)
    setPreference('data.backup.local.auto_sync', false)
    setPreference('data.backup.nutstore.auto_sync', false)
    mocks.exportToDestination.mockRejectedValueOnce(new BackupBusyError('export', 'export'))

    await vi.advanceTimersByTimeAsync(60_000)
    expect(callsFor('webdav')).toHaveLength(1)

    await vi.advanceTimersByTimeAsync(30_000)
    await recreateService()
    await vi.advanceTimersByTimeAsync(59_000)
    expect(callsFor('webdav')).toHaveLength(1)

    await vi.advanceTimersByTimeAsync(1_000)
    expect(callsFor('webdav')).toHaveLength(2)
  })

  it('emits one failure after the retry budget is exhausted', async () => {
    setPreference('data.backup.s3.auto_sync', false)
    setPreference('data.backup.local.auto_sync', false)
    setPreference('data.backup.nutstore.auto_sync', false)
    mocks.exportToDestination.mockRejectedValue(
      new Error(`${BACKUP_ACTIVE_WRITERS_ERROR_CODE}: A conversation is still running.`)
    )

    await vi.advanceTimersByTimeAsync(60_000 + 7_000 + 17_000 + 37_000)

    expect(callsFor('webdav')).toHaveLength(4)
    expect(mocks.broadcastToType).toHaveBeenCalledWith(
      expect.anything(),
      'backup.auto_sync_state_changed',
      expect.objectContaining({ type: 'webdav', status: 'failed', errorMessage: expect.stringContaining('BACKUP') })
    )

    const failure = service.getStateSnapshot().pendingNotifications[0]
    expect(failure).toMatchObject({ type: 'webdav', status: 'failed' })
    service.acknowledgeNotification(failure.type, failure.id)
    expect(service.getStateSnapshot().pendingNotifications).toEqual([])
  })

  it('keeps the last result in snapshots while the next backup is running', () => {
    ;(service as any).emit({ type: 'webdav', status: 'succeeded', timestamp: 123 })
    ;(service as any).emit({ type: 'webdav', status: 'running' })

    expect(service.getStateSnapshot().events.filter((event) => event.type === 'webdav')).toMatchObject([
      { status: 'succeeded', timestamp: 123 },
      { status: 'running' }
    ])
  })
})
