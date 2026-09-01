import { tmpdir } from 'node:os'

import { BaseService } from '@main/core/lifecycle/BaseService'
import { SchedulerService } from '@main/core/scheduler/SchedulerService'
import type * as LegacyFile from '@main/utils/legacyFile'
import { BACKUP_ACTIVE_WRITERS_ERROR_CODE } from '@shared/types/backup'
import { MockMainCacheServiceExport, MockMainCacheServiceUtils } from '@test-mocks/main/CacheService'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AutoBackupService } from '../AutoBackupService'
import { BackupOperationBusyError, legacyBackupManager } from '../LegacyBackupManager'

const mocks = vi.hoisted(() => ({
  BackupOperationBusyError: class extends Error {},
  applicationGet: vi.fn(),
  applicationGetPath: vi.fn((key: string) => (key === 'app.userdata' ? '/mock/userData' : '/mock/install')),
  broadcastToType: vi.fn(),
  decryptToken: vi.fn(async () => ({ username: 'user', access_token: 'token' })),
  hasWritePermission: vi.fn(async () => true),
  backupToLocalDir: vi
    .fn<
      (
        event: unknown,
        fileName: string | undefined,
        config: unknown,
        signal?: AbortSignal
      ) => Promise<{ result: string; cleanupError: Error | null }>
    >()
    .mockResolvedValue({ result: '/backups/test.zip', cleanupError: null }),
  backupToS3: vi
    .fn<
      (event: unknown, config: unknown, signal?: AbortSignal) => Promise<{ result: object; cleanupError: Error | null }>
    >()
    .mockResolvedValue({ result: {}, cleanupError: null }),
  backupToWebdav: vi
    .fn<
      (
        event: unknown,
        config: unknown,
        signal?: AbortSignal
      ) => Promise<{ result: boolean; cleanupError: Error | null }>
    >()
    .mockResolvedValue({ result: true, cleanupError: null })
}))

vi.mock('@application', () => ({ application: { get: mocks.applicationGet, getPath: mocks.applicationGetPath } }))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() })
  }
}))

vi.mock('@main/utils/legacyFile', async (importOriginal) => ({
  ...(await importOriginal<typeof LegacyFile>()),
  hasWritePermission: mocks.hasWritePermission
}))

vi.mock('../nutstore/NutstoreService', () => ({ decryptToken: mocks.decryptToken }))

vi.mock('../LegacyBackupManager', () => {
  return {
    BackupOperationBusyError: mocks.BackupOperationBusyError,
    legacyBackupManager: {
      backupToLocalDir: mocks.backupToLocalDir,
      backupToS3: mocks.backupToS3,
      backupToWebdav: mocks.backupToWebdav
    }
  }
})

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
  'data.backup.local.dir': tmpdir(),
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

  it('waits one full interval before the first automatic backup after application startup', async () => {
    await vi.advanceTimersByTimeAsync(59_000)
    expect(legacyBackupManager.backupToWebdav).not.toHaveBeenCalled()
    expect(legacyBackupManager.backupToS3).not.toHaveBeenCalled()
    expect(legacyBackupManager.backupToLocalDir).not.toHaveBeenCalled()
    expect(mocks.decryptToken).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1_000)
    expect(legacyBackupManager.backupToWebdav).toHaveBeenCalledTimes(2)
    expect(legacyBackupManager.backupToS3).toHaveBeenCalledOnce()
    expect(legacyBackupManager.backupToLocalDir).toHaveBeenCalledOnce()
    expect(mocks.decryptToken).toHaveBeenCalledOnce()
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
    expect(legacyBackupManager.backupToWebdav).toHaveBeenCalledTimes(2)
    expect(legacyBackupManager.backupToS3).toHaveBeenCalledOnce()
    expect(legacyBackupManager.backupToLocalDir).toHaveBeenCalledOnce()
    expect(mocks.decryptToken).toHaveBeenCalledOnce()

    await vi.advanceTimersByTimeAsync(30_000)
    await recreateService()

    await vi.advanceTimersByTimeAsync(59_000)
    expect(legacyBackupManager.backupToWebdav).toHaveBeenCalledTimes(2)
    expect(legacyBackupManager.backupToS3).toHaveBeenCalledOnce()
    expect(legacyBackupManager.backupToLocalDir).toHaveBeenCalledOnce()
    expect(mocks.decryptToken).toHaveBeenCalledOnce()

    await vi.advanceTimersByTimeAsync(1_000)
    expect(legacyBackupManager.backupToWebdav).toHaveBeenCalledTimes(4)
    expect(legacyBackupManager.backupToS3).toHaveBeenCalledTimes(2)
    expect(legacyBackupManager.backupToLocalDir).toHaveBeenCalledTimes(2)
    expect(mocks.decryptToken).toHaveBeenCalledTimes(2)
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
    expect(legacyBackupManager.backupToWebdav).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)
    expect(legacyBackupManager.backupToWebdav).toHaveBeenCalledOnce()
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
    expect(legacyBackupManager.backupToWebdav).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)
    expect(legacyBackupManager.backupToWebdav).toHaveBeenCalledOnce()
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
    expect(legacyBackupManager.backupToWebdav).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1_000)
    expect(legacyBackupManager.backupToWebdav).toHaveBeenCalledOnce()
  })

  it('does not reschedule after automatic backup is disabled during an upload', async () => {
    setPreference('data.backup.s3.auto_sync', false)
    setPreference('data.backup.local.auto_sync', false)
    setPreference('data.backup.nutstore.auto_sync', false)

    let finishBackup: (() => void) | undefined
    mocks.backupToWebdav.mockImplementationOnce(
      () =>
        new Promise<{ result: boolean; cleanupError: null }>((resolve) => {
          finishBackup = () => resolve({ result: true, cleanupError: null })
        })
    )

    await vi.advanceTimersByTimeAsync(60_000)
    expect(mocks.backupToWebdav).toHaveBeenCalledOnce()

    setPreference('data.backup.webdav.auto_sync', false)
    finishBackup?.()
    vi.runAllTicks()
    await vi.advanceTimersByTimeAsync(5 * 60_000)

    expect(mocks.backupToWebdav).toHaveBeenCalledOnce()
    expect(scheduler.has('auto-backup:webdav')).toBe(false)
  })

  it('rejects a local backup directory inside application data before creating a backup', async () => {
    setPreference('data.backup.webdav.auto_sync', false)
    setPreference('data.backup.s3.auto_sync', false)
    setPreference('data.backup.nutstore.auto_sync', false)
    setPreference('data.backup.local.dir', '/mock/userData/partial-path')

    await vi.advanceTimersByTimeAsync(60_000)

    expect(legacyBackupManager.backupToLocalDir).not.toHaveBeenCalled()
  })

  it('warns without uploading again when old backup cleanup fails', async () => {
    setPreference('data.backup.webdav.auto_sync', false)
    setPreference('data.backup.s3.auto_sync', false)
    setPreference('data.backup.nutstore.auto_sync', false)
    preferences['data.backup.local.max_backups'] = 1
    mocks.backupToLocalDir.mockResolvedValueOnce({
      result: '/backups/test.zip',
      cleanupError: new Error('delete denied')
    })

    await vi.advanceTimersByTimeAsync(60_000)
    await vi.advanceTimersByTimeAsync(7_000)

    expect(legacyBackupManager.backupToLocalDir).toHaveBeenCalledOnce()
    expect(mocks.broadcastToType).toHaveBeenCalledWith(
      expect.anything(),
      'backup.auto_sync_state_changed',
      expect.objectContaining({ type: 'local', status: 'warning', reason: 'cleanup_failed' })
    )
    expect(mocks.broadcastToType).not.toHaveBeenCalledWith(
      expect.anything(),
      'backup.auto_sync_state_changed',
      expect.objectContaining({ type: 'local', status: 'succeeded' })
    )
  })

  it('aborts an active automatic backup while stopping', async () => {
    setPreference('data.backup.s3.auto_sync', false)
    setPreference('data.backup.local.auto_sync', false)
    setPreference('data.backup.nutstore.auto_sync', false)

    let uploadSignal: AbortSignal | undefined
    mocks.backupToWebdav.mockImplementationOnce(
      (_event, _config, signal) =>
        new Promise<{ result: boolean; cleanupError: null }>((_resolve, reject) => {
          uploadSignal = signal
          signal?.addEventListener('abort', () => reject(signal.reason), { once: true })
        })
    )

    await vi.advanceTimersByTimeAsync(60_000)
    await service._doStop()

    expect(uploadSignal?.aborted).toBe(true)
  })

  it('preserves a busy-operation postponement after the service is recreated', async () => {
    setPreference('data.backup.s3.auto_sync', false)
    setPreference('data.backup.local.auto_sync', false)
    setPreference('data.backup.nutstore.auto_sync', false)
    mocks.backupToWebdav.mockRejectedValueOnce(new BackupOperationBusyError())

    await vi.advanceTimersByTimeAsync(60_000)
    expect(mocks.backupToWebdav).toHaveBeenCalledOnce()

    await vi.advanceTimersByTimeAsync(30_000)
    await recreateService()
    await vi.advanceTimersByTimeAsync(59_000)
    expect(mocks.backupToWebdav).toHaveBeenCalledOnce()

    await vi.advanceTimersByTimeAsync(1_000)
    expect(mocks.backupToWebdav).toHaveBeenCalledTimes(2)
  })

  it('emits one failure after the retry budget is exhausted', async () => {
    setPreference('data.backup.s3.auto_sync', false)
    setPreference('data.backup.local.auto_sync', false)
    setPreference('data.backup.nutstore.auto_sync', false)
    mocks.backupToWebdav.mockRejectedValue(
      new Error(`${BACKUP_ACTIVE_WRITERS_ERROR_CODE}: A conversation is still running.`)
    )

    await vi.advanceTimersByTimeAsync(60_000 + 7_000 + 17_000 + 37_000)

    expect(mocks.backupToWebdav).toHaveBeenCalledTimes(4)
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

  it('publishes the latest state per backup type', () => {
    ;(service as any).emit({ type: 'webdav', status: 'succeeded', timestamp: 123 })
    ;(service as any).emit({ type: 'webdav', status: 'running' })

    expect(MockMainCacheServiceExport.cacheService.getShared('backup.auto_sync.state.webdav')).toMatchObject({
      type: 'webdav',
      status: 'running'
    })
  })
})
