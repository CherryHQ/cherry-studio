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

import { application } from '@application'
import { BaseService } from '@main/core/lifecycle/BaseService'
import { SchedulerService } from '@main/core/scheduler/SchedulerService'
import { regionService } from '@main/services/RegionService'
import { app, net } from 'electron'
import { autoUpdater } from 'electron-updater'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AppUpdaterService } from '../AppUpdaterService'

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() })
  }
}))

vi.mock('@main/core/platform', () => ({ isWin: false }))

vi.mock('@main/services/RegionService', () => ({
  regionService: { getCountry: vi.fn(() => 'US') }
}))

vi.mock('@main/utils/systemInfo', () => ({
  generateUserAgent: vi.fn(() => 'test-user-agent'),
  getClientId: vi.fn(() => 'test-client-id')
}))

vi.mock('electron', () => ({
  app: {
    isPackaged: true,
    getVersion: vi.fn(() => '1.0.0'),
    getPath: vi.fn(() => '/test/path')
  },
  net: { fetch: vi.fn() },
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
    setFeedURL: vi.fn(),
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
  let scheduler: SchedulerService
  let appUpdater: AppUpdaterService
  let prefValues: Record<string, unknown>

  beforeEach(async () => {
    BaseService.resetInstances()
    setPackaged(true)

    prefValues = {
      'app.dist.auto_update.enabled': true,
      'app.dist.test_plan.enabled': false,
      'app.dist.test_plan.channel': undefined,
      'app.language': 'en'
    }
    const prefStub = {
      get: vi.fn((key: string) => prefValues[key]),
      // onInit subscribes to test_plan changes; return an unsubscribe fn.
      subscribeMultipleChanges: vi.fn(() => vi.fn())
    }
    const powerStub = { registerShutdownHandler: vi.fn() }
    const analyticsStub = { trackAppUpdate: vi.fn() }
    const windowManagerStub = { broadcastToType: vi.fn() }

    scheduler = new SchedulerService()
    appUpdater = new AppUpdaterService()

    ;(application.get as ReturnType<typeof vi.fn>).mockImplementation((name: string) => {
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
        default:
          throw new Error(`unexpected application.get('${name}')`)
      }
    })

    vi.mocked(regionService.getCountry).mockReturnValue('US' as never)
    // Remote config fetch fails → falls back to the default feed URL (the check
    // itself still runs); keeps these tests off the network.
    vi.mocked(net.fetch).mockRejectedValue(new Error('no remote config'))
    vi.mocked(autoUpdater.checkForUpdates).mockResolvedValue(null)
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

  it('runs an initial check shortly after startup when packaged and enabled', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    await appUpdater._doAllReady()

    expect(autoUpdater.checkForUpdates).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(INITIAL_DELAY)
    expect(autoUpdater.checkForUpdates).toHaveBeenCalledTimes(1)
  })

  it('reschedules the next check ~4h after a success', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    await appUpdater._doAllReady()

    await vi.advanceTimersByTimeAsync(INITIAL_DELAY)
    expect(autoUpdater.checkForUpdates).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(INTERVAL - 1000)
    expect(autoUpdater.checkForUpdates).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(1000)
    expect(autoUpdater.checkForUpdates).toHaveBeenCalledTimes(2)
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
})
