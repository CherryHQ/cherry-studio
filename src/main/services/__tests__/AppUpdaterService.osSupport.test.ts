import type os from 'node:os'

import { beforeEach, describe, expect, it, vi } from 'vitest'

const { osReleaseMock, trackAppUpdateMock } = vi.hoisted(() => ({
  osReleaseMock: vi.fn(() => '10.0.19044'),
  trackAppUpdateMock: vi.fn()
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn()
    })
  }
}))

vi.mock('@data/PreferenceService', async () => {
  const { MockMainPreferenceServiceExport } = await import('@test-mocks/main/PreferenceService')
  return MockMainPreferenceServiceExport
})

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  const result = mockApplicationFactory()
  const originalGet = result.application.get.getMockImplementation()!
  result.application.get.mockImplementation((name: string) => {
    if (name === 'AnalyticsService') {
      return { trackAppUpdate: trackAppUpdateMock }
    }
    return originalGet(name)
  })
  return result
})

vi.mock('@main/core/lifecycle', () => {
  class MockBaseService {}
  return {
    BaseService: MockBaseService,
    Injectable: () => (target: unknown) => target,
    ServicePhase: () => (target: unknown) => target,
    DependsOn: () => (target: unknown) => target,
    Phase: { Background: 'background', WhenReady: 'whenReady', BeforeReady: 'beforeReady' }
  }
})

// Simulate a Windows machine for the OS gate.
vi.mock('@main/core/platform', () => ({
  isWin: true
}))

vi.mock('@main/utils/appEdition', () => ({
  getAppEdition: () => 'global'
}))

vi.mock('@main/core/macElectronBridge', () => ({
  isMacElectronBridgePackage: () => false
}))

vi.mock('@main/services/RegionService', () => ({
  regionService: { getCountry: vi.fn(async () => 'US') }
}))

vi.mock('@main/utils/systemInfo', () => ({
  generateUserAgent: vi.fn(() => 'test-user-agent'),
  getClientId: vi.fn(() => 'test-client-id')
}))

vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof os>()
  const mocked = { ...actual, release: osReleaseMock }
  return {
    ...mocked,
    default: mocked
  }
})

vi.mock('electron', () => ({
  app: {
    isPackaged: true,
    getVersion: vi.fn(() => '1.0.0'),
    getLocale: vi.fn(() => 'en-US')
  },
  net: { fetch: vi.fn() }
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
  AppUpdater: class MockAppUpdater {
    requestHeaders: Record<string, string> = {}
    channel = ''
    checkForUpdates = vi.fn()
  },
  Logger: vi.fn(),
  NsisUpdater: vi.fn()
}))

import { MockMainPreferenceServiceUtils } from '@test-mocks/main/PreferenceService'
import { autoUpdater } from 'electron-updater'

import { AppUpdaterService } from '../AppUpdaterService'

describe('AppUpdaterService — unsupported Windows gate', () => {
  let appUpdater: AppUpdaterService

  beforeEach(() => {
    vi.clearAllMocks()
    MockMainPreferenceServiceUtils.resetMocks()
    autoUpdater.requestHeaders = {}
    appUpdater = new AppUpdaterService()
  })

  it('reports current without a feed request on Windows 7', async () => {
    osReleaseMock.mockReturnValue('6.1.7601')
    const checkSpy = vi.mocked(autoUpdater.checkForUpdates)

    await expect(appUpdater.checkForUpdates()).resolves.toMatchObject({
      currentVersion: '1.0.0',
      updateInfo: null
    })
    expect(checkSpy).not.toHaveBeenCalled()

    await expect(appUpdater.queryUpdateAvailability()).resolves.toMatchObject({ status: 'current' })
    expect(checkSpy).not.toHaveBeenCalled()

    await expect(appUpdater.getLatestReleaseNotes()).resolves.toBeNull()
  })

  it('checks normally on supported Windows 10 builds', async () => {
    osReleaseMock.mockReturnValue('10.0.19044')
    const checkSpy = vi.mocked(autoUpdater.checkForUpdates)
    checkSpy.mockResolvedValue({ isUpdateAvailable: false } as never)

    await appUpdater.checkForUpdates()
    expect(checkSpy).toHaveBeenCalledOnce()
    expect(autoUpdater.requestHeaders).toMatchObject({ 'X-OS-Release': '10.0.19044' })
  })
})
