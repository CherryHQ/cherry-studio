import { mockPreferenceService } from '@test-mocks/renderer/PreferenceService'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  backupSyncState,
  nutstoreSyncState,
  mockBackupToLocal,
  mockBackupToNutstore,
  mockBackupToS3,
  mockBackupToWebdav
} = vi.hoisted(() => ({
  backupSyncState: {
    webdavSync: { lastSyncTime: null, syncing: false, lastSyncError: null },
    s3Sync: { lastSyncTime: null, syncing: false, lastSyncError: null },
    localBackupSync: { lastSyncTime: null, syncing: false, lastSyncError: null }
  },
  nutstoreSyncState: { lastSyncTime: null, syncing: false, lastSyncError: null },
  mockBackupToLocal: vi.fn().mockResolvedValue(undefined),
  mockBackupToNutstore: vi.fn().mockResolvedValue(undefined),
  mockBackupToS3: vi.fn().mockResolvedValue(undefined),
  mockBackupToWebdav: vi.fn().mockResolvedValue(undefined)
}))

vi.mock('../BackupService', () => ({
  backupToLocal: mockBackupToLocal,
  backupToS3: mockBackupToS3,
  backupToWebdav: mockBackupToWebdav,
  getBackupSyncState: () => backupSyncState,
  isBackupRunning: () => false
}))

vi.mock('../NutstoreService', () => ({
  backupToNutstore: mockBackupToNutstore,
  getNutstoreSyncState: () => nutstoreSyncState,
  isNutstoreBackupRunning: () => false
}))

import { AutoBackupService } from '../AutoBackupService'

const enabledPreferences = {
  'data.backup.webdav.auto_sync': true,
  'data.backup.webdav.host': 'https://example.com/dav',
  'data.backup.webdav.sync_interval': 1,
  'data.backup.s3.auto_sync': true,
  'data.backup.s3.endpoint': 'https://s3.example.com',
  'data.backup.s3.sync_interval': 1,
  'data.backup.local.auto_sync': true,
  'data.backup.local.dir': '/backups',
  'data.backup.local.sync_interval': 1,
  'data.backup.nutstore.auto_sync': true,
  'data.backup.nutstore.token': 'token',
  'data.backup.nutstore.sync_interval': 1
}

describe('AutoBackupService', () => {
  let service: AutoBackupService

  beforeEach(async () => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    mockPreferenceService._resetMockState()
    await mockPreferenceService.setMultiple(enabledPreferences)
    Object.assign(backupSyncState.webdavSync, { lastSyncTime: null, syncing: false, lastSyncError: null })
    Object.assign(backupSyncState.s3Sync, { lastSyncTime: null, syncing: false, lastSyncError: null })
    Object.assign(backupSyncState.localBackupSync, { lastSyncTime: null, syncing: false, lastSyncError: null })
    Object.assign(nutstoreSyncState, { lastSyncTime: null, syncing: false, lastSyncError: null })
    service = new AutoBackupService()
  })

  afterEach(() => {
    service.dispose()
    vi.useRealTimers()
  })

  it('restores every enabled automatic backup schedule on initialization', async () => {
    await service.initialize()

    await vi.advanceTimersByTimeAsync(1_000)
    expect(mockBackupToWebdav).toHaveBeenCalledOnce()
    expect(mockBackupToS3).toHaveBeenCalledOnce()
    expect(mockBackupToLocal).toHaveBeenCalledOnce()
    expect(mockBackupToNutstore).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(59_000)
    expect(mockBackupToNutstore).toHaveBeenCalledOnce()
  })

  it('does not reschedule after automatic backup is disabled while an upload is running', async () => {
    await mockPreferenceService.setMultiple({
      'data.backup.s3.auto_sync': false,
      'data.backup.local.auto_sync': false,
      'data.backup.nutstore.auto_sync': false
    })

    let finishBackup: (() => void) | undefined
    mockBackupToWebdav.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishBackup = resolve
        })
    )

    await service.initialize()
    await vi.advanceTimersByTimeAsync(1_000)
    expect(mockBackupToWebdav).toHaveBeenCalledOnce()

    await mockPreferenceService.set('data.backup.webdav.auto_sync', false)
    finishBackup?.()
    await vi.waitFor(() => expect(backupSyncState.webdavSync.syncing).toBe(false))

    await vi.advanceTimersByTimeAsync(5 * 60 * 1_000)
    expect(mockBackupToWebdav).toHaveBeenCalledOnce()
  })
})
