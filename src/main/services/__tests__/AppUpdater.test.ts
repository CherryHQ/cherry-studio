import type { UpdateInfo } from 'builder-util-runtime'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock dependencies
vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn()
    })
  }
}))

// Mock PreferenceService using the existing mock
vi.mock('@data/PreferenceService', async () => {
  const { MockMainPreferenceServiceExport } = await import('../../../../tests/__mocks__/main/PreferenceService')
  return MockMainPreferenceServiceExport
})

vi.mock('../WindowService', () => ({
  windowService: {
    getMainWindow: vi.fn()
  }
}))

vi.mock('@main/constant', () => ({
  isWin: false
}))

vi.mock('@main/utils/ipService', () => ({
  getIpCountry: vi.fn(() => 'US')
}))

vi.mock('@main/utils/locales', () => ({
  locales: {
    en: { translation: { update: {} } },
    'zh-CN': { translation: { update: {} } }
  }
}))

vi.mock('@main/utils/systemInfo', () => ({
  generateUserAgent: vi.fn(() => 'test-user-agent')
}))

vi.mock('electron', () => ({
  app: {
    isPackaged: true,
    getVersion: vi.fn(() => '1.0.0'),
    getPath: vi.fn(() => '/test/path')
  },
  dialog: {
    showMessageBox: vi.fn()
  },
  BrowserWindow: vi.fn(),
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

// Import after mocks
import { preferenceService } from '@data/PreferenceService'

import { MockMainPreferenceServiceUtils } from '../../../../tests/__mocks__/main/PreferenceService'
import AppUpdater from '../AppUpdater'

// Mock clientId for ConfigManager since it's not migrated yet
vi.mock('../ConfigManager', () => ({
  configManager: {
    getClientId: vi.fn(() => 'test-client-id')
  }
}))

describe('AppUpdater', () => {
  let appUpdater: AppUpdater

  beforeEach(() => {
    vi.clearAllMocks()
    MockMainPreferenceServiceUtils.resetMocks()
    appUpdater = new AppUpdater()
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

    it('should return Chinese notes for zh-CN users', () => {
      MockMainPreferenceServiceUtils.setPreferenceValue('app.language', 'zh-CN')

      const result = (appUpdater as any).parseMultiLangReleaseNotes(sampleReleaseNotes)

      expect(result).toContain('新功能')
      expect(result).toContain('功能 A')
      expect(result).not.toContain('New Features')
    })

    it('should return Chinese notes for zh-TW users', () => {
      MockMainPreferenceServiceUtils.setPreferenceValue('app.language', 'zh-TW')

      const result = (appUpdater as any).parseMultiLangReleaseNotes(sampleReleaseNotes)

      expect(result).toContain('新功能')
      expect(result).toContain('功能 A')
      expect(result).not.toContain('New Features')
    })

    it('should return English notes for non-Chinese users', () => {
      MockMainPreferenceServiceUtils.setPreferenceValue('app.language', 'en-US')

      const result = (appUpdater as any).parseMultiLangReleaseNotes(sampleReleaseNotes)

      expect(result).toContain('New Features')
      expect(result).toContain('Feature A')
      expect(result).not.toContain('新功能')
    })

    it('should return English notes for other language users', () => {
      MockMainPreferenceServiceUtils.setPreferenceValue('app.language', 'ru-RU')

      const result = (appUpdater as any).parseMultiLangReleaseNotes(sampleReleaseNotes)

      expect(result).toContain('New Features')
      expect(result).not.toContain('新功能')
    })

    it('should handle missing language sections gracefully', () => {
      const malformedNotes = 'Simple release notes without markers'

      const result = (appUpdater as any).parseMultiLangReleaseNotes(malformedNotes)

      expect(result).toBe('Simple release notes without markers')
    })

    it('should handle malformed markers', () => {
      const malformedNotes = `<!--LANG:en-->English only`
      MockMainPreferenceServiceUtils.setPreferenceValue('app.language', 'zh-CN')

      const result = (appUpdater as any).parseMultiLangReleaseNotes(malformedNotes)

      // Should clean up markers and return cleaned content
      expect(result).toContain('English only')
      expect(result).not.toContain('<!--LANG:')
    })

    it('should handle empty release notes', () => {
      const result = (appUpdater as any).parseMultiLangReleaseNotes('')

      expect(result).toBe('')
    })

    it('should handle errors gracefully', () => {
      // Create a fresh instance for this test to avoid issues with constructor mocking
      const testAppUpdater = new AppUpdater()

      // Force an error by mocking preferenceService to throw
      vi.mocked(preferenceService.get).mockImplementationOnce(() => {
        throw new Error('Test error')
      })

      const result = (testAppUpdater as any).parseMultiLangReleaseNotes(sampleReleaseNotes)

      // Should return original notes as fallback
      expect(result).toBe(sampleReleaseNotes)
    })
  })

  describe('hasMultiLanguageMarkers', () => {
    it('should return true when markers are present', () => {
      const notes = '<!--LANG:en-->Test'

      const result = (appUpdater as any).hasMultiLanguageMarkers(notes)

      expect(result).toBe(true)
    })

    it('should return false when no markers are present', () => {
      const notes = 'Simple text without markers'

      const result = (appUpdater as any).hasMultiLanguageMarkers(notes)

      expect(result).toBe(false)
    })
  })

  describe('processReleaseInfo', () => {
    it('should process multi-language release notes in string format', () => {
      MockMainPreferenceServiceUtils.setPreferenceValue('app.language', 'zh-CN')

      const releaseInfo = {
        version: '1.0.0',
        files: [],
        path: '',
        sha512: '',
        releaseDate: new Date().toISOString(),
        releaseNotes: `<!--LANG:en-->English notes<!--LANG:zh-CN-->中文说明<!--LANG:END-->`
      } as UpdateInfo

      const result = (appUpdater as any).processReleaseInfo(releaseInfo)

      expect(result.releaseNotes).toBe('中文说明')
    })

    it('should not process release notes without markers', () => {
      const releaseInfo = {
        version: '1.0.0',
        files: [],
        path: '',
        sha512: '',
        releaseDate: new Date().toISOString(),
        releaseNotes: 'Simple release notes'
      } as UpdateInfo

      const result = (appUpdater as any).processReleaseInfo(releaseInfo)

      expect(result.releaseNotes).toBe('Simple release notes')
    })

    it('should handle array format release notes', () => {
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

      const result = (appUpdater as any).processReleaseInfo(releaseInfo)

      expect(result.releaseNotes).toEqual(releaseInfo.releaseNotes)
    })

    it('should handle null release notes', () => {
      const releaseInfo = {
        version: '1.0.0',
        files: [],
        path: '',
        sha512: '',
        releaseDate: new Date().toISOString(),
        releaseNotes: null
      } as UpdateInfo

      const result = (appUpdater as any).processReleaseInfo(releaseInfo)

      expect(result.releaseNotes).toBeNull()
    })
  })
})
