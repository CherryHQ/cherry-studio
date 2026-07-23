import type { UpdateInfo } from 'builder-util-runtime'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { trackAppUpdateMock } = vi.hoisted(() => ({
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
  net: {
    fetch: vi.fn()
  }
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

import { application } from '@application'
import { regionService } from '@main/services/RegionService'
import { getClientId } from '@main/utils/systemInfo'
import { UpgradeChannel } from '@shared/data/preference/preferenceTypes'
import { APP_NAME } from '@shared/utils/constants'
import { MockMainPreferenceServiceUtils } from '@test-mocks/main/PreferenceService'
import { app, net } from 'electron'
import { autoUpdater } from 'electron-updater'

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
    autoUpdater.requestHeaders = {}
    autoUpdater.channel = ''
    autoUpdater.allowDowngrade = false
    autoUpdater.disableDifferentialDownload = false
    appUpdater = new AppUpdaterService()
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
        'X-Region': 'global'
      })
      expect(autoUpdater.requestHeaders).not.toHaveProperty('X-Release-Channel')
      expect(autoUpdater.allowDowngrade).toBe(false)
      expect(autoUpdater.disableDifferentialDownload).toBe(true)
    })

    it('uses the China region for users in China', async () => {
      vi.mocked(regionService.getCountry).mockResolvedValue('CN')

      await (appUpdater as any).configureUpdaterForCheck()

      expect(autoUpdater.requestHeaders).toMatchObject({
        'X-Region': 'cn'
      })
      expect(autoUpdater.requestHeaders).not.toHaveProperty('X-Release-Channel')
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
          'X-Region': 'global'
        })
        return null
      })

      await appUpdater.checkForUpdates()

      expect(autoUpdater.checkForUpdates).toHaveBeenCalledOnce()
    })
  })

  describe('getPublishedRelease', () => {
    it('returns the latest release with localized notes marked as external data', async () => {
      vi.mocked(app.getVersion).mockReturnValue('1.9.11')
      MockMainPreferenceServiceUtils.setPreferenceValue('app.language', 'zh-CN')
      vi.mocked(net.fetch).mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          tag_name: 'v1.9.12',
          name: 'Cherry Studio 1.9.12',
          html_url: 'https://github.com/CherryHQ/cherry-studio/releases/tag/v1.9.12',
          published_at: '2026-07-05T09:35:42Z',
          prerelease: false,
          body: '<!--LANG:en-->English notes<!--LANG:zh-CN-->中文说明<!--LANG:END-->'
        })
      } as Response)

      const result = await appUpdater.getPublishedRelease('latest')

      expect(result).toEqual({
        status: 'published',
        target: 'latest',
        currentVersion: '1.9.11',
        versionRelation: 'behind',
        release: {
          version: '1.9.12',
          name: 'Cherry Studio 1.9.12',
          url: 'https://github.com/CherryHQ/cherry-studio/releases/tag/v1.9.12',
          publishedAt: '2026-07-05T09:35:42Z',
          prerelease: false,
          notes: { kind: 'external-data', content: '中文说明' }
        }
      })
    })

    it('fetches GitHub release data without reading or sending the persistent client id', async () => {
      vi.mocked(app.getVersion).mockReturnValue('1.9.11')
      vi.mocked(net.fetch).mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          tag_name: 'v1.9.12',
          name: 'Cherry Studio 1.9.12',
          html_url: 'https://github.com/CherryHQ/cherry-studio/releases/tag/v1.9.12',
          published_at: '2026-07-05T09:35:42Z',
          prerelease: false,
          body: 'Release notes'
        })
      } as Response)

      const result = await appUpdater.getPublishedRelease('latest')

      expect(result.status).toBe('published')
      expect(getClientId).not.toHaveBeenCalled()
      expect(net.fetch).toHaveBeenCalledWith(
        'https://api.github.com/repos/CherryHQ/cherry-studio/releases/latest',
        expect.objectContaining({
          headers: {
            Accept: 'application/vnd.github+json',
            'User-Agent': 'CherryStudio/1.9.11',
            'X-GitHub-Api-Version': '2022-11-28'
          }
        })
      )
    })

    it('reports an unpublished current build without falling back to latest', async () => {
      vi.mocked(app.getVersion).mockReturnValue('2.0.0-dev')
      vi.mocked(net.fetch).mockResolvedValue({ ok: false, status: 404 } as Response)

      const result = await appUpdater.getPublishedRelease('current')

      expect(result).toEqual({
        status: 'unreleased',
        target: 'current',
        currentVersion: '2.0.0-dev',
        versionRelation: 'unknown',
        release: null
      })
      expect(net.fetch).toHaveBeenCalledWith(
        'https://api.github.com/repos/CherryHQ/cherry-studio/releases/tags/v2.0.0-dev',
        expect.any(Object)
      )
      expect(net.fetch).toHaveBeenCalledTimes(1)
    })

    it('reports the matching current release as the same version', async () => {
      vi.mocked(app.getVersion).mockReturnValue('1.9.12')
      vi.mocked(net.fetch).mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          tag_name: 'v1.9.12',
          name: 'Cherry Studio 1.9.12',
          html_url: 'https://github.com/CherryHQ/cherry-studio/releases/tag/v1.9.12',
          published_at: '2026-07-05T09:35:42Z',
          prerelease: false,
          body: 'Current release notes'
        })
      } as Response)

      const result = await appUpdater.getPublishedRelease('current')

      expect(result).toMatchObject({
        status: 'published',
        target: 'current',
        currentVersion: '1.9.12',
        versionRelation: 'same'
      })
    })

    it('reports a v2 development build as ahead of the latest v1 release', async () => {
      vi.mocked(app.getVersion).mockReturnValue('2.0.0-dev')
      vi.mocked(net.fetch).mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          tag_name: 'v1.9.12',
          name: 'Cherry Studio 1.9.12',
          html_url: 'https://github.com/CherryHQ/cherry-studio/releases/tag/v1.9.12',
          published_at: '2026-07-05T09:35:42Z',
          prerelease: false,
          body: 'Latest v1 notes'
        })
      } as Response)

      const result = await appUpdater.getPublishedRelease('latest')

      expect(result.versionRelation).toBe('ahead')
    })

    it('returns a structured unavailable result for GitHub HTTP failures', async () => {
      vi.mocked(app.getVersion).mockReturnValue('2.0.0-dev')
      vi.mocked(net.fetch).mockResolvedValue({ ok: false, status: 503 } as Response)

      const result = await appUpdater.getPublishedRelease('latest')

      expect(result).toEqual({
        status: 'unavailable',
        target: 'latest',
        currentVersion: '2.0.0-dev',
        versionRelation: 'unknown',
        release: null,
        error: {
          code: 'http_error',
          message: 'GitHub release API returned HTTP 503'
        }
      })
    })

    it('returns a sanitized unavailable result for network failures and clears the timeout', async () => {
      vi.mocked(app.getVersion).mockReturnValue('2.0.0-dev')
      vi.mocked(net.fetch).mockRejectedValue(
        new Error('connect https://user:password@api.github.com/private?token=secret')
      )
      const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout')

      try {
        const result = await appUpdater.getPublishedRelease('latest')

        expect(result).toEqual({
          status: 'unavailable',
          target: 'latest',
          currentVersion: '2.0.0-dev',
          versionRelation: 'unknown',
          release: null,
          error: {
            code: 'network_error',
            message: 'GitHub release API is unavailable'
          }
        })
        expect(JSON.stringify(result)).not.toContain('password')
        expect(JSON.stringify(result)).not.toContain('token=secret')
        expect(clearTimeoutSpy).toHaveBeenCalledTimes(1)
      } finally {
        clearTimeoutSpy.mockRestore()
      }
    })

    it('uses a five-second deadline and classifies aborted requests as timeouts', async () => {
      vi.mocked(net.fetch).mockRejectedValue(Object.assign(new Error('aborted'), { name: 'AbortError' }))
      const setTimeoutSpy = vi.spyOn(global, 'setTimeout')
      const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout')

      try {
        const result = await appUpdater.getPublishedRelease('latest')

        expect(result).toMatchObject({
          status: 'unavailable',
          versionRelation: 'unknown',
          error: {
            code: 'timeout',
            message: 'GitHub release API request timed out'
          }
        })
        expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 5_000)
        expect(clearTimeoutSpy).toHaveBeenCalledTimes(1)
      } finally {
        setTimeoutSpy.mockRestore()
        clearTimeoutSpy.mockRestore()
      }
    })

    it('rejects malformed GitHub release data without exposing the response', async () => {
      vi.mocked(net.fetch).mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ message: 'malformed secret response' })
      } as Response)

      const result = await appUpdater.getPublishedRelease('latest')

      expect(result).toEqual({
        status: 'unavailable',
        target: 'latest',
        currentVersion: '1.0.0',
        versionRelation: 'unknown',
        release: null,
        error: {
          code: 'invalid_response',
          message: 'GitHub release API returned invalid data'
        }
      })
      expect(JSON.stringify(result)).not.toContain('malformed secret response')
    })

    it('does not reuse localized release notes after the application language changes', async () => {
      vi.mocked(net.fetch).mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          tag_name: 'v1.9.12',
          name: 'Cherry Studio 1.9.12',
          html_url: 'https://github.com/CherryHQ/cherry-studio/releases/tag/v1.9.12',
          published_at: '2026-07-05T09:35:42Z',
          prerelease: false,
          body: '<!--LANG:en-->English notes<!--LANG:zh-CN-->中文说明<!--LANG:END-->'
        })
      } as Response)
      MockMainPreferenceServiceUtils.setPreferenceValue('app.language', 'zh-CN')

      const chineseResult = await appUpdater.getPublishedRelease('latest')
      MockMainPreferenceServiceUtils.setPreferenceValue('app.language', 'en-US')
      const englishResult = await appUpdater.getPublishedRelease('latest')

      expect(chineseResult.status === 'published' && chineseResult.release.notes.content).toBe('中文说明')
      expect(englishResult.status === 'published' && englishResult.release.notes.content).toBe('English notes')
      expect(net.fetch).toHaveBeenCalledTimes(2)
    })

    it('reuses a release within the short TTL and refreshes it after expiry', async () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2026-07-23T00:00:00Z'))
      vi.mocked(net.fetch).mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          tag_name: 'v1.9.12',
          name: 'Cherry Studio 1.9.12',
          html_url: 'https://github.com/CherryHQ/cherry-studio/releases/tag/v1.9.12',
          published_at: '2026-07-05T09:35:42Z',
          prerelease: false,
          body: 'Release notes'
        })
      } as Response)

      try {
        await appUpdater.getPublishedRelease('latest')
        vi.setSystemTime(new Date('2026-07-23T00:00:59Z'))
        await appUpdater.getPublishedRelease('latest')

        expect(net.fetch).toHaveBeenCalledTimes(1)

        vi.setSystemTime(new Date('2026-07-23T00:01:01Z'))
        await appUpdater.getPublishedRelease('latest')

        expect(net.fetch).toHaveBeenCalledTimes(2)
      } finally {
        vi.useRealTimers()
      }
    })

    it('shares one in-flight request between concurrent callers', async () => {
      let resolveResponse!: (response: Response) => void
      const responsePromise = new Promise<Response>((resolve) => {
        resolveResponse = resolve
      })
      vi.mocked(net.fetch).mockReturnValue(responsePromise)

      const first = appUpdater.getPublishedRelease('latest')
      const second = appUpdater.getPublishedRelease('latest')
      resolveResponse({
        ok: true,
        status: 200,
        json: async () => ({
          tag_name: 'v1.9.12',
          name: 'Cherry Studio 1.9.12',
          html_url: 'https://github.com/CherryHQ/cherry-studio/releases/tag/v1.9.12',
          published_at: '2026-07-05T09:35:42Z',
          prerelease: false,
          body: 'Release notes'
        })
      } as Response)

      const [firstResult, secondResult] = await Promise.all([first, second])

      expect(net.fetch).toHaveBeenCalledTimes(1)
      expect(firstResult).toEqual(secondResult)
    })
  })

  describe('parseMultiLangReleaseNotes', () => {
    const sampleReleaseNotes = `<!--LANG:en-->
🚀 New Features:
- Feature A
- Feature B

🎨 UI Improvements:
- Improvement A
<!--LANG:zh-CN-->
🚀 新功能：
- 功能 A
- 功能 B

🎨 界面改进：
- 改进 A
<!--LANG:END-->`

    it('returns Chinese notes for zh-CN users', () => {
      MockMainPreferenceServiceUtils.setPreferenceValue('app.language', 'zh-CN')

      const result = (appUpdater as any).parseMultiLangReleaseNotes(sampleReleaseNotes)

      expect(result).toContain('新功能')
      expect(result).toContain('功能 A')
      expect(result).not.toContain('New Features')
    })

    it('returns Chinese notes for zh-TW users', () => {
      MockMainPreferenceServiceUtils.setPreferenceValue('app.language', 'zh-TW')

      const result = (appUpdater as any).parseMultiLangReleaseNotes(sampleReleaseNotes)

      expect(result).toContain('新功能')
      expect(result).not.toContain('New Features')
    })

    it('returns English notes for non-Chinese users', () => {
      MockMainPreferenceServiceUtils.setPreferenceValue('app.language', 'en-US')

      const result = (appUpdater as any).parseMultiLangReleaseNotes(sampleReleaseNotes)

      expect(result).toContain('New Features')
      expect(result).not.toContain('新功能')
    })

    it('returns English notes for other languages', () => {
      MockMainPreferenceServiceUtils.setPreferenceValue('app.language', 'ru-RU')

      const result = (appUpdater as any).parseMultiLangReleaseNotes(sampleReleaseNotes)

      expect(result).toContain('New Features')
      expect(result).not.toContain('新功能')
    })

    it('handles release notes without language markers', () => {
      const releaseNotes = 'Simple release notes without markers'

      expect((appUpdater as any).parseMultiLangReleaseNotes(releaseNotes)).toBe(releaseNotes)
    })

    it('cleans malformed markers', () => {
      MockMainPreferenceServiceUtils.setPreferenceValue('app.language', 'zh-CN')

      const result = (appUpdater as any).parseMultiLangReleaseNotes('<!--LANG:en-->English only')

      expect(result).toBe('English only')
    })

    it('handles empty release notes', () => {
      expect((appUpdater as any).parseMultiLangReleaseNotes('')).toBe('')
    })

    it('returns the original notes when language lookup fails', () => {
      vi.mocked(application.get('PreferenceService').get).mockImplementationOnce(() => {
        throw new Error('Test error')
      })

      expect((appUpdater as any).parseMultiLangReleaseNotes(sampleReleaseNotes)).toBe(sampleReleaseNotes)
    })
  })

  describe('hasMultiLanguageMarkers', () => {
    it('detects language markers', () => {
      expect((appUpdater as any).hasMultiLanguageMarkers('<!--LANG:en-->Test')).toBe(true)
    })

    it('rejects unmarked notes', () => {
      expect((appUpdater as any).hasMultiLanguageMarkers('Simple release notes')).toBe(false)
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
  })
})
