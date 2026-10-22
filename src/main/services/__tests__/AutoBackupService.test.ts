import { tmpdir } from 'node:os'

import { MockMainCacheServiceExport, MockMainCacheServiceUtils } from '@test-mocks/main/CacheService'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { BaseService } from '@main/core/lifecycle/BaseService'
import { SchedulerService } from '@main/core/scheduler/SchedulerService'
import type * as LegacyFile from '@main/utils/legacyFile'

import { AutoBackupService } from '../AutoBackupService'
import { BackupActiveWritersError, BackupOperationBusyError, legacyBackupManager } from '../LegacyBackupManager'

const mocks = vi.hoisted(() => ({
  BackupActiveWritersError: class extends Error {},
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
    BackupActiveWritersError: mocks.BackupActiveWritersError,
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

  describe('sync_start anchor', () => {
    const wallClock = (hours: number, minutes = 0, seconds = 0) =>
      new Date(2026, 9, 20, hours, minutes, seconds).getTime()
    const clock = (withSeconds = false) => new Date(Date.now()).toTimeString().slice(0, withSeconds ? 8 : 5)

    /** Leaves only webdav enabled and pins "now" to a real wall-clock time. */
    const isolateWebdavAt = async (hours: number, minutes = 0, seconds = 0) => {
      setPreference('data.backup.s3.auto_sync', false)
      setPreference('data.backup.local.auto_sync', false)
      setPreference('data.backup.nutstore.auto_sync', false)
      vi.setSystemTime(wallClock(hours, minutes, seconds))
    }

    beforeEach(() => {
      setPreference('data.backup.webdav.sync_interval', 360)
    })

    it('fires at the anchor instead of one interval after the last run', async () => {
      setPreference('data.backup.webdav.sync_start', 18 * 60)
      await isolateWebdavAt(7, 0)
      await recreateService()

      // A plain interval would wait 6h from startup (13:00); the anchor is 12:00.
      await vi.advanceTimersByTimeAsync(5 * 3600_000 - 1_000)
      expect(mocks.backupToWebdav).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(1_000)

      expect(mocks.backupToWebdav).toHaveBeenCalledOnce()
      expect(clock()).toBe('12:00')
    })

    it('keeps later backups on the anchor grid', async () => {
      setPreference('data.backup.webdav.sync_start', 18 * 60)
      await isolateWebdavAt(11, 59)
      await recreateService()

      await vi.advanceTimersByTimeAsync(6 * 3600_000)
      expect(clock()).toBe('17:59')
      await vi.advanceTimersByTimeAsync(60_000)

      expect(mocks.backupToWebdav).toHaveBeenCalledTimes(2)
      expect(clock()).toBe('18:00')

      await vi.advanceTimersByTimeAsync(6 * 3600_000)
      expect(mocks.backupToWebdav).toHaveBeenCalledTimes(3)
      expect(clock()).toBe('00:00')

      await vi.advanceTimersByTimeAsync(6 * 3600_000)
      expect(mocks.backupToWebdav).toHaveBeenCalledTimes(4)
      expect(clock()).toBe('06:00')
    })

    it('holds the same clock time every day when the interval is 24 hours', async () => {
      setPreference('data.backup.webdav.sync_start', 3 * 60)
      setPreference('data.backup.webdav.sync_interval', 1440)
      await isolateWebdavAt(9, 0)
      await recreateService()

      await vi.advanceTimersByTimeAsync(18 * 3600_000)
      expect(mocks.backupToWebdav).toHaveBeenCalledOnce()
      expect(clock()).toBe('03:00')

      await vi.advanceTimersByTimeAsync(24 * 3600_000)
      expect(mocks.backupToWebdav).toHaveBeenCalledTimes(2)
      expect(clock()).toBe('03:00')
    })

    it('does not skip a grid slot when the interval does not divide 24 hours', async () => {
      setPreference('data.backup.webdav.sync_start', 7 * 60)
      setPreference('data.backup.webdav.sync_interval', 300)
      await isolateWebdavAt(23, 0)
      await recreateService()

      await vi.advanceTimersByTimeAsync(3 * 3600_000)
      expect(mocks.backupToWebdav).toHaveBeenCalledOnce()
      expect(clock()).toBe('02:00')

      await vi.advanceTimersByTimeAsync(5 * 3600_000)
      expect(mocks.backupToWebdav).toHaveBeenCalledTimes(2)
      expect(clock()).toBe('07:00')
    })

    it('skips a grid slot that does not exist on the wall clock when DST springs forward', async () => {
      const originalTimezone = process.env.TZ
      process.env.TZ = 'America/New_York'
      try {
        setPreference('data.backup.s3.auto_sync', false)
        setPreference('data.backup.local.auto_sync', false)
        setPreference('data.backup.nutstore.auto_sync', false)
        setPreference('data.backup.webdav.sync_start', 30)
        setPreference('data.backup.webdav.sync_interval', 120)
        // 2026-03-08 03:05 EDT: the 02:30 slot falls inside the spring-forward gap.
        vi.setSystemTime(new Date(2026, 2, 8, 3, 5))
        await recreateService()

        // Date normalizes the nonexistent 02:30 forward to 03:30, which is off the grid.
        await vi.advanceTimersByTimeAsync(25 * 60_000)
        expect(mocks.backupToWebdav).not.toHaveBeenCalled()
        expect(clock()).toBe('03:30')

        await vi.advanceTimersByTimeAsync(60 * 60_000)
        expect(mocks.backupToWebdav).toHaveBeenCalledOnce()
        expect(clock()).toBe('04:30')
      } finally {
        if (originalTimezone === undefined) delete process.env.TZ
        else process.env.TZ = originalTimezone
      }
    })

    it('keeps searching past a day whose only slot falls in a DST gap', async () => {
      const originalTimezone = process.env.TZ
      process.env.TZ = 'America/New_York'
      try {
        setPreference('data.backup.s3.auto_sync', false)
        setPreference('data.backup.local.auto_sync', false)
        setPreference('data.backup.nutstore.auto_sync', false)
        setPreference('data.backup.webdav.sync_start', 150)
        setPreference('data.backup.webdav.sync_interval', 1440)
        // 2026-03-07 03:05 EST: today's 02:30 is past and 2026-03-08 has no 02:30 at all.
        vi.setSystemTime(new Date(2026, 2, 7, 3, 5))
        await recreateService()

        // The first existing slot is 2026-03-09 02:30 EDT, 46h25m away.
        await vi.advanceTimersByTimeAsync(46 * 3600_000 + 24 * 60_000)
        expect(mocks.backupToWebdav).not.toHaveBeenCalled()
        expect(clock()).toBe('02:29')

        await vi.advanceTimersByTimeAsync(60_000)
        expect(mocks.backupToWebdav).toHaveBeenCalledOnce()
        expect(clock()).toBe('02:30')
        expect(new Date().getDate()).toBe(9)
      } finally {
        if (originalTimezone === undefined) delete process.env.TZ
        else process.env.TZ = originalTimezone
      }
    })

    it('re-arms a pending anchored run after the machine changes timezone', async () => {
      const originalTimezone = process.env.TZ
      process.env.TZ = 'America/New_York'
      try {
        setPreference('data.backup.s3.auto_sync', false)
        setPreference('data.backup.local.auto_sync', false)
        setPreference('data.backup.nutstore.auto_sync', false)
        setPreference('data.backup.webdav.sync_start', 18 * 60)
        setPreference('data.backup.webdav.sync_interval', 1440)
        // 09:00 in New York: the one-shot is armed for 18:00 Eastern, nine hours out.
        vi.setSystemTime(new Date(2026, 9, 22, 9, 0))
        await recreateService()

        // The machine moves to Los Angeles before the slot: 18:00 Eastern is 15:00 Pacific now.
        process.env.TZ = 'America/Los_Angeles'

        // The armed instant arrives at 15:00 Pacific. Firing there would back up three hours
        // early and then again at the real slot, so the run is re-armed instead.
        await vi.advanceTimersByTimeAsync(9 * 3600_000 - 60_000)
        expect(clock()).toBe('14:59')
        await vi.advanceTimersByTimeAsync(60_000)
        expect(mocks.backupToWebdav).not.toHaveBeenCalled()
        expect(clock()).toBe('15:00')

        await vi.advanceTimersByTimeAsync(3 * 3600_000 - 60_000)
        expect(mocks.backupToWebdav).not.toHaveBeenCalled()
        await vi.advanceTimersByTimeAsync(60_000)
        expect(mocks.backupToWebdav).toHaveBeenCalledOnce()
        expect(clock()).toBe('18:00')
      } finally {
        if (originalTimezone === undefined) delete process.env.TZ
        else process.env.TZ = originalTimezone
      }
    })

    it('re-arms a pending anchored run when the machine moves east of the arming zone', async () => {
      const originalTimezone = process.env.TZ
      process.env.TZ = 'America/Los_Angeles'
      try {
        setPreference('data.backup.s3.auto_sync', false)
        setPreference('data.backup.local.auto_sync', false)
        setPreference('data.backup.nutstore.auto_sync', false)
        setPreference('data.backup.webdav.sync_start', 18 * 60)
        setPreference('data.backup.webdav.sync_interval', 1440)
        // 09:00 Pacific: the one-shot is armed for 18:00 Pacific, nine hours out.
        vi.setSystemTime(new Date(2026, 9, 22, 9, 0))
        await recreateService()

        // The machine moves east before the slot: 18:00 Pacific is 21:00 Eastern, three hours
        // after the 18:00 Eastern slot this grid names now. The armed instant must not stand.
        process.env.TZ = 'America/New_York'

        // The next recheck re-arms the slot to 18:00 Eastern instead of waiting for 21:00.
        await vi.advanceTimersByTimeAsync(16 * 60_000)
        expect(mocks.backupToWebdav).not.toHaveBeenCalled()

        await vi.advanceTimersByTimeAsync(5 * 3600_000 + 43 * 60_000)
        expect(clock()).toBe('17:59')
        await vi.advanceTimersByTimeAsync(60_000)

        expect(mocks.backupToWebdav).toHaveBeenCalledOnce()
        expect(clock()).toBe('18:00')

        // Once, not again at the old 21:00 Eastern instant.
        await vi.advanceTimersByTimeAsync(3 * 3600_000)
        expect(mocks.backupToWebdav).toHaveBeenCalledOnce()
      } finally {
        if (originalTimezone === undefined) delete process.env.TZ
        else process.env.TZ = originalTimezone
      }
    })

    it('takes the destination grid slot after a westward change past the source anchor', async () => {
      const originalTimezone = process.env.TZ
      process.env.TZ = 'America/New_York'
      try {
        setPreference('data.backup.s3.auto_sync', false)
        setPreference('data.backup.local.auto_sync', false)
        setPreference('data.backup.nutstore.auto_sync', false)
        setPreference('data.backup.webdav.sync_start', 18 * 60)
        setPreference('data.backup.webdav.sync_interval', 1440)
        // 19:00 Eastern: today's 18:00 has passed, so the one-shot is armed for tomorrow 18:00 Eastern.
        vi.setSystemTime(new Date(2026, 9, 22, 19, 0))
        await recreateService()

        // The machine moves west: 19:00 Eastern is 16:00 Pacific, where today's 18:00 is still ahead.
        process.env.TZ = 'America/Los_Angeles'

        await vi.advanceTimersByTimeAsync(16 * 60_000)
        expect(mocks.backupToWebdav).not.toHaveBeenCalled()

        // The stored date belonged to the source zone; today's destination slot (two hours out) is next.
        await vi.advanceTimersByTimeAsync(2 * 3600_000 - 16 * 60_000 - 60_000)
        expect(clock()).toBe('17:59')
        await vi.advanceTimersByTimeAsync(60_000)

        expect(mocks.backupToWebdav).toHaveBeenCalledOnce()
        expect(clock()).toBe('18:00')
        expect(new Date().getDate()).toBe(22)
      } finally {
        if (originalTimezone === undefined) delete process.env.TZ
        else process.env.TZ = originalTimezone
      }
    })

    it('returns to the grid after a missed slot instead of drifting with the gap', async () => {
      setPreference('data.backup.webdav.sync_start', 18 * 60)
      await isolateWebdavAt(17, 59)
      await recreateService()

      // Skip the 18:00 slot entirely (a shutdown spanning the anchor).
      vi.setSystemTime(wallClock(23, 0))
      await recreateService()
      await vi.advanceTimersByTimeAsync(3600_000)

      expect(mocks.backupToWebdav).toHaveBeenCalledOnce()
      expect(clock()).toBe('00:00')
    })

    it('does not fire before the anchor even when the startup grace period is shorter', async () => {
      setPreference('data.backup.webdav.sync_start', 18 * 60)
      await isolateWebdavAt(17, 58)
      await recreateService()

      // The 60s startup grace has elapsed but the 18:00 anchor has not been reached.
      await vi.advanceTimersByTimeAsync(61_000)
      expect(mocks.backupToWebdav).not.toHaveBeenCalled()
      expect(clock()).toBe('17:59')

      await vi.advanceTimersByTimeAsync(60_000)
      expect(mocks.backupToWebdav).toHaveBeenCalledOnce()
      expect(clock()).toBe('18:00')
    })

    it('keeps the first run on the grid when the startup grace would overshoot its slot', async () => {
      setPreference('data.backup.webdav.sync_start', 18 * 60)
      setPreference('data.backup.webdav.sync_interval', 6 * 60)
      await isolateWebdavAt(17, 59, 30)
      await recreateService()

      // The 18:00 slot is 30s away, so the 60s grace would push the run to 18:00:30 — off the grid.
      // The next slot the grace still leaves reachable is 00:00.
      await vi.advanceTimersByTimeAsync(61_000)
      expect(mocks.backupToWebdav).not.toHaveBeenCalled()
      expect(clock(true)).toBe('18:00:31')

      await vi.advanceTimersByTimeAsync(5 * 3600_000 + 59 * 60_000 + 29_000)
      expect(mocks.backupToWebdav).toHaveBeenCalledOnce()
      expect(clock(true)).toBe('00:00:00')
    })

    it('re-schedules from the grid when the anchor changes', async () => {
      setPreference('data.backup.webdav.sync_start', 18 * 60)
      await isolateWebdavAt(7, 0)
      await recreateService()

      setPreference('data.backup.webdav.sync_start', 8 * 60)
      await vi.advanceTimersByTimeAsync(3600_000)

      expect(mocks.backupToWebdav).toHaveBeenCalledOnce()
      expect(clock()).toBe('08:00')
    })

    it('ignores an unset anchor and keeps the plain interval', async () => {
      await isolateWebdavAt(7, 0)
      await recreateService()

      // Without an anchor the first backup is one full interval after startup: 13:00.
      await vi.advanceTimersByTimeAsync(6 * 3600_000 - 1_000)
      expect(mocks.backupToWebdav).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(2_000)

      expect(mocks.backupToWebdav).toHaveBeenCalledOnce()
      expect(clock()).toBe('13:00')
    })
  })
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
      .mockResolvedValueOnce({ result: true, cleanupError: null })

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

  it('emits one failure after the retry budget is exhausted for non-transient errors', async () => {
    setPreference('data.backup.s3.auto_sync', false)
    setPreference('data.backup.local.auto_sync', false)
    setPreference('data.backup.nutstore.auto_sync', false)
    mocks.backupToWebdav.mockRejectedValue(new Error('WebDAV automatic backup failed'))

    await vi.advanceTimersByTimeAsync(60_000 + 7_000 + 17_000 + 37_000)

    expect(mocks.backupToWebdav).toHaveBeenCalledTimes(4)
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
