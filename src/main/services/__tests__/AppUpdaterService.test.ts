import type { UpdateInfo } from 'builder-util-runtime'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { appEditionState, netFetchMock, releaseNotesCheckMock, releaseNotesUpdaterInstances, trackAppUpdateMock } =
  vi.hoisted(() => ({
    appEditionState: { current: 'global' },
    netFetchMock: vi.fn(),
    releaseNotesCheckMock: vi.fn(),
    releaseNotesUpdaterInstances: [] as Array<Record<string, unknown>>,
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

vi.mock('@main/core/platform', () => ({
  isWin: false
}))

vi.mock('@main/utils/appEdition', () => ({
  getAppEdition: () => appEditionState.current
}))

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
    getVersion: vi.fn(() => '1.0.0')
  },
  net: { fetch: netFetchMock }
}))

vi.mock('electron-updater', () => {
  class MockAppUpdater {
    allowDowngrade = false
    autoDownload = true
    autoInstallOnAppQuit = true
    channel = ''
    forceDevUpdateConfig = false
    logger: unknown = null
    requestHeaders: Record<string, string> = {}

    constructor(public options?: unknown) {
      releaseNotesUpdaterInstances.push(this as unknown as Record<string, unknown>)
    }

    checkForUpdates() {
      return releaseNotesCheckMock()
    }
  }

  return {
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
    AppUpdater: MockAppUpdater,
    Logger: vi.fn(),
    NsisUpdater: vi.fn()
  }
})

import { MockMainPreferenceServiceUtils } from '@test-mocks/main/PreferenceService'
import { app, net } from 'electron'
import { autoUpdater } from 'electron-updater'

import { application } from '@application'
import { regionService } from '@main/services/RegionService'
import { UpgradeChannel } from '@shared/data/preference/preferenceTypes'
import { APP_NAME } from '@shared/utils/constants'

import { AppUpdaterService } from '../AppUpdaterService'

describe('AppUpdaterService', () => {
  let appUpdater: AppUpdaterService

  beforeEach(() => {
    vi.clearAllMocks()
    MockMainPreferenceServiceUtils.resetMocks()
    MockMainPreferenceServiceUtils.setPreferenceValue('app.dist.test_plan.enabled', false)
    MockMainPreferenceServiceUtils.setPreferenceValue('app.dist.test_plan.channel', UpgradeChannel.LATEST)
    vi.mocked(app.getVersion).mockReturnValue('1.0.0')
    vi.mocked(regionService.getCountry).mockResolvedValue('US')
    vi.mocked(autoUpdater.checkForUpdates).mockResolvedValue(null)
    autoUpdater.autoDownload = false
    netFetchMock.mockReset()
    appEditionState.current = 'global'
    releaseNotesCheckMock.mockReset().mockResolvedValue(null)
    releaseNotesUpdaterInstances.length = 0
    autoUpdater.requestHeaders = {}
    autoUpdater.channel = ''
    autoUpdater.allowDowngrade = false
    autoUpdater.disableDifferentialDownload = false
    appUpdater = new AppUpdaterService()
  })

  describe('read-only update query', () => {
    it('reports an available release without using the application updater or analytics', async () => {
      releaseNotesCheckMock.mockResolvedValue({ isUpdateAvailable: true, updateInfo: { version: '2.0.0' } })
      await expect(appUpdater.queryUpdateAvailability()).resolves.toEqual({
        status: 'available',
        currentVersion: '1.0.0',
        version: '2.0.0'
      })
      expect(releaseNotesUpdaterInstances[0]).toMatchObject({ autoDownload: false, autoInstallOnAppQuit: false })
      expect(autoUpdater.checkForUpdates).not.toHaveBeenCalled()
      expect(autoUpdater.downloadUpdate).not.toHaveBeenCalled()
      expect(trackAppUpdateMock).not.toHaveBeenCalled()
    })

    it('does not turn a failed or unsupported updater query into an up-to-date result', async () => {
      releaseNotesCheckMock.mockRejectedValueOnce(new Error('HTTP 503'))
      await expect(appUpdater.queryUpdateAvailability()).rejects.toThrow('HTTP 503')
      releaseNotesCheckMock.mockResolvedValueOnce(null)
      await expect(appUpdater.queryUpdateAvailability()).rejects.toThrow('did not produce a result')
    })
  })

  describe('managed update feed', () => {
    it('uses the latest channel and global region outside China', async () => {
      await (appUpdater as any).configureUpdaterForCheck()

      expect(autoUpdater.channel).toBe(UpgradeChannel.LATEST)
      expect(autoUpdater.requestHeaders).toMatchObject({
        'User-Agent': 'test-user-agent',
        'Cache-Control': 'no-cache',
        'Client-Id': 'test-client-id',
        'App-Name': APP_NAME,
        'App-Version': 'v1.0.0',
        OS: process.platform,
        'X-Edition': 'global',
        'X-Region': 'global'
      })
      expect(autoUpdater.requestHeaders).not.toHaveProperty('X-Release-Channel')
      expect(autoUpdater.allowDowngrade).toBe(false)
      expect(autoUpdater.disableDifferentialDownload).toBe(false)
    })

    it('uses the China region for users in China', async () => {
      vi.mocked(regionService.getCountry).mockResolvedValue('CN')

      await (appUpdater as any).configureUpdaterForCheck()

      expect(autoUpdater.channel).toBe(UpgradeChannel.LATEST)
      expect(autoUpdater.requestHeaders).toMatchObject({
        'X-Region': 'cn'
      })
      expect(autoUpdater.requestHeaders).not.toHaveProperty('X-Release-Channel')
    })

    it('uses the China edition stable channel', async () => {
      appEditionState.current = 'cn'

      await (appUpdater as any).configureUpdaterForCheck()

      expect(autoUpdater.channel).toBe('latest-cn')
      expect(autoUpdater.requestHeaders).toMatchObject({
        'X-Edition': 'cn',
        'X-Region': 'global'
      })
    })

    it('keeps existing updater request headers', async () => {
      autoUpdater.requestHeaders = { Authorization: 'existing-header' }

      await (appUpdater as any).configureUpdaterForCheck()

      expect(autoUpdater.requestHeaders).toMatchObject({
        Authorization: 'existing-header',
        'X-Region': 'global'
      })
    })

    it.each([
      ['RC', UpgradeChannel.RC],
      ['Beta', UpgradeChannel.BETA]
    ])('requests the %s manifest when that test channel is enabled', async (_label, channel) => {
      MockMainPreferenceServiceUtils.setPreferenceValue('app.dist.test_plan.enabled', true)
      MockMainPreferenceServiceUtils.setPreferenceValue('app.dist.test_plan.channel', channel)

      await (appUpdater as any).configureUpdaterForCheck()

      expect(autoUpdater.channel).toBe(channel)
    })

    it.each([
      ['RC', UpgradeChannel.RC, 'rc-cn'],
      ['Beta', UpgradeChannel.BETA, 'beta-cn']
    ])(
      'requests the China edition %s manifest when that test channel is enabled',
      async (_label, channel, expected) => {
        appEditionState.current = 'cn'
        MockMainPreferenceServiceUtils.setPreferenceValue('app.dist.test_plan.enabled', true)
        MockMainPreferenceServiceUtils.setPreferenceValue('app.dist.test_plan.channel', channel)

        await (appUpdater as any).configureUpdaterForCheck()

        expect(autoUpdater.channel).toBe(expected)
      }
    )

    it('uses the selected test channel when the installed prerelease came from another channel', async () => {
      vi.mocked(app.getVersion).mockReturnValue('2.0.0-rc.1')
      MockMainPreferenceServiceUtils.setPreferenceValue('app.dist.test_plan.enabled', true)
      MockMainPreferenceServiceUtils.setPreferenceValue('app.dist.test_plan.channel', UpgradeChannel.BETA)

      await (appUpdater as any).configureUpdaterForCheck()

      expect(autoUpdater.channel).toBe(UpgradeChannel.BETA)
    })

    it('applies the channel and request headers before checking for updates', async () => {
      vi.mocked(autoUpdater.checkForUpdates).mockImplementation(async () => {
        expect(autoUpdater.channel).toBe(UpgradeChannel.LATEST)
        expect(autoUpdater.requestHeaders).toMatchObject({
          'App-Version': 'v1.0.0',
          'X-Edition': 'global',
          'X-Region': 'global'
        })
        return null
      })

      await appUpdater.checkForUpdates()

      expect(autoUpdater.checkForUpdates).toHaveBeenCalledOnce()
    })

    it('keeps the feed release and drops a delayed download from the previous check', async () => {
      const listeners = new Map<string, (...args: unknown[]) => void>()
      vi.mocked(autoUpdater.on).mockImplementation(((event: string, handler: (...args: unknown[]) => void) => {
        listeners.set(event, handler)
        return autoUpdater
      }) as typeof autoUpdater.on)
      const updater = appUpdater as unknown as {
        registerDisposable: () => void
        registerAutoUpdaterListeners: () => void
      }
      updater.registerDisposable = () => undefined
      updater.registerAutoUpdaterListeners()
      const ipc = application.get('IpcApiService')
      const release = (version: string) => ({
        version,
        files: [],
        path: 'app.zip',
        sha512: 'x',
        releaseDate: '2026-01-01'
      })
      const emit = (event: string, payload?: unknown) => listeners.get(event)?.(payload)
      const checked = (version: string) => ({
        isUpdateAvailable: true,
        updateInfo: release(version),
        cancellationToken: { cancel: vi.fn() }
      })
      MockMainPreferenceServiceUtils.setPreferenceValue('app.dist.test_plan.enabled', true)
      MockMainPreferenceServiceUtils.setPreferenceValue('app.dist.test_plan.channel', UpgradeChannel.BETA)
      vi.mocked(autoUpdater.checkForUpdates).mockResolvedValueOnce(checked('1.2.4') as never)

      await appUpdater.checkForUpdates()

      expect(autoUpdater.channel).toBe(UpgradeChannel.BETA)
      expect(ipc.broadcastToType).toHaveBeenCalledWith(
        'main',
        'app.updater.available',
        expect.objectContaining({ version: '1.2.4' })
      )
      vi.mocked(ipc.broadcastToType).mockClear()
      emit('update-downloaded', release('1.2.3-beta.1'))
      expect(ipc.broadcastToType).not.toHaveBeenCalled()
      emit('download-progress', { percent: 10 })
      emit('update-downloaded', release('1.2.4'))
      expect(ipc.broadcastToType).toHaveBeenCalledWith('main', 'app.updater.download_progress', { percent: 10 })
      expect(ipc.broadcastToType).toHaveBeenCalledWith(
        'main',
        'app.updater.downloaded',
        expect.objectContaining({ version: '1.2.4' })
      )

      vi.mocked(ipc.broadcastToType).mockClear()
      appUpdater.cancelDownload()
      emit('update-downloaded', release('1.2.4'))
      expect(ipc.broadcastToType).not.toHaveBeenCalled()

      vi.mocked(autoUpdater.checkForUpdates).mockImplementationOnce(async () => {
        emit('update-downloaded', release('1.2.4'))
        return checked('1.3.0') as never
      })
      await appUpdater.checkForUpdates()
      expect(ipc.broadcastToType).not.toHaveBeenCalledWith(
        'main',
        'app.updater.downloaded',
        expect.objectContaining({ version: '1.2.4' })
      )
      expect(ipc.broadcastToType).toHaveBeenCalledWith(
        'main',
        'app.updater.available',
        expect.objectContaining({ version: '1.3.0' })
      )
      emit('update-downloaded', release('1.3.0'))
      expect(ipc.broadcastToType).toHaveBeenCalledWith(
        'main',
        'app.updater.downloaded',
        expect.objectContaining({ version: '1.3.0' })
      )
    })

    it('waits out the updater in-flight promise before accepting the next channel', async () => {
      const listeners = new Map<string, (...args: unknown[]) => void>()
      vi.mocked(autoUpdater.on).mockImplementation(((event: string, handler: (...args: unknown[]) => void) => {
        listeners.set(event, handler)
        return autoUpdater
      }) as typeof autoUpdater.on)
      const updater = appUpdater as unknown as {
        registerDisposable: () => void
        registerAutoUpdaterListeners: () => void
      }
      updater.registerDisposable = () => undefined
      updater.registerAutoUpdaterListeners()
      const ipc = application.get('IpcApiService')
      const release = (version: string) => ({
        version,
        files: [],
        path: 'app.zip',
        sha512: 'x',
        releaseDate: '2026-01-01'
      })
      const emit = (event: string, payload?: unknown) => listeners.get(event)?.(payload)
      const checked = (version: string) => ({
        isUpdateAvailable: true,
        updateInfo: release(version),
        cancellationToken: { cancel: vi.fn() }
      })
      let inflight: Promise<unknown> | null = null
      let releaseFirst: (value: unknown) => void = () => undefined
      const firstResult = new Promise((resolve) => {
        releaseFirst = resolve
      })
      let started = 0
      vi.mocked(autoUpdater.checkForUpdates).mockImplementation(() => {
        if (inflight) return inflight as never
        started += 1
        if (started === 1) {
          inflight = firstResult.finally(() => {
            inflight = null
          })
          return inflight as never
        }
        return Promise.resolve(checked('1.3.0')) as never
      })
      MockMainPreferenceServiceUtils.setPreferenceValue('app.dist.test_plan.enabled', true)
      MockMainPreferenceServiceUtils.setPreferenceValue('app.dist.test_plan.channel', UpgradeChannel.BETA)

      const firstCheck = appUpdater.checkForUpdates()
      await vi.waitFor(() => expect(autoUpdater.checkForUpdates).toHaveBeenCalledTimes(1))
      appUpdater.cancelDownload()
      MockMainPreferenceServiceUtils.setPreferenceValue('app.dist.test_plan.enabled', false)
      MockMainPreferenceServiceUtils.setPreferenceValue('app.dist.test_plan.channel', UpgradeChannel.LATEST)
      const secondCheck = appUpdater.checkForUpdates()
      expect(autoUpdater.checkForUpdates).toHaveBeenCalledTimes(1)

      emit('error', new Error('old channel'))
      emit('update-not-available')
      expect(ipc.broadcastToType).not.toHaveBeenCalled()

      releaseFirst(checked('1.2.3-beta.1'))
      await expect(firstCheck).resolves.toMatchObject({ updateInfo: null })
      await expect(secondCheck).resolves.toMatchObject({ updateInfo: { version: '1.3.0' } })
      expect(autoUpdater.checkForUpdates).toHaveBeenCalledTimes(2)
      expect(autoUpdater.channel).toBe(UpgradeChannel.LATEST)
      expect(ipc.broadcastToType).not.toHaveBeenCalledWith(
        'main',
        'app.updater.available',
        expect.objectContaining({ version: '1.2.3-beta.1' })
      )
      expect(ipc.broadcastToType).not.toHaveBeenCalledWith('main', 'app.updater.error', expect.anything())
      expect(ipc.broadcastToType).not.toHaveBeenCalledWith('main', 'app.updater.not_available', undefined)
      expect(ipc.broadcastToType).toHaveBeenCalledWith(
        'main',
        'app.updater.available',
        expect.objectContaining({ version: '1.3.0' })
      )
    })

    it('settles a canceled download before the next channel starts its own', async () => {
      const listeners = new Map<string, (...args: unknown[]) => void>()
      vi.mocked(autoUpdater.on).mockImplementation(((event: string, handler: (...args: unknown[]) => void) => {
        listeners.set(event, handler)
        return autoUpdater
      }) as typeof autoUpdater.on)
      const updater = appUpdater as unknown as {
        registerDisposable: () => void
        registerAutoUpdaterListeners: () => void
      }
      updater.registerDisposable = () => undefined
      updater.registerAutoUpdaterListeners()
      const ipc = application.get('IpcApiService')
      const release = (version: string) => ({
        version,
        files: [],
        path: 'app.zip',
        sha512: 'x',
        releaseDate: '2026-01-01'
      })
      const emit = (event: string, payload?: unknown) => listeners.get(event)?.(payload)
      const checked = (version: string) => ({
        isUpdateAvailable: true,
        updateInfo: release(version),
        cancellationToken: { cancel: vi.fn() }
      })
      autoUpdater.autoDownload = true
      let libraryDownload: Promise<unknown> | null = null
      const downloads: { reject: (error: unknown) => void }[] = []
      vi.mocked(autoUpdater.downloadUpdate).mockImplementation(() => {
        if (libraryDownload) return libraryDownload as never
        let rejectDownload: (error: unknown) => void = () => undefined
        const created = new Promise((resolve, reject) => {
          rejectDownload = reject
          void resolve
        })
        const tracked = created.finally(() => {
          libraryDownload = null
        })
        libraryDownload = tracked
        downloads.push({ reject: rejectDownload })
        return tracked as never
      })
      let checks = 0
      vi.mocked(autoUpdater.checkForUpdates).mockImplementation(async () => {
        checks += 1
        const result = checked(checks === 1 ? '1.2.3-beta.1' : '1.3.0')
        return { ...result, downloadPromise: autoUpdater.downloadUpdate() } as never
      })
      MockMainPreferenceServiceUtils.setPreferenceValue('app.dist.test_plan.enabled', true)
      MockMainPreferenceServiceUtils.setPreferenceValue('app.dist.test_plan.channel', UpgradeChannel.BETA)

      await expect(appUpdater.checkForUpdates()).resolves.toMatchObject({ updateInfo: { version: '1.2.3-beta.1' } })
      expect(autoUpdater.downloadUpdate).toHaveBeenCalledTimes(1)
      appUpdater.cancelDownload()
      vi.mocked(ipc.broadcastToType).mockClear()
      MockMainPreferenceServiceUtils.setPreferenceValue('app.dist.test_plan.enabled', false)
      MockMainPreferenceServiceUtils.setPreferenceValue('app.dist.test_plan.channel', UpgradeChannel.LATEST)

      const secondCheck = appUpdater.checkForUpdates()
      for (let step = 0; step < 10; step += 1) await Promise.resolve()
      expect(autoUpdater.checkForUpdates).toHaveBeenCalledTimes(1)
      expect(autoUpdater.downloadUpdate).toHaveBeenCalledTimes(1)
      emit('error', new Error('old channel'))
      emit('update-not-available')
      expect(ipc.broadcastToType).not.toHaveBeenCalled()

      downloads[0]?.reject(new Error('cancelled'))
      await expect(secondCheck).resolves.toMatchObject({ updateInfo: { version: '1.3.0' } })
      expect(autoUpdater.checkForUpdates).toHaveBeenCalledTimes(2)
      expect(autoUpdater.downloadUpdate).toHaveBeenCalledTimes(2)
      expect(autoUpdater.channel).toBe(UpgradeChannel.LATEST)
      emit('error', new Error('disk full'))
      expect(ipc.broadcastToType).toHaveBeenCalledWith(
        'main',
        'app.updater.error',
        expect.objectContaining({ message: 'disk full' })
      )
      expect(ipc.broadcastToType).not.toHaveBeenCalledWith(
        'main',
        'app.updater.error',
        expect.objectContaining({ message: 'old channel' })
      )
      expect(ipc.broadcastToType).not.toHaveBeenCalledWith(
        'main',
        'app.updater.error',
        expect.objectContaining({ message: 'cancelled' })
      )
    })

    it('cancels the auto download a retired check returns after the channel changed', async () => {
      const listeners = new Map<string, (...args: unknown[]) => void>()
      vi.mocked(autoUpdater.on).mockImplementation(((event: string, handler: (...args: unknown[]) => void) => {
        listeners.set(event, handler)
        return autoUpdater
      }) as typeof autoUpdater.on)
      const updater = appUpdater as unknown as {
        registerDisposable: () => void
        registerAutoUpdaterListeners: () => void
      }
      updater.registerDisposable = () => undefined
      updater.registerAutoUpdaterListeners()
      const ipc = application.get('IpcApiService')
      const release = (version: string) => ({
        version,
        files: [],
        path: 'app.zip',
        sha512: 'x',
        releaseDate: '2026-01-01'
      })
      autoUpdater.autoDownload = true
      let releaseOld: (value: unknown) => void = () => undefined
      const oldCheck = new Promise((resolve) => {
        releaseOld = resolve
      })
      let rejectOldDownload: (error: unknown) => void = () => undefined
      const oldDownload = new Promise((resolve, reject) => {
        rejectOldDownload = reject
        void resolve
      })
      const oldToken = {
        cancel: vi.fn(() => {
          rejectOldDownload(new Error('cancelled'))
        })
      }
      let checks = 0
      vi.mocked(autoUpdater.checkForUpdates).mockImplementation(() => {
        checks += 1
        if (checks === 1) return oldCheck as never
        return Promise.resolve({
          isUpdateAvailable: true,
          updateInfo: release('1.3.0'),
          cancellationToken: { cancel: vi.fn() },
          downloadPromise: Promise.resolve(['/tmp/new.zip'])
        }) as never
      })
      MockMainPreferenceServiceUtils.setPreferenceValue('app.dist.test_plan.enabled', true)
      MockMainPreferenceServiceUtils.setPreferenceValue('app.dist.test_plan.channel', UpgradeChannel.BETA)

      const firstCheck = appUpdater.checkForUpdates()
      await vi.waitFor(() => expect(autoUpdater.checkForUpdates).toHaveBeenCalledTimes(1))
      appUpdater.cancelDownload()
      MockMainPreferenceServiceUtils.setPreferenceValue('app.dist.test_plan.enabled', false)
      MockMainPreferenceServiceUtils.setPreferenceValue('app.dist.test_plan.channel', UpgradeChannel.LATEST)
      const secondCheck = appUpdater.checkForUpdates()
      expect(autoUpdater.checkForUpdates).toHaveBeenCalledTimes(1)

      releaseOld({
        isUpdateAvailable: true,
        updateInfo: release('1.2.3-beta.1'),
        cancellationToken: oldToken,
        downloadPromise: oldDownload
      })
      await expect(firstCheck).resolves.toMatchObject({ updateInfo: null })
      expect(oldToken.cancel).toHaveBeenCalledOnce()
      await expect(secondCheck).resolves.toMatchObject({ updateInfo: { version: '1.3.0' } })
      expect(autoUpdater.channel).toBe(UpgradeChannel.LATEST)
      expect(ipc.broadcastToType).not.toHaveBeenCalledWith(
        'main',
        'app.updater.available',
        expect.objectContaining({ version: '1.2.3-beta.1' })
      )
      expect(ipc.broadcastToType).toHaveBeenCalledWith(
        'main',
        'app.updater.available',
        expect.objectContaining({ version: '1.3.0' })
      )
    })

    it('fetches and validates release history through the managed release service', async () => {
      vi.mocked(regionService.getCountry).mockResolvedValue('CN')
      const releaseNotes = '<!--LANG:en-->Remote notes<!--LANG:zh-CN-->远端说明<!--LANG:END-->'
      const history = [{ releaseNotes, version: '1.1.0' }]
      netFetchMock.mockResolvedValue(new Response(JSON.stringify(history)))

      await expect(appUpdater.getReleaseHistory()).resolves.toEqual(history)

      expect(net.fetch).toHaveBeenCalledWith(
        'https://releases.cherry-ai.com/release-history.json',
        expect.objectContaining({
          headers: expect.objectContaining({
            'App-Version': 'v1.0.0',
            'X-Edition': 'global',
            'X-Region': 'cn'
          }),
          redirect: 'follow',
          signal: expect.any(AbortSignal)
        })
      )
      expect(releaseNotesUpdaterInstances).toHaveLength(1)
    })

    it('uses the China edition channel for the latest release notes request', async () => {
      appEditionState.current = 'cn'
      MockMainPreferenceServiceUtils.setPreferenceValue('app.dist.test_plan.enabled', true)
      MockMainPreferenceServiceUtils.setPreferenceValue('app.dist.test_plan.channel', UpgradeChannel.RC)
      releaseNotesCheckMock.mockResolvedValue(null)

      await appUpdater.getLatestReleaseNotes()

      expect(releaseNotesUpdaterInstances).toHaveLength(1)
      expect(releaseNotesUpdaterInstances[0]).toMatchObject({
        channel: 'rc-cn',
        requestHeaders: expect.objectContaining({ 'X-Edition': 'cn' })
      })
    })

    it('merges a newer channel release with stable release history', async () => {
      const stableNotes = '<!--LANG:en-->Stable notes<!--LANG:zh-CN-->稳定版说明<!--LANG:END-->'
      const rcNotes = '<!--LANG:en-->RC notes<!--LANG:zh-CN-->测试版说明<!--LANG:END-->'
      netFetchMock.mockResolvedValue(new Response(JSON.stringify([{ releaseNotes: stableNotes, version: '1.1.0' }])))
      releaseNotesCheckMock.mockResolvedValue({
        isUpdateAvailable: true,
        updateInfo: { releaseNotes: rcNotes, version: '1.2.0-rc.1' }
      })

      await expect(appUpdater.getReleaseHistory()).resolves.toEqual([
        { releaseNotes: rcNotes, version: '1.2.0-rc.1' },
        { releaseNotes: stableNotes, version: '1.1.0' }
      ])
    })

    it('keeps newer updater notes when release history is unavailable', async () => {
      netFetchMock.mockRejectedValue(new Error('offline'))
      releaseNotesCheckMock.mockResolvedValue({
        isUpdateAvailable: true,
        updateInfo: { releaseNotes: 'New release notes', version: '1.1.0' }
      })

      await expect(appUpdater.getReleaseHistory()).resolves.toEqual([
        { releaseNotes: 'New release notes', version: '1.1.0' }
      ])
    })

    it('falls back to bundled history when the managed response is invalid', async () => {
      netFetchMock.mockResolvedValue(new Response(JSON.stringify([{ releaseNotes: 'English only', version: '1.1.0' }])))

      await expect(appUpdater.getReleaseHistory()).resolves.toBeNull()
    })

    it('falls back to bundled history when the managed request fails', async () => {
      netFetchMock.mockRejectedValue(new Error('offline'))

      await expect(appUpdater.getReleaseHistory()).resolves.toBeNull()
    })

    it('rejects release history larger than the response limit before reading it', async () => {
      const text = vi.fn()
      netFetchMock.mockResolvedValue({
        headers: new Headers({ 'content-length': String(1024 * 1024 + 1) }),
        ok: true,
        status: 200,
        text
      })

      await expect(appUpdater.getReleaseHistory()).resolves.toBeNull()
      expect(text).not.toHaveBeenCalled()
    })
  })

  describe('processReleaseInfo', () => {
    it('localizes marked release notes', () => {
      MockMainPreferenceServiceUtils.setPreferenceValue('app.language', 'zh-CN')
      const releaseInfo = {
        version: '1.0.0',
        files: [],
        path: '',
        sha512: '',
        releaseDate: new Date().toISOString(),
        releaseNotes: '<!--LANG:en-->English notes<!--LANG:zh-CN-->中文说明<!--LANG:END-->'
      } as UpdateInfo

      const result = (appUpdater as any).processReleaseInfo(releaseInfo)

      expect(result.releaseNotes).toBe('中文说明')
    })

    it('leaves unmarked release notes unchanged', () => {
      const releaseInfo = {
        version: '1.0.0',
        files: [],
        path: '',
        sha512: '',
        releaseDate: new Date().toISOString(),
        releaseNotes: 'Simple release notes'
      } as UpdateInfo

      expect((appUpdater as any).processReleaseInfo(releaseInfo).releaseNotes).toBe('Simple release notes')
    })

    it('leaves array release notes unchanged', () => {
      const releaseInfo = {
        version: '1.0.0',
        files: [],
        path: '',
        sha512: '',
        releaseDate: new Date().toISOString(),
        releaseNotes: [
          { version: '1.0.0', note: 'Note 1' },
          { version: '1.0.1', note: 'Note 2' }
        ]
      } as UpdateInfo

      expect((appUpdater as any).processReleaseInfo(releaseInfo).releaseNotes).toEqual(releaseInfo.releaseNotes)
    })

    it('leaves null release notes unchanged', () => {
      const releaseInfo = {
        version: '1.0.0',
        files: [],
        path: '',
        sha512: '',
        releaseDate: new Date().toISOString(),
        releaseNotes: null
      } as UpdateInfo

      expect((appUpdater as any).processReleaseInfo(releaseInfo).releaseNotes).toBeNull()
    })

    it('leaves marked release notes unchanged when language lookup fails', () => {
      const releaseInfo = {
        version: '1.0.0',
        files: [],
        path: '',
        sha512: '',
        releaseDate: new Date().toISOString(),
        releaseNotes: '<!--LANG:en-->English notes<!--LANG:zh-CN-->中文说明<!--LANG:END-->'
      } as UpdateInfo
      vi.mocked(application.get('PreferenceService').get).mockImplementationOnce(() => {
        throw new Error('Test error')
      })

      expect((appUpdater as any).processReleaseInfo(releaseInfo).releaseNotes).toBe(releaseInfo.releaseNotes)
    })
  })
})
