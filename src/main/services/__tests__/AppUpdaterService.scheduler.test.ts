/**
 * Scheduler tests for AppUpdaterService — the auto update-check cadence that
 * was moved out of the renderer into the main process.
 *
 * Unlike the sibling `AppUpdaterService.test.ts` (which mocks the lifecycle base
 * to isolate pure helpers), this suite runs the REAL `BaseService` + a REAL
 * `SchedulerService` with fake timers, mirroring `JobManager.smoke.test.ts`.
 * That is the only way to exercise the self-rescheduling `once` loop end to end:
 * jitter on success, exponential backoff on failure, preference gating, and
 * cleanup on stop.
 */

import { setupTestDatabase } from '@test-helpers/db'
import { defaultServiceInstances, mockNotificationService } from '@test-mocks/main/application'
import type { UpdateInfo } from 'builder-util-runtime'
import { eq } from 'drizzle-orm'
import { app } from 'electron'
import { autoUpdater } from 'electron-updater'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import { appStateTable } from '@data/db/schemas/appState'
import { BaseService } from '@main/core/lifecycle/BaseService'
import { SchedulerService } from '@main/core/scheduler/SchedulerService'
import { regionService } from '@main/services/RegionService'

import { AppUpdaterService } from '../AppUpdaterService'

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() })
  }
}))

vi.mock('@main/core/platform', () => ({ isWin: false }))

vi.mock('@main/utils/appEdition', () => ({ getAppEdition: () => 'global' }))

vi.mock('@main/services/RegionService', () => ({
  regionService: { getCountry: vi.fn(async () => 'US') }
}))

vi.mock('@main/core/macElectronBridge', () => ({ isMacElectronBridgePackage: () => false }))

vi.mock('@main/utils/systemInfo', () => ({
  generateUserAgent: vi.fn(() => 'test-user-agent'),
  getClientId: vi.fn(() => 'test-client-id')
}))

vi.mock('electron', () => ({
  app: {
    isPackaged: true,
    getVersion: vi.fn(() => '1.0.0'),
    getLocale: vi.fn(() => 'en-US'),
    getPath: vi.fn(() => '/test/path')
  },
  // Real BaseService.ipcHandle calls ipcMain.handle, so the mock must provide it.
  ipcMain: { handle: vi.fn(), removeHandler: vi.fn(), on: vi.fn(), removeListener: vi.fn() },
  BrowserWindow: vi.fn()
}))

vi.mock('electron-updater', () => ({
  autoUpdater: {
    logger: null,
    forceDevUpdateConfig: false,
    autoDownload: false,
    autoInstallOnAppQuit: false,
    requestHeaders: {},
    on: vi.fn(),
    removeListener: vi.fn(),
    checkForUpdates: vi.fn(),
    downloadUpdate: vi.fn(),
    quitAndInstall: vi.fn(),
    channel: '',
    allowDowngrade: false,
    disableDifferentialDownload: false,
    currentVersion: '1.0.0'
  },
  Logger: vi.fn(),
  NsisUpdater: vi.fn(),
  AppUpdater: vi.fn()
}))

vi.mock('@application', async () => {
  const mod = await import('@test-mocks/main/application')
  return mod.mockApplicationFactory()
})

// Must mirror the private constants in AppUpdaterService.ts.
const SCHEDULE_ID = 'app-updater:auto-check'
const INITIAL_DELAY = 5_000
const INTERVAL = 4 * 60 * 60 * 1000
const BACKOFF_FIRST = 5 * 60 * 1000

const setPackaged = (value: boolean) => {
  ;(app as unknown as { isPackaged: boolean }).isPackaged = value
}

describe('AppUpdaterService — auto update-check scheduling', () => {
  const dbh = setupTestDatabase()
  const releaseMarker = (version: string) =>
    dbh.db
      .select()
      .from(appStateTable)
      .where(eq(appStateTable.key, `appUpdater:notification:${version}`))
      .get()
  let scheduler: SchedulerService
  let appUpdater: AppUpdaterService
  let prefValues: Record<string, unknown>
  let trackProductEvent: ReturnType<typeof vi.fn>
  const updateEvents = () =>
    trackProductEvent.mock.calls.map(([event]) => event).filter(({ event }) => event.startsWith('update_'))
  const listener = (name: string) =>
    vi.mocked(autoUpdater.on).mock.calls.find(([event]) => event === name)?.[1] as (...args: unknown[]) => void

  beforeEach(async () => {
    vi.clearAllMocks()
    BaseService.resetInstances()
    setPackaged(true)

    prefValues = {
      'app.dist.auto_update.enabled': true,
      'app.dist.test_plan.enabled': false,
      'app.dist.test_plan.channel': undefined,
      'app.language': 'en-US'
    }
    const prefStub = {
      get: vi.fn((key: string) => prefValues[key]),
      // onInit subscribes to test_plan changes; return an unsubscribe fn.
      subscribeMultipleChanges: vi.fn(() => vi.fn())
    }
    const powerStub = { registerShutdownHandler: vi.fn() }
    trackProductEvent = vi.fn()
    const analyticsStub = { trackAppUpdate: vi.fn(), trackProductEvent }
    const windowManagerStub = { broadcastToType: vi.fn() }

    scheduler = new SchedulerService()
    appUpdater = new AppUpdaterService()

    ;(application.get as ReturnType<typeof vi.fn<(...args: any[]) => any>>).mockImplementation((name: string) => {
      switch (name) {
        case 'PreferenceService':
          return prefStub
        case 'SchedulerService':
          return scheduler
        case 'PowerService':
          return powerStub
        case 'AnalyticsService':
          return analyticsStub
        case 'WindowManager':
          return windowManagerStub
        case 'DbService':
          return defaultServiceInstances.DbService
        case 'NotificationService':
          return mockNotificationService
        case 'IpcApiService':
          return defaultServiceInstances.IpcApiService
        default:
          throw new Error(`unexpected application.get('${name}')`)
      }
    })

    vi.mocked(regionService.getCountry).mockResolvedValue('US')
    vi.mocked(autoUpdater.checkForUpdates).mockResolvedValue(null)
    autoUpdater.requestHeaders = {}
    autoUpdater.channel = ''
    autoUpdater.allowDowngrade = false
    autoUpdater.disableDifferentialDownload = false
    // Center the jitter so the normal cadence is exactly CHECK_INTERVAL_MS.
    vi.spyOn(Math, 'random').mockReturnValue(0.5)

    await scheduler._doInit()
    await appUpdater._doInit()
  })

  afterEach(async () => {
    await appUpdater._doStop()
    await scheduler._doStop()
    vi.useRealTimers()
    vi.restoreAllMocks()
    BaseService.resetInstances()
  })

  it('records each available release once across repeated update checks', async () => {
    const release = {
      version: '2.0.0',
      path: 'test-update.zip',
      sha512: 'test-checksum',
      releaseDate: new Date().toISOString(),
      files: [],
      releaseNotes: 'A useful update.'
    }
    const available = vi.mocked(autoUpdater.on).mock.calls.find(([event]) => event === 'update-available')?.[1] as
      | ((release: UpdateInfo) => void)
      | undefined
    expect(available).toBeDefined()
    available?.(release)
    available?.(release)
    await vi.waitFor(() => expect(releaseMarker(release.version)?.value).toBe(true))
    available?.(release)
    expect(mockNotificationService.publish).toHaveBeenCalledTimes(1)
    expect(mockNotificationService.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        eventKey: 'release:2.0.0',
        category: 'official',
        kind: 'release',
        target: { kind: 'release', version: '2.0.0', releaseNotes: 'A useful update.' }
      }),
      { source: 'update' }
    )
  })

  it('consumes release identity while official notifications are disabled', async () => {
    prefValues['app.notification.center.official.enabled'] = false
    const available = vi.mocked(autoUpdater.on).mock.calls.find(([event]) => event === 'update-available')?.[1] as
      | ((release: UpdateInfo) => void)
      | undefined
    const release = {
      version: '2.0.1',
      path: 'test-update.zip',
      sha512: 'test-checksum',
      releaseDate: new Date().toISOString(),
      files: [],
      releaseNotes: 'Release notes.'
    }
    available?.(release)
    await vi.waitFor(() => expect(releaseMarker(release.version)?.value).toBe(true))
    mockNotificationService.publish.mockClear()
    prefValues['app.notification.center.official.enabled'] = true
    available?.(release)
    expect(mockNotificationService.publish).not.toHaveBeenCalled()
  })

  it('retries an available release when notification storage failed', async () => {
    mockNotificationService.publish.mockResolvedValueOnce(false)
    const available = vi.mocked(autoUpdater.on).mock.calls.find(([event]) => event === 'update-available')?.[1] as
      | ((release: UpdateInfo) => void)
      | undefined
    const release = {
      version: '2.0.2',
      path: 'test-update.zip',
      sha512: 'test-checksum',
      releaseDate: new Date().toISOString(),
      files: [],
      releaseNotes: 'Release notes.'
    }
    available?.(release)
    await Promise.resolve()
    expect(releaseMarker(release.version)).toBeUndefined()
    available?.(release)
    await vi.waitFor(() => expect(releaseMarker(release.version)?.value).toBe(true))
    available?.(release)
    expect(mockNotificationService.publish).toHaveBeenCalledTimes(2)
  })

  it('skips the check while disabled but keeps the loop alive and resumes when re-enabled', async () => {
    prefValues['app.dist.auto_update.enabled'] = false
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    await appUpdater._doAllReady()

    await vi.advanceTimersByTimeAsync(INITIAL_DELAY)
    expect(autoUpdater.checkForUpdates).not.toHaveBeenCalled()
    expect(scheduler.has(SCHEDULE_ID)).toBe(true)

    prefValues['app.dist.auto_update.enabled'] = true
    await vi.advanceTimersByTimeAsync(INTERVAL)
    expect(autoUpdater.checkForUpdates).toHaveBeenCalledTimes(1)
  })

  it('backs off after a failed check and recovers normal cadence after a success', async () => {
    vi.mocked(autoUpdater.checkForUpdates).mockRejectedValue(new Error('network'))
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    await appUpdater._doAllReady()

    await vi.advanceTimersByTimeAsync(INITIAL_DELAY)
    expect(autoUpdater.checkForUpdates).toHaveBeenCalledTimes(1) // #1 failed → backoff 5min

    // Backoff (5min) is shorter than the 4h cadence; let #2 succeed.
    vi.mocked(autoUpdater.checkForUpdates).mockResolvedValue(null)
    await vi.advanceTimersByTimeAsync(BACKOFF_FIRST)
    expect(autoUpdater.checkForUpdates).toHaveBeenCalledTimes(2)

    // After success the cadence resets to ~4h: another 5min must NOT fire a check.
    await vi.advanceTimersByTimeAsync(BACKOFF_FIRST)
    expect(autoUpdater.checkForUpdates).toHaveBeenCalledTimes(2)

    await vi.advanceTimersByTimeAsync(INTERVAL - BACKOFF_FIRST)
    expect(autoUpdater.checkForUpdates).toHaveBeenCalledTimes(3)
  })

  it('does not schedule when the app is not packaged', async () => {
    setPackaged(false)
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    await appUpdater._doAllReady()

    expect(scheduler.has(SCHEDULE_ID)).toBe(false)
    await vi.advanceTimersByTimeAsync(INITIAL_DELAY + INTERVAL)
    expect(autoUpdater.checkForUpdates).not.toHaveBeenCalled()
  })

  it('unregisters the schedule on stop and stops checking', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    await appUpdater._doAllReady()

    await vi.advanceTimersByTimeAsync(INITIAL_DELAY)
    expect(autoUpdater.checkForUpdates).toHaveBeenCalledTimes(1)
    expect(scheduler.has(SCHEDULE_ID)).toBe(true)

    await appUpdater._doStop()
    expect(scheduler.has(SCHEDULE_ID)).toBe(false)

    await vi.advanceTimersByTimeAsync(INTERVAL * 2)
    expect(autoUpdater.checkForUpdates).toHaveBeenCalledTimes(1)
  })

  describe('update analytics', () => {
    const release = {
      version: '2.0.0',
      path: 'test-update.zip',
      sha512: 'test-checksum',
      releaseDate: new Date().toISOString(),
      files: [],
      releaseNotes: 'A useful update.'
    }

    it('reports a failed automatic check once, though the updater also emits its error event', async () => {
      vi.mocked(autoUpdater.checkForUpdates).mockImplementation(async () => {
        listener('error')(new Error('network'))
        throw new Error('network')
      })
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
      await appUpdater._doAllReady()

      await vi.advanceTimersByTimeAsync(INITIAL_DELAY)

      expect(updateEvents()).toEqual([{ event: 'update_checked', source: 'auto', result: 'error' }])
    })

    it('follows a manual check through a successful download', async () => {
      vi.mocked(autoUpdater.checkForUpdates).mockResolvedValue({
        isUpdateAvailable: true,
        updateInfo: release
      } as never)

      await appUpdater.checkForUpdates()
      listener('update-available')(release)
      listener('update-downloaded')(release)
      // A later failure belongs to another check, not to the finished download.
      listener('error')(new Error('later check failed'))

      expect(updateEvents()).toEqual([
        { event: 'update_checked', source: 'manual', result: 'available' },
        { event: 'update_downloaded', status: 'success' }
      ])
    })

    it('reports a download that fails after the update was found', async () => {
      listener('update-available')(release)
      listener('error')(new Error('download interrupted'))

      expect(updateEvents()).toEqual([{ event: 'update_downloaded', status: 'error', errorReason: 'other' }])
    })

    it('reports an install that fails after it started, with the reason', async () => {
      listener('update-available')(release)
      listener('update-downloaded')(release)
      appUpdater.quitAndInstall()
      listener('error')(
        Object.assign(new Error('Code signature did not pass validation'), { code: 'ERR_UPDATER_INVALID_SIGNATURE' })
      )
      // A later, unrelated error is not another install failure.
      listener('error')(new Error('later check failed'))

      expect(updateEvents().filter(({ event }) => event.startsWith('update_install'))).toEqual([
        { event: 'update_install_started' },
        { event: 'update_install_failed', errorReason: 'signature' }
      ])
    })

    it('keeps a check that fails during install staging out of the install outcome', async () => {
      let rejectCheck: (error: Error) => void = () => {}
      vi.mocked(autoUpdater.checkForUpdates).mockImplementation(async () => {
        const feedError = new Error('feed unreachable')
        listener('error')(feedError, `Cannot check for updates: ${feedError.stack}`)
        return new Promise((_, reject) => (rejectCheck = reject))
      })
      listener('update-available')(release)
      listener('update-downloaded')(release)
      appUpdater.quitAndInstall()

      // The genuine staging failure arrives while the unrelated check is still pending.
      const checking = appUpdater.checkForUpdates()
      await vi.waitFor(() => expect(autoUpdater.checkForUpdates).toHaveBeenCalled())
      listener('error')(
        Object.assign(new Error('Code signature did not pass validation'), { code: 'ERR_UPDATER_INVALID_SIGNATURE' })
      )
      rejectCheck(new Error('feed unreachable'))
      await checking

      expect(updateEvents().filter(({ event }) => event !== 'update_downloaded')).toEqual([
        { event: 'update_install_started' },
        { event: 'update_install_failed', errorReason: 'signature' },
        { event: 'update_checked', source: 'manual', result: 'error' }
      ])
    })

    it('names why a download failed by kind, never by its message', async () => {
      const failures: Array<[Error, string]> = [
        [Object.assign(new Error('sha512 checksum mismatch'), { code: 'ERR_CHECKSUM_MISMATCH' }), 'checksum'],
        [Object.assign(new Error('New version is not signed'), { code: 'ERR_UPDATER_INVALID_SIGNATURE' }), 'signature'],
        [new Error('net::ERR_INTERNET_DISCONNECTED'), 'network'],
        [new Error('Request timed out'), 'timeout'],
        [Object.assign(new Error('404 Not Found'), { statusCode: 404 }), 'server'],
        // The shape builder-util-runtime 9.7.0 gives a failed installer download: status only in the message.
        [new Error('Cannot download "https://releases.example/Setup.exe", status 503: Service Unavailable'), 'server'],
        [Object.assign(new Error('ENOSPC: no space left on device'), { code: 'ENOSPC' }), 'disk_full']
      ]
      for (const [error] of failures) {
        listener('update-available')(release)
        listener('error')(error)
      }

      expect(updateEvents().map((event) => event.errorReason)).toEqual(failures.map(([, reason]) => reason))
    })

    it('does not blame a cancelled download for the next failed check', async () => {
      vi.mocked(autoUpdater.checkForUpdates).mockImplementation(async () => {
        listener('error')(new Error('network'))
        throw new Error('network')
      })
      listener('update-available')(release)
      listener('update-cancelled')(release)

      await appUpdater.checkForUpdates()

      expect(updateEvents()).toEqual([{ event: 'update_checked', source: 'manual', result: 'error' }])
    })

    it('reports a check that finds no update, and the start of an install', async () => {
      await appUpdater.checkForUpdates()
      appUpdater.quitAndInstall()

      expect(updateEvents()).toEqual([
        { event: 'update_checked', source: 'manual', result: 'not_available' },
        { event: 'update_install_started' }
      ])
    })
  })
})
