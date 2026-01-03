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
  generateUserAgent: vi.fn(() => 'test-user-agent'),
  getClientId: vi.fn(() => 'test-client-id')
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
import { UpdateMirror } from '@shared/config/constant'
import { app, net } from 'electron'

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

  describe('_fetchUpdateConfig', () => {
    const mockConfig = {
      lastUpdated: '2025-01-05T00:00:00Z',
      versions: {
        '1.6.7': {
          minCompatibleVersion: '1.0.0',
          description: 'Test version',
          channels: {
            latest: {
              version: '1.6.7',
              feedUrls: {
                github: 'https://github.com/test/v1.6.7',
                gitcode: 'https://gitcode.com/test/v1.6.7'
              }
            },
            rc: null,
            beta: null
          }
        }
      }
    }

    it('should fetch config from GitHub mirror', async () => {
      vi.mocked(net.fetch).mockResolvedValue({
        ok: true,
        json: async () => mockConfig
      } as any)

      const result = await (appUpdater as any)._fetchUpdateConfig(UpdateMirror.GITHUB)

      expect(result).toEqual(mockConfig)
      expect(net.fetch).toHaveBeenCalledWith(expect.stringContaining('github'), expect.any(Object))
    })

    it('should fetch config from GitCode mirror', async () => {
      vi.mocked(net.fetch).mockResolvedValue({
        ok: true,
        json: async () => mockConfig
      } as any)

      const result = await (appUpdater as any)._fetchUpdateConfig(UpdateMirror.GITCODE)

      expect(result).toEqual(mockConfig)
      // GitCode URL may vary, just check that fetch was called
      expect(net.fetch).toHaveBeenCalledWith(expect.any(String), expect.any(Object))
    })

    it('should return null on HTTP error', async () => {
      vi.mocked(net.fetch).mockResolvedValue({
        ok: false,
        status: 404
      } as any)

      const result = await (appUpdater as any)._fetchUpdateConfig(UpdateMirror.GITHUB)

      expect(result).toBeNull()
    })

    it('should return null on network error', async () => {
      vi.mocked(net.fetch).mockRejectedValue(new Error('Network error'))

      const result = await (appUpdater as any)._fetchUpdateConfig(UpdateMirror.GITHUB)

      expect(result).toBeNull()
    })
  })

  describe('_findCompatibleChannel', () => {
    const mockConfig = {
      lastUpdated: '2025-01-05T00:00:00Z',
      versions: {
        '1.6.7': {
          minCompatibleVersion: '1.0.0',
          description: 'v1.6.7',
          channels: {
            latest: {
              version: '1.6.7',
              feedUrls: {
                github: 'https://github.com/test/v1.6.7',
                gitcode: 'https://gitcode.com/test/v1.6.7'
              }
            },
            rc: {
              version: '1.7.0-rc.1',
              feedUrls: {
                github: 'https://github.com/test/v1.7.0-rc.1',
                gitcode: 'https://gitcode.com/test/v1.7.0-rc.1'
              }
            },
            beta: {
              version: '1.7.0-beta.3',
              feedUrls: {
                github: 'https://github.com/test/v1.7.0-beta.3',
                gitcode: 'https://gitcode.com/test/v1.7.0-beta.3'
              }
            }
          }
        },
        '2.0.0': {
          minCompatibleVersion: '1.7.0',
          description: 'v2.0.0',
          channels: {
            latest: null,
            rc: null,
            beta: null
          }
        }
      }
    }

    it('should find compatible latest channel', () => {
      vi.mocked(app.getVersion).mockReturnValue('1.5.0')

      const result = (appUpdater as any)._findCompatibleChannel('1.5.0', 'latest', mockConfig)

      expect(result?.config).toEqual({
        version: '1.6.7',
        feedUrls: {
          github: 'https://github.com/test/v1.6.7',
          gitcode: 'https://gitcode.com/test/v1.6.7'
        }
      })
      expect(result?.channel).toBe('latest')
    })

    it('should find compatible rc channel', () => {
      vi.mocked(app.getVersion).mockReturnValue('1.5.0')

      const result = (appUpdater as any)._findCompatibleChannel('1.5.0', 'rc', mockConfig)

      expect(result?.config).toEqual({
        version: '1.7.0-rc.1',
        feedUrls: {
          github: 'https://github.com/test/v1.7.0-rc.1',
          gitcode: 'https://gitcode.com/test/v1.7.0-rc.1'
        }
      })
      expect(result?.channel).toBe('rc')
    })

    it('should find compatible beta channel', () => {
      vi.mocked(app.getVersion).mockReturnValue('1.5.0')

      const result = (appUpdater as any)._findCompatibleChannel('1.5.0', 'beta', mockConfig)

      expect(result?.config).toEqual({
        version: '1.7.0-beta.3',
        feedUrls: {
          github: 'https://github.com/test/v1.7.0-beta.3',
          gitcode: 'https://gitcode.com/test/v1.7.0-beta.3'
        }
      })
      expect(result?.channel).toBe('beta')
    })

    it('should return latest when latest version >= rc version', () => {
      const configWithNewerLatest = {
        lastUpdated: '2025-01-05T00:00:00Z',
        versions: {
          '1.7.0': {
            minCompatibleVersion: '1.0.0',
            description: 'v1.7.0',
            channels: {
              latest: {
                version: '1.7.0',
                feedUrls: {
                  github: 'https://github.com/test/v1.7.0',
                  gitcode: 'https://gitcode.com/test/v1.7.0'
                }
              },
              rc: {
                version: '1.7.0-rc.1',
                feedUrls: {
                  github: 'https://github.com/test/v1.7.0-rc.1',
                  gitcode: 'https://gitcode.com/test/v1.7.0-rc.1'
                }
              },
              beta: null
            }
          }
        }
      }

      const result = (appUpdater as any)._findCompatibleChannel('1.6.0', 'rc', configWithNewerLatest)

      // Should return latest instead of rc because 1.7.0 >= 1.7.0-rc.1
      expect(result?.config).toEqual({
        version: '1.7.0',
        feedUrls: {
          github: 'https://github.com/test/v1.7.0',
          gitcode: 'https://gitcode.com/test/v1.7.0'
        }
      })
      expect(result?.channel).toBe('latest') // ✅ 返回 latest 频道
    })

    it('should return latest when latest version >= beta version', () => {
      const configWithNewerLatest = {
        lastUpdated: '2025-01-05T00:00:00Z',
        versions: {
          '1.7.0': {
            minCompatibleVersion: '1.0.0',
            description: 'v1.7.0',
            channels: {
              latest: {
                version: '1.7.0',

                feedUrls: {
                  github: 'https://github.com/test/v1.7.0',

                  gitcode: 'https://gitcode.com/test/v1.7.0'
                }
              },
              rc: null,
              beta: {
                version: '1.6.8-beta.1',

                feedUrls: {
                  github: 'https://github.com/test/v1.6.8-beta.1',

                  gitcode: 'https://gitcode.com/test/v1.6.8-beta.1'
                }
              }
            }
          }
        }
      }

      const result = (appUpdater as any)._findCompatibleChannel('1.6.0', 'beta', configWithNewerLatest)

      // Should return latest instead of beta because 1.7.0 >= 1.6.8-beta.1
      expect(result?.config).toEqual({
        version: '1.7.0',

        feedUrls: {
          github: 'https://github.com/test/v1.7.0',

          gitcode: 'https://gitcode.com/test/v1.7.0'
        }
      })
    })

    it('should not compare latest with itself when requesting latest channel', () => {
      const config = {
        lastUpdated: '2025-01-05T00:00:00Z',
        versions: {
          '1.7.0': {
            minCompatibleVersion: '1.0.0',
            description: 'v1.7.0',
            channels: {
              latest: {
                version: '1.7.0',

                feedUrls: {
                  github: 'https://github.com/test/v1.7.0',

                  gitcode: 'https://gitcode.com/test/v1.7.0'
                }
              },
              rc: {
                version: '1.7.0-rc.1',

                feedUrls: {
                  github: 'https://github.com/test/v1.7.0-rc.1',

                  gitcode: 'https://gitcode.com/test/v1.7.0-rc.1'
                }
              },
              beta: null
            }
          }
        }
      }

      const result = (appUpdater as any)._findCompatibleChannel('1.6.0', 'latest', config)

      // Should return latest directly without comparing with itself
      expect(result?.config).toEqual({
        version: '1.7.0',

        feedUrls: {
          github: 'https://github.com/test/v1.7.0',

          gitcode: 'https://gitcode.com/test/v1.7.0'
        }
      })
    })

    it('should return rc when rc version > latest version', () => {
      const configWithNewerRc = {
        lastUpdated: '2025-01-05T00:00:00Z',
        versions: {
          '1.7.0': {
            minCompatibleVersion: '1.0.0',
            description: 'v1.7.0',
            channels: {
              latest: {
                version: '1.6.7',

                feedUrls: {
                  github: 'https://github.com/test/v1.6.7',

                  gitcode: 'https://gitcode.com/test/v1.6.7'
                }
              },
              rc: {
                version: '1.7.0-rc.1',

                feedUrls: {
                  github: 'https://github.com/test/v1.7.0-rc.1',

                  gitcode: 'https://gitcode.com/test/v1.7.0-rc.1'
                }
              },
              beta: null
            }
          }
        }
      }

      const result = (appUpdater as any)._findCompatibleChannel('1.6.0', 'rc', configWithNewerRc)

      // Should return rc because 1.7.0-rc.1 > 1.6.7
      expect(result?.config).toEqual({
        version: '1.7.0-rc.1',

        feedUrls: {
          github: 'https://github.com/test/v1.7.0-rc.1',

          gitcode: 'https://gitcode.com/test/v1.7.0-rc.1'
        }
      })
    })

    it('should return beta when beta version > latest version', () => {
      const configWithNewerBeta = {
        lastUpdated: '2025-01-05T00:00:00Z',
        versions: {
          '1.7.0': {
            minCompatibleVersion: '1.0.0',
            description: 'v1.7.0',
            channels: {
              latest: {
                version: '1.6.7',

                feedUrls: {
                  github: 'https://github.com/test/v1.6.7',

                  gitcode: 'https://gitcode.com/test/v1.6.7'
                }
              },
              rc: null,
              beta: {
                version: '1.7.0-beta.5',

                feedUrls: {
                  github: 'https://github.com/test/v1.7.0-beta.5',

                  gitcode: 'https://gitcode.com/test/v1.7.0-beta.5'
                }
              }
            }
          }
        }
      }

      const result = (appUpdater as any)._findCompatibleChannel('1.6.0', 'beta', configWithNewerBeta)

      // Should return beta because 1.7.0-beta.5 > 1.6.7
      expect(result?.config).toEqual({
        version: '1.7.0-beta.5',

        feedUrls: {
          github: 'https://github.com/test/v1.7.0-beta.5',

          gitcode: 'https://gitcode.com/test/v1.7.0-beta.5'
        }
      })
    })

    it('should return lower version when higher version has no compatible channel', () => {
      vi.mocked(app.getVersion).mockReturnValue('1.8.0')

      const result = (appUpdater as any)._findCompatibleChannel('1.8.0', 'latest', mockConfig)

      // 1.8.0 >= 1.7.0 but 2.0.0 has no latest channel, so return 1.6.7
      expect(result?.config).toEqual({
        version: '1.6.7',

        feedUrls: {
          github: 'https://github.com/test/v1.6.7',

          gitcode: 'https://gitcode.com/test/v1.6.7'
        }
      })
    })

    it('should return null when current version does not meet minCompatibleVersion', () => {
      vi.mocked(app.getVersion).mockReturnValue('0.9.0')

      const result = (appUpdater as any)._findCompatibleChannel('0.9.0', 'latest', mockConfig)

      // 0.9.0 < 1.0.0 (minCompatibleVersion)
      expect(result).toBeNull()
    })

    it('should return lower version rc when higher version has no rc channel', () => {
      const result = (appUpdater as any)._findCompatibleChannel('1.8.0', 'rc', mockConfig)

      // 1.8.0 >= 1.7.0 but 2.0.0 has no rc channel, so return 1.6.7 rc
      expect(result?.config).toEqual({
        version: '1.7.0-rc.1',

        feedUrls: {
          github: 'https://github.com/test/v1.7.0-rc.1',

          gitcode: 'https://gitcode.com/test/v1.7.0-rc.1'
        }
      })
    })

    it('should return null when no version has the requested channel', () => {
      const configWithoutRc = {
        lastUpdated: '2025-01-05T00:00:00Z',
        versions: {
          '1.6.7': {
            minCompatibleVersion: '1.0.0',
            description: 'v1.6.7',
            channels: {
              latest: {
                version: '1.6.7',

                feedUrls: {
                  github: 'https://github.com/test/v1.6.7',

                  gitcode: 'https://gitcode.com/test/v1.6.7'
                }
              },
              rc: null,
              beta: null
            }
          }
        }
      }

      const result = (appUpdater as any)._findCompatibleChannel('1.5.0', 'rc', configWithoutRc)

      expect(result).toBeNull()
    })
  })

  describe('Upgrade Path', () => {
    const fullConfig = {
      lastUpdated: '2025-01-05T00:00:00Z',
      versions: {
        '1.6.7': {
          minCompatibleVersion: '1.0.0',
          description: 'Last v1.x',
          channels: {
            latest: {
              version: '1.6.7',

              feedUrls: {
                github: 'https://github.com/test/v1.6.7',

                gitcode: 'https://gitcode.com/test/v1.6.7'
              }
            },
            rc: {
              version: '1.7.0-rc.1',

              feedUrls: {
                github: 'https://github.com/test/v1.7.0-rc.1',

                gitcode: 'https://gitcode.com/test/v1.7.0-rc.1'
              }
            },
            beta: {
              version: '1.7.0-beta.3',

              feedUrls: {
                github: 'https://github.com/test/v1.7.0-beta.3',

                gitcode: 'https://gitcode.com/test/v1.7.0-beta.3'
              }
            }
          }
        },
        '2.0.0': {
          minCompatibleVersion: '1.7.0',
          description: 'First v2.x',
          channels: {
            latest: null,
            rc: null,
            beta: null
          }
        }
      }
    }

    it('should upgrade from 1.6.3 to 1.6.7', () => {
      const result = (appUpdater as any)._findCompatibleChannel('1.6.3', 'latest', fullConfig)

      expect(result?.config).toEqual({
        version: '1.6.7',

        feedUrls: {
          github: 'https://github.com/test/v1.6.7',

          gitcode: 'https://gitcode.com/test/v1.6.7'
        }
      })
    })

    it('should block upgrade from 1.6.7 to 2.0.0 (minCompatibleVersion not met)', () => {
      const result = (appUpdater as any)._findCompatibleChannel('1.6.7', 'latest', fullConfig)

      // Should return 1.6.7, not 2.0.0, because 1.6.7 < 1.7.0 (minCompatibleVersion of 2.0.0)
      expect(result?.config).toEqual({
        version: '1.6.7',

        feedUrls: {
          github: 'https://github.com/test/v1.6.7',

          gitcode: 'https://gitcode.com/test/v1.6.7'
        }
      })
    })

    it('should allow upgrade from 1.7.0 to 2.0.0', () => {
      const configWith2x = {
        ...fullConfig,
        versions: {
          ...fullConfig.versions,
          '2.0.0': {
            minCompatibleVersion: '1.7.0',
            description: 'First v2.x',
            channels: {
              latest: {
                version: '2.0.0',

                feedUrls: {
                  github: 'https://github.com/test/v2.0.0',

                  gitcode: 'https://gitcode.com/test/v2.0.0'
                }
              },
              rc: null,
              beta: null
            }
          }
        }
      }

      const result = (appUpdater as any)._findCompatibleChannel('1.7.0', 'latest', configWith2x)

      expect(result?.config).toEqual({
        version: '2.0.0',

        feedUrls: {
          github: 'https://github.com/test/v2.0.0',

          gitcode: 'https://gitcode.com/test/v2.0.0'
        }
      })
    })
  })

  describe('Complete Multi-Step Upgrade Path', () => {
    const fullUpgradeConfig = {
      lastUpdated: '2025-01-05T00:00:00Z',
      versions: {
        '1.7.5': {
          minCompatibleVersion: '1.0.0',
          description: 'Last v1.x stable',
          channels: {
            latest: {
              version: '1.7.5',

              feedUrls: {
                github: 'https://github.com/test/v1.7.5',

                gitcode: 'https://gitcode.com/test/v1.7.5'
              }
            },
            rc: null,
            beta: null
          }
        },
        '2.0.0': {
          minCompatibleVersion: '1.7.0',
          description: 'First v2.x - intermediate version',
          channels: {
            latest: {
              version: '2.0.0',

              feedUrls: {
                github: 'https://github.com/test/v2.0.0',

                gitcode: 'https://gitcode.com/test/v2.0.0'
              }
            },
            rc: null,
            beta: null
          }
        },
        '2.1.6': {
          minCompatibleVersion: '2.0.0',
          description: 'Current v2.x stable',
          channels: {
            latest: {
              version: '2.1.6',

              feedUrls: {
                github: 'https://github.com/test/latest',

                gitcode: 'https://gitcode.com/test/latest'
              }
            },
            rc: null,
            beta: null
          }
        }
      }
    }

    it('should upgrade from 1.6.3 to 1.7.5 (step 1)', () => {
      const result = (appUpdater as any)._findCompatibleChannel('1.6.3', 'latest', fullUpgradeConfig)

      expect(result?.config).toEqual({
        version: '1.7.5',

        feedUrls: {
          github: 'https://github.com/test/v1.7.5',

          gitcode: 'https://gitcode.com/test/v1.7.5'
        }
      })
    })

    it('should upgrade from 1.7.5 to 2.0.0 (step 2)', () => {
      const result = (appUpdater as any)._findCompatibleChannel('1.7.5', 'latest', fullUpgradeConfig)

      expect(result?.config).toEqual({
        version: '2.0.0',

        feedUrls: {
          github: 'https://github.com/test/v2.0.0',

          gitcode: 'https://gitcode.com/test/v2.0.0'
        }
      })
    })

    it('should upgrade from 2.0.0 to 2.1.6 (step 3)', () => {
      const result = (appUpdater as any)._findCompatibleChannel('2.0.0', 'latest', fullUpgradeConfig)

      expect(result?.config).toEqual({
        version: '2.1.6',

        feedUrls: {
          github: 'https://github.com/test/latest',

          gitcode: 'https://gitcode.com/test/latest'
        }
      })
    })

    it('should complete full upgrade path: 1.6.3 -> 1.7.5 -> 2.0.0 -> 2.1.6', () => {
      // Step 1: 1.6.3 -> 1.7.5
      let currentVersion = '1.6.3'
      let result = (appUpdater as any)._findCompatibleChannel(currentVersion, 'latest', fullUpgradeConfig)
      expect(result?.config.version).toBe('1.7.5')

      // Step 2: 1.7.5 -> 2.0.0
      currentVersion = result?.config.version!
      result = (appUpdater as any)._findCompatibleChannel(currentVersion, 'latest', fullUpgradeConfig)
      expect(result?.config.version).toBe('2.0.0')

      // Step 3: 2.0.0 -> 2.1.6
      currentVersion = result?.config.version!
      result = (appUpdater as any)._findCompatibleChannel(currentVersion, 'latest', fullUpgradeConfig)
      expect(result?.config.version).toBe('2.1.6')

      // Final: 2.1.6 is the latest, no more upgrades
      currentVersion = result?.config.version!
      result = (appUpdater as any)._findCompatibleChannel(currentVersion, 'latest', fullUpgradeConfig)
      expect(result?.config.version).toBe('2.1.6')
    })

    it('should block direct upgrade from 1.6.3 to 2.0.0 (skip intermediate)', () => {
      const result = (appUpdater as any)._findCompatibleChannel('1.6.3', 'latest', fullUpgradeConfig)

      // Should return 1.7.5, not 2.0.0, because 1.6.3 < 1.7.0 (minCompatibleVersion of 2.0.0)
      expect(result?.config.version).toBe('1.7.5')
      expect(result?.config.version).not.toBe('2.0.0')
    })

    it('should block direct upgrade from 1.7.5 to 2.1.6 (skip intermediate)', () => {
      const result = (appUpdater as any)._findCompatibleChannel('1.7.5', 'latest', fullUpgradeConfig)

      // Should return 2.0.0, not 2.1.6, because 1.7.5 < 2.0.0 (minCompatibleVersion of 2.1.6)
      expect(result?.config.version).toBe('2.0.0')
      expect(result?.config.version).not.toBe('2.1.6')
    })
  })
})
