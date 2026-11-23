import { tmpdir } from 'node:os'

import { mockNotificationService } from '@test-mocks/main/application'
import { MockMainCacheServiceExport, MockMainCacheServiceUtils } from '@test-mocks/main/CacheService'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { BaseService } from '@main/core/lifecycle/BaseService'
import { SchedulerService } from '@main/core/scheduler/SchedulerService'
import type * as LegacyFile from '@main/utils/legacyFile'

import { AutoBackupService } from '../AutoBackupService'
import { runManualBackup } from '../backupNotifications'
import type * as BackupModule from '../LegacyBackupManager'
import { BackupActiveWritersError, BackupOperationBusyError, legacyBackupManager } from '../LegacyBackupManager'

const mocks = vi.hoisted(() => ({
  BackupActiveWritersError: class extends Error {},
  BackupOperationBusyError: class extends Error {},
  applicationGet: vi.fn(),
  trackProductEvent: vi.fn(),
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
      ) => Promise<{ result: string; cleanupError: Error | null; sizeBytes: number }>
    >()
    .mockResolvedValue({ result: '/backups/test.zip', cleanupError: null, sizeBytes: 5 * 1024 * 1024 }),
  backupToS3: vi
    .fn<
      (
        event: unknown,
        config: unknown,
        signal?: AbortSignal
      ) => Promise<{ result: object; cleanupError: Error | null; sizeBytes: number }>
    >()
    .mockResolvedValue({ result: {}, cleanupError: null, sizeBytes: 200 * 1024 * 1024 }),
  backupToWebdav: vi
    .fn<
      (
        event: unknown,
        config: unknown,
        signal?: AbortSignal
      ) => Promise<{ result: boolean; cleanupError: Error | null; sizeBytes: number }>
    >()
    .mockResolvedValue({ result: true, cleanupError: null, sizeBytes: 50 * 1024 * 1024 })
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

vi.mock('../LegacyBackupManager', async () => {
  const { classifyBackupFailure } = await vi.importActual<typeof BackupModule>('../LegacyBackupManager')
  return {
    classifyBackupFailure,
    BackupActiveWritersError: mocks.BackupActiveWritersError,
    BackupOperationBusyError: mocks.BackupOperationBusyError,
    legacyBackupManager: {
      backupToLocalDir: mocks.backupToLocalDir,
      backupToS3: mocks.backupToS3,
      backupToWebdav: mocks.backupToWebdav
    }
  }
})

const manual = (target: string, status: string) => ({
  event: 'backup_run',
  target,
  mode: 'manual',
  status,
  durationMs: expect.any(Number)
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
      if (name === 'NotificationService') return mockNotificationService
      if (name === 'AnalyticsService') return { trackProductEvent: mocks.trackProductEvent }
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

  it('records automatic backup results independently of renderer delivery', async () => {
    await vi.advanceTimersByTimeAsync(60_000)
    const records = mockNotificationService.publish.mock.calls.map(([record]) => record)
    expect(records).toHaveLength(4)
    expect(records).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          category: 'system',
          kind: 'backup-success',
          target: { kind: 'settings', tab: 'data' }
        })
      ])
    )
    expect(new Set(records.map((record) => record.eventKey)).size).toBe(4)
  })

  it('preserves manual backup outcomes while recording success, cleanup warning, and failure', async () => {
    const result = { result: '/backups/saved.zip', cleanupError: null, sizeBytes: 2 * 1024 * 1024 * 1024 }
    await expect(runManualBackup('file', async () => result)).resolves.toBe(result)
    const warning = { result: '/backups/saved.zip', cleanupError: new Error('cleanup'), sizeBytes: 10 * 1024 * 1024 }
    await expect(runManualBackup('nutstore', async () => warning)).resolves.toBe(warning)
    const failure = new Error('upload failed')
    await expect(
      runManualBackup('s3', async () => {
        throw failure
      })
    ).rejects.toBe(failure)
    await expect(runManualBackup('webdav', async () => ({ result: false, cleanupError: null }))).resolves.toEqual({
      result: false,
      cleanupError: null
    })
    expect(mockNotificationService.publish.mock.calls.map(([record]) => record.kind)).toEqual([
      'backup-success',
      'backup-warning',
      'backup-failed',
      'backup-failed'
    ])
    expect(mocks.trackProductEvent.mock.calls.map(([event]) => event)).toEqual([
      { ...manual('file', 'success'), sizeBucket: 'over_1gb' },
      { ...manual('nutstore', 'warning'), sizeBucket: '10mb_to_100mb' },
      { ...manual('s3', 'error'), errorReason: 'other' },
      { ...manual('webdav', 'error'), errorReason: 'other' }
    ])
  })

  it('names why a manual backup failed by kind, never by its message', async () => {
    const failures: Array<[Error, string]> = [
      [Object.assign(new Error('Invalid response: 401 Unauthorized'), { status: 401 }), 'auth'],
      [Object.assign(new Error('Access Denied'), { name: 'AccessDenied', $metadata: { httpStatusCode: 403 } }), 'auth'],
      [Object.assign(new Error('request to https://dav.example.com/ failed'), { code: 'ENOTFOUND' }), 'network'],
      [Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' }), 'timeout'],
      [Object.assign(new Error('Invalid response: 503 Service Unavailable'), { status: 503 }), 'server'],
      [Object.assign(new Error('Invalid response: 404 Not Found'), { status: 404 }), 'config'],
      // webdav 5.9.0 shape for a request timeout answer: a 4xx that is not a settings problem.
      [Object.assign(new Error('Invalid response: 408 Request Timeout'), { status: 408 }), 'timeout'],
      [
        Object.assign(new Error('The specified bucket does not exist'), { $metadata: { httpStatusCode: 404 } }),
        'config'
      ],
      [new Error('BACKUP_DISK_FULL:1024'), 'disk_full'],
      [new Error('BACKUP_WEBDAV_TOO_LARGE: HTTP 413'), 'too_large']
    ]
    for (const [error] of failures) {
      await expect(
        runManualBackup('webdav', async () => {
          throw error
        })
      ).rejects.toBe(error)
    }

    expect(mocks.trackProductEvent.mock.calls.map(([event]) => event.errorReason)).toEqual(
      failures.map(([, reason]) => reason)
    )
  })

  it('reports each automatic backup once with its target and outcome', async () => {
    await vi.advanceTimersByTimeAsync(60_000)
    const reports = mocks.trackProductEvent.mock.calls.map(([event]) => event)
    expect(reports).toHaveLength(4)
    expect(reports).toEqual(
      expect.arrayContaining(
        (
          [
            ['webdav', '10mb_to_100mb'],
            ['s3', '100mb_to_1gb'],
            ['local_dir', 'under_10mb'],
            ['nutstore', '10mb_to_100mb']
          ] as const
        ).map(([target, sizeBucket]) => ({
          event: 'backup_run',
          target,
          mode: 'auto',
          status: 'success',
          durationMs: expect.any(Number),
          sizeBucket
        }))
      )
    )
  })

  it('does not publish backup failure while a retry can still succeed', async () => {
    mocks.backupToLocalDir.mockRejectedValueOnce(new Error('temporary failure'))
    await vi.advanceTimersByTimeAsync(60_000)
    expect(mockNotificationService.publish.mock.calls.map(([record]) => record.kind)).not.toContain('backup-failed')
    await vi.advanceTimersByTimeAsync(7_000)
    const records = mockNotificationService.publish.mock.calls.map(([record]) => record)
    expect(records).toHaveLength(4)
    expect(records.every((record) => record.kind === 'backup-success')).toBe(true)
  })

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
        new Promise<{ result: boolean; cleanupError: null; sizeBytes: number }>((resolve) => {
          finishBackup = () => resolve({ result: true, cleanupError: null, sizeBytes: 1 })
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

  it.each([
    '/mock/userData',
    '/mock/userData/..backup',
    ...(process.platform === 'darwin' || process.platform === 'win32' ? ['/MOCK/USERDATA/backups'] : [])
  ])('rejects %s as a local backup directory', async (directory) => {
    setPreference('data.backup.webdav.auto_sync', false)
    setPreference('data.backup.s3.auto_sync', false)
    setPreference('data.backup.nutstore.auto_sync', false)
    setPreference('data.backup.local.dir', directory)

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
      cleanupError: new Error('delete denied'),
      sizeBytes: 1
    })

    await vi.advanceTimersByTimeAsync(60_000)
    await vi.advanceTimersByTimeAsync(7_000)

    expect(legacyBackupManager.backupToLocalDir).toHaveBeenCalledOnce()
    expect(mocks.trackProductEvent).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'backup_run', target: 'local_dir', mode: 'auto', status: 'warning' })
    )
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
        new Promise<{ result: boolean; cleanupError: null; sizeBytes: number }>((_resolve, reject) => {
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

  it('postpones automatic backup while data writers are active without exhausting retries', async () => {
    setPreference('data.backup.s3.auto_sync', false)
    setPreference('data.backup.local.auto_sync', false)
    setPreference('data.backup.nutstore.auto_sync', false)
    mocks.backupToWebdav.mockRejectedValue(new BackupActiveWritersError())

    await vi.advanceTimersByTimeAsync(60_000 + 30_000 + 30_000 + 30_000)

    expect(mocks.backupToWebdav).toHaveBeenCalledTimes(4)
    expect(mocks.broadcastToType).not.toHaveBeenCalledWith(
      expect.anything(),
      'backup.auto_sync_state_changed',
      expect.objectContaining({ type: 'webdav', status: 'failed' })
    )
    expect(service.getStateSnapshot().pendingNotifications).toEqual([])
  })

  it('preserves ordinary retry count when alternating with active writer blocks', async () => {
    setPreference('data.backup.s3.auto_sync', false)
    setPreference('data.backup.local.auto_sync', false)
    setPreference('data.backup.nutstore.auto_sync', false)
    const backupError = new Error('WebDAV automatic backup failed')
    mocks.backupToWebdav
      .mockRejectedValueOnce(backupError)
      .mockRejectedValueOnce(new BackupActiveWritersError())
      .mockRejectedValueOnce(backupError)
      .mockRejectedValueOnce(new BackupActiveWritersError())
      .mockRejectedValueOnce(backupError)
      .mockRejectedValueOnce(new BackupActiveWritersError())
      .mockRejectedValueOnce(backupError)

    await vi.advanceTimersByTimeAsync(211_000)

    expect(mocks.backupToWebdav).toHaveBeenCalledTimes(7)
    expect(mocks.broadcastToType).toHaveBeenCalledWith(
      expect.anything(),
      'backup.auto_sync_state_changed',
      expect.objectContaining({ type: 'webdav', status: 'failed', errorMessage: 'WebDAV automatic backup failed' })
    )
  })

  it('starts automatic backup after active data writers clear', async () => {
    setPreference('data.backup.s3.auto_sync', false)
    setPreference('data.backup.local.auto_sync', false)
    setPreference('data.backup.nutstore.auto_sync', false)
    mocks.backupToWebdav
      .mockRejectedValueOnce(new BackupActiveWritersError())
      .mockRejectedValueOnce(new BackupActiveWritersError())
      .mockResolvedValueOnce({ result: true, cleanupError: null, sizeBytes: 1 })

    await vi.advanceTimersByTimeAsync(60_000 + 30_000 + 30_000)

    expect(mocks.backupToWebdav).toHaveBeenCalledTimes(3)
    expect(mocks.broadcastToType).toHaveBeenCalledWith(
      expect.anything(),
      'backup.auto_sync_state_changed',
      expect.objectContaining({ type: 'webdav', status: 'succeeded' })
    )
    expect(mocks.broadcastToType).not.toHaveBeenCalledWith(
      expect.anything(),
      'backup.auto_sync_state_changed',
      expect.objectContaining({ type: 'webdav', status: 'failed' })
    )
  })

  it('reports a size rejection once without retrying the same WebDAV upload', async () => {
    setPreference('data.backup.s3.auto_sync', false)
    setPreference('data.backup.local.auto_sync', false)
    setPreference('data.backup.nutstore.auto_sync', false)
    mocks.backupToWebdav.mockRejectedValue(new Error('BACKUP_WEBDAV_TOO_LARGE: HTTP 413'))

    await vi.advanceTimersByTimeAsync(60_000 + 59_000)

    expect(mocks.backupToWebdav).toHaveBeenCalledTimes(1)
    expect(service.getStateSnapshot().pendingNotifications).toEqual([
      expect.objectContaining({ type: 'webdav', status: 'failed', errorMessage: 'BACKUP_WEBDAV_TOO_LARGE: HTTP 413' })
    ])
    expect(mocks.trackProductEvent).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'backup_run', status: 'error', errorReason: 'too_large' })
    )
    await vi.advanceTimersByTimeAsync(1_000)
    expect(mocks.backupToWebdav).toHaveBeenCalledTimes(2)
  })

  it('emits one failure after the retry budget is exhausted for non-transient errors', async () => {
    setPreference('data.backup.s3.auto_sync', false)
    setPreference('data.backup.local.auto_sync', false)
    setPreference('data.backup.nutstore.auto_sync', false)
    mocks.backupToWebdav.mockRejectedValue(new Error('WebDAV automatic backup failed'))

    await vi.advanceTimersByTimeAsync(60_000 + 7_000 + 17_000 + 37_000)

    expect(mocks.backupToWebdav).toHaveBeenCalledTimes(4)
    // Retries stay silent; only the exhausted run reports a failure.
    expect(mocks.trackProductEvent.mock.calls.map(([event]) => event)).toEqual([
      {
        event: 'backup_run',
        target: 'webdav',
        mode: 'auto',
        status: 'error',
        durationMs: expect.any(Number),
        errorReason: 'other'
      }
    ])
    expect(mocks.broadcastToType).toHaveBeenCalledWith(
      expect.anything(),
      'backup.auto_sync_state_changed',
      expect.objectContaining({ type: 'webdav', status: 'failed', errorMessage: 'WebDAV automatic backup failed' })
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

  it('forwards data.backup.webdav.allow_self_signed_tls into the backup config', async () => {
    preferences['data.backup.webdav.allow_self_signed_tls'] = true
    await recreateService()
    await vi.advanceTimersByTimeAsync(61_000)

    expect(legacyBackupManager.backupToWebdav).toHaveBeenCalled()
    // Both webdav and nutstore schedules hit backupToWebdav; select by host,
    // not by call order.
    const config = vi
      .mocked(legacyBackupManager.backupToWebdav)
      .mock.calls.map(([, callConfig]) => callConfig as { webdavHost?: string; allowSelfSignedTls?: boolean })
      .find((callConfig) => callConfig.webdavHost === 'https://example.com/dav')
    expect(config?.allowSelfSignedTls).toBe(true)
  })

  it('defaults the flag to false in the config when the preference is unset (fail-closed)', async () => {
    delete preferences['data.backup.webdav.allow_self_signed_tls']
    await recreateService()
    await vi.advanceTimersByTimeAsync(61_000)

    const config = vi
      .mocked(legacyBackupManager.backupToWebdav)
      .mock.calls.map(([, callConfig]) => callConfig as { webdavHost?: string; allowSelfSignedTls?: boolean })
      .find((callConfig) => callConfig.webdavHost === 'https://example.com/dav')
    expect(config?.allowSelfSignedTls).toBe(false)
  })
})
