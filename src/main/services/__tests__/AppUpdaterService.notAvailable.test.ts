/** Withheld-feed tests: distinguish a withheld rollout from a genuine up-to-date install. */

import type { UpdateInfo } from 'builder-util-runtime'
import { app } from 'electron'
import { autoUpdater } from 'electron-updater'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import { BaseService } from '@main/core/lifecycle/BaseService'
import { WindowType } from '@main/core/window/types'

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

vi.mock('@main/utils/systemInfo', () => ({
  generateUserAgent: vi.fn(() => 'test-user-agent'),
  getClientId: vi.fn(() => 'test-client-id')
}))

vi.mock('electron', () => ({
  app: {
    isPackaged: true,
    getVersion: vi.fn(() => '2.0.13'),
    getPath: vi.fn(() => '/test/path')
  },
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
    currentVersion: '2.0.13'
  },
  Logger: vi.fn(),
  NsisUpdater: vi.fn(),
  AppUpdater: vi.fn()
}))

vi.mock('@application', async () => {
  const mod = await import('@test-mocks/main/application')
  const result = mod.mockApplicationFactory()
  const originalGet = result.application.get.getMockImplementation()!
  result.application.get.mockImplementation((name: string) =>
    name === 'AnalyticsService' ? { trackAppUpdate: vi.fn() } : originalGet(name)
  )
  return result
})

function feedInfo(version: string): UpdateInfo {
  return {
    version,
    files: [],
    path: 'Cherry-Studio.exe',
    sha512: 'checksum',
    releaseDate: '2026-09-01T00:00:00.000Z'
  }
}

describe('AppUpdaterService — update-not-available feed target', () => {
  let onUpdateNotAvailable: ((info: UpdateInfo) => void) | undefined
  let appUpdater: AppUpdaterService

  beforeEach(async () => {
    vi.clearAllMocks()
    BaseService.resetInstances()
    vi.mocked(app.getVersion).mockReturnValue('2.0.13')

    appUpdater = new AppUpdaterService()
    await appUpdater._doInit()

    const calls = vi.mocked(autoUpdater.on).mock.calls
    onUpdateNotAvailable = calls.find(([event]) => event === 'update-not-available')?.[1] as
      | ((info: UpdateInfo) => void)
      | undefined
    expect(onUpdateNotAvailable).toBeDefined()
  })

  // Updater events only count inside a check, so emit from within one.
  async function emitNotAvailable(info: UpdateInfo) {
    vi.mocked(autoUpdater.checkForUpdates).mockImplementationOnce(async () => {
      onUpdateNotAvailable?.(info)
      return { isUpdateAvailable: false, updateInfo: info } as never
    })
    await appUpdater.checkForUpdates()
    return vi.mocked(application.get('IpcApiService').broadcastToType)
  }

  it('marks the install current when the feed target matches it', async () => {
    const broadcast = await emitNotAvailable(feedInfo('2.0.13'))

    expect(broadcast).toHaveBeenCalledExactlyOnceWith(expect.anything(), 'app.updater.not_available', {
      isCurrent: true
    })
  })

  it('marks a feed behind the install as withheld instead of current', async () => {
    const broadcast = await emitNotAvailable(feedInfo('2.0.9'))

    expect(broadcast).toHaveBeenCalledExactlyOnceWith(expect.anything(), 'app.updater.not_available', {
      isCurrent: false
    })
  })

  it('marks a newer unoffered feed target as withheld instead of current', async () => {
    vi.mocked(app.getVersion).mockReturnValue('2.0.9')

    const broadcast = await emitNotAvailable(feedInfo('2.0.14'))

    expect(broadcast).toHaveBeenCalledExactlyOnceWith(expect.anything(), 'app.updater.not_available', {
      isCurrent: false
    })
  })

  it('treats a prerelease install ahead of its stable feed as current', async () => {
    vi.mocked(app.getVersion).mockReturnValue('2.0.14-beta.1')

    const broadcast = await emitNotAvailable(feedInfo('2.0.9'))

    expect(broadcast).toHaveBeenCalledExactlyOnceWith(expect.anything(), 'app.updater.not_available', {
      isCurrent: true
    })
  })

  it('marks a prerelease install withheld when the feed advertises a newer prerelease', async () => {
    vi.mocked(app.getVersion).mockReturnValue('2.0.14-beta.1')

    const broadcast = await emitNotAvailable(feedInfo('2.0.14-beta.2'))

    expect(broadcast).toHaveBeenCalledExactlyOnceWith(expect.anything(), 'app.updater.not_available', {
      isCurrent: false
    })
  })

  it('keeps diagnostic versions in main-process logs rather than the broadcast payload', async () => {
    const broadcast = await emitNotAvailable(feedInfo('2.0.9'))

    expect(Object.keys(broadcast.mock.calls[0][2] as object)).toEqual(['isCurrent'])
  })

  it('fails closed to current when the feed version is missing, empty, or unparseable', async () => {
    const broadcastMissing = await emitNotAvailable({ ...feedInfo('2.0.13'), version: undefined as unknown as string })
    expect(broadcastMissing).toHaveBeenLastCalledWith(expect.anything(), 'app.updater.not_available', {
      isCurrent: true
    })

    const broadcastEmpty = await emitNotAvailable(feedInfo(''))
    expect(broadcastEmpty).toHaveBeenLastCalledWith(expect.anything(), 'app.updater.not_available', { isCurrent: true })

    const broadcastGarbage = await emitNotAvailable(feedInfo('not-a-version'))
    expect(broadcastGarbage).toHaveBeenLastCalledWith(expect.anything(), 'app.updater.not_available', {
      isCurrent: true
    })
  })

  it('scopes the broadcast to the main window', async () => {
    const broadcast = await emitNotAvailable(feedInfo('2.0.13'))

    expect(broadcast.mock.calls[0][0]).toBe(WindowType.Main)
  })
})
