/**
 * Startup dialogs run before PreferenceService exists. These cases drive the
 * real Application handlers and the real main catalogs, and stop boot-config
 * repair/reset before they can touch the config file.
 */

import { app } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ServiceInitError } from '@main/core/lifecycle'
import { type BootConfigLoadError, bootConfigService } from '@main/data/bootConfig'
import { getAppLanguage } from '@main/i18n'

import { BaseService } from '../../lifecycle/BaseService'
import { LifecycleManager } from '../../lifecycle/LifecycleManager'
import { ServiceContainer } from '../../lifecycle/ServiceContainer'
import { Application } from '../Application'

const electron = vi.hoisted(() => ({
  exit: vi.fn(),
  getLocale: vi.fn(() => 'en-US'),
  isReady: vi.fn(() => false),
  relaunch: vi.fn(),
  showMessageBox: vi.fn(),
  showMessageBoxSync: vi.fn(),
  whenReady: vi.fn(() => Promise.resolve()),
  writeText: vi.fn(async () => undefined)
}))

vi.mock('electron', () => ({
  app: {
    commandLine: { hasSwitch: vi.fn(() => false), getSwitchValue: vi.fn(() => '') },
    exit: electron.exit,
    getLocale: electron.getLocale,
    getPath: vi.fn((key: string) => {
      if (key === 'userData') return '/mock/userData'
      if (key === 'temp') return '/mock/temp'
      if (key === 'logs') return '/mock/logs'
      return '/mock/unknown'
    }),
    getVersion: vi.fn(() => '1.0.0'),
    isPackaged: false,
    isReady: electron.isReady,
    on: vi.fn(),
    once: vi.fn(),
    quit: vi.fn(),
    relaunch: electron.relaunch,
    removeListener: vi.fn(),
    setAppLogsPath: vi.fn(),
    whenReady: electron.whenReady
  },
  clipboard: { writeText: electron.writeText },
  dialog: {
    showErrorBox: vi.fn(),
    showMessageBox: electron.showMessageBox,
    showMessageBoxSync: electron.showMessageBoxSync,
    showOpenDialog: vi.fn(),
    showSaveDialog: vi.fn()
  },
  ipcMain: { handle: vi.fn(), on: vi.fn(), once: vi.fn(), removeHandler: vi.fn(), removeListener: vi.fn() },
  shell: { openExternal: vi.fn() }
}))

// The `@application` alias resolves to Application.ts, so the global
// vi.mock('@application') would otherwise replace this class and the i18n
// catalog lookup with the stub singleton.
vi.unmock('@application')

const RAW = 'sector RAW-BOOT-9f3'
const FILE = '/tmp/cherry-boot-config.json'
type Locale = 'en-US' | 'zh-CN'
type BootKind = BootConfigLoadError['type']

interface ShownBox {
  type: string
  title: string
  message: string
  detail: string
  buttons: string[]
  defaultId: number
  cancelId: number
}

interface LocaleCopy {
  exit: string
  restart: string
  ok: string
  copy: string
  feedback: string
  releases: string
  analysis: string
  manualTitle: string
  manualMessage: string
  manualDetail: string
  fatalTitle: string
  fatalMessage: string
  fatalDetail: string
  kind: Record<
    BootKind,
    {
      title: string
      message: string
      continueLabel: string
      recoveryLabel: string
      continueHint: string
      fileHint: string
    }
  >
}

const COPY: Record<Locale, LocaleCopy> = {
  'en-US': {
    exit: 'Exit',
    restart: 'Restart',
    ok: 'OK',
    copy: 'Copy error',
    feedback: 'Send feedback',
    releases: 'Open releases',
    analysis:
      'Automatic analysis is unavailable. You can copy the error, send feedback, or open the official releases.',
    manualTitle: 'Manual Restart Required',
    manualMessage: 'Auto-relaunch is not available in development mode.',
    manualDetail: 'The app will now exit. Please run `pnpm dev` again to restart.',
    fatalTitle: 'Unable to Start',
    fatalMessage: 'Cherry Studio could not start because DbService failed to initialize.',
    fatalDetail:
      'Try restarting the application. If the problem persists, check the application logs for detailed error information.',
    kind: {
      validation_error: {
        title: 'Configuration File Invalid',
        message: 'The configuration file (boot-config.json) contains invalid values.',
        continueLabel: 'Continue',
        recoveryLabel: 'Repair and Restart',
        continueHint:
          'The application can continue — valid settings are kept and the invalid entries fall back to defaults — or you can repair the file and restart.',
        fileHint: `"Repair and Restart" rewrites the file, keeping the valid entries and resetting the invalid ones. Other options preserve it for manual inspection at:\n${FILE}`
      },
      parse_error: {
        title: 'Configuration File Corrupted',
        message: 'The configuration file (boot-config.json) contains invalid data.',
        continueLabel: 'Continue with Defaults',
        recoveryLabel: 'Reset and Restart',
        continueHint: 'The application can continue with default settings, or you can reset the file and restart.',
        fileHint: `"Reset and Restart" will delete the corrupted file. Other options preserve it for manual inspection at:\n${FILE}`
      },
      read_error: {
        title: 'Configuration File Read Error',
        message: 'The configuration file (boot-config.json) could not be read.',
        continueLabel: 'Continue with Defaults',
        recoveryLabel: 'Restart',
        continueHint: 'The application can continue with default settings, or you can restart to try again.',
        fileHint: `The file will be preserved for manual inspection at:\n${FILE}`
      }
    }
  },
  'zh-CN': {
    exit: '退出',
    restart: '重启',
    ok: '确定',
    copy: '复制错误',
    feedback: '发送反馈',
    releases: '打开发布页',
    analysis: '自动分析不可用。你可以复制错误、发送反馈或打开官方发布页。',
    manualTitle: '需要手动重启',
    manualMessage: '开发模式下无法自动重新启动。',
    manualDetail: '应用程序将立即退出。请再次运行 `pnpm dev` 以重新启动。',
    fatalTitle: '无法启动',
    fatalMessage: 'Cherry Studio 无法启动，因为 DbService 初始化失败。',
    fatalDetail: '请尝试重启应用程序。如果问题仍然存在，请查看应用程序日志以获取详细错误信息。',
    kind: {
      validation_error: {
        title: '配置文件无效',
        message: '配置文件 (boot-config.json) 包含无效值。',
        continueLabel: '继续',
        recoveryLabel: '修复并重启',
        continueHint: '应用程序可以继续——有效设置会保留，无效项将回退为默认值——也可以修复该文件并重启。',
        fileHint: `“修复并重启”会重写该文件：保留有效项，并重置无效项。其他选项会保留该文件，供你手动检查，位置：\n${FILE}`
      },
      parse_error: {
        title: '配置文件已损坏',
        message: '配置文件 (boot-config.json) 包含无效数据。',
        continueLabel: '使用默认设置继续',
        recoveryLabel: '重置并重启',
        continueHint: '应用程序可以使用默认设置继续，也可以重置该文件并重启。',
        fileHint: `“重置并重启”将删除已损坏的文件。其他选项会保留该文件，供你手动检查，位置：\n${FILE}`
      },
      read_error: {
        title: '配置文件读取错误',
        message: '无法读取配置文件 (boot-config.json)。',
        continueLabel: '使用默认设置继续',
        recoveryLabel: '重启',
        continueHint: '应用程序可以使用默认设置继续，也可以重启后再试。',
        fileHint: `该文件将予以保留，供你手动检查，位置：\n${FILE}`
      }
    }
  }
}

function resetApplication(): void {
  LifecycleManager.reset()
  ServiceContainer.reset()
  BaseService.resetInstances()
  ;(Application as unknown as { instance: Application | null }).instance = null
}

let releaseReady: () => void = () => undefined
let preferenceGet: ReturnType<typeof vi.spyOn>

function armReady(locale: Locale): void {
  let ready = false
  electron.isReady.mockImplementation(() => ready)
  electron.getLocale.mockReset()
  electron.getLocale.mockImplementation(() => {
    if (!ready) throw new Error('app.getLocale called before ready')
    return locale
  })
  electron.whenReady.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        releaseReady = () => {
          ready = true
          resolve()
        }
      })
  )
}

function firstBox(): ShownBox {
  return electron.showMessageBox.mock.calls[0][0] as ShownBox
}

describe('Application startup errors', () => {
  let repair: ReturnType<typeof vi.spyOn>
  let reset: ReturnType<typeof vi.spyOn>
  let clearLoadError: ReturnType<typeof vi.spyOn>
  let persist: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    resetApplication()
    Object.assign(app, { isPackaged: false })
    electron.exit.mockReset()
    electron.relaunch.mockReset()
    electron.showMessageBox.mockReset()
    electron.showMessageBoxSync.mockReset()
    electron.writeText.mockReset()
    electron.writeText.mockResolvedValue(undefined)
    electron.getLocale.mockReset()
    electron.isReady.mockReset()
    electron.whenReady.mockReset()

    const application = Application.getInstance()
    expect(() => application.get('PreferenceService')).toThrow(/not found/)
    expect(() => getAppLanguage()).toThrow(/PreferenceService/)
    preferenceGet = vi.spyOn(ServiceContainer.prototype, 'get')

    repair = vi.spyOn(bootConfigService, 'repair').mockImplementation(() => {})
    reset = vi.spyOn(bootConfigService, 'reset').mockImplementation(() => {})
    clearLoadError = vi.spyOn(bootConfigService, 'clearLoadError')
    persist = vi.spyOn(bootConfigService, 'persist').mockImplementation(() => {
      throw new Error('boot config persist must not run')
    })
    vi.spyOn(bootConfigService, 'flush').mockImplementation(() => {
      throw new Error('boot config flush must not run')
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    resetApplication()
  })

  async function openBootDialog(locale: Locale, kind: BootKind, response: number): Promise<ShownBox> {
    armReady(locale)
    vi.spyOn(bootConfigService, 'getLoadError').mockReturnValue({
      type: kind,
      message: RAW,
      filePath: FILE,
      invalidKeys: kind === 'validation_error' ? ['app.user_data_path'] : undefined
    })
    electron.showMessageBox.mockResolvedValue({ response })
    const pending = Application.getInstance()['handleBootConfigError']()
    expect(electron.getLocale).not.toHaveBeenCalled()
    expect(electron.showMessageBox).not.toHaveBeenCalled()
    releaseReady()
    await pending
    expect(electron.showMessageBox).toHaveBeenCalledOnce()
    expect(preferenceGet).not.toHaveBeenCalled()
    expect(persist).not.toHaveBeenCalled()
    return firstBox()
  }

  describe.each(['en-US', 'zh-CN'] as const)('%s boot-config choices', (locale) => {
    const text = COPY[locale]

    describe.each(['validation_error', 'parse_error', 'read_error'] as const)('%s', (kind) => {
      const prose = text.kind[kind]

      async function open(response: number): Promise<void> {
        const box = await openBootDialog(locale, kind, response)
        expect(box).toMatchObject({
          type: 'warning',
          title: prose.title,
          message: prose.message,
          defaultId: 0,
          cancelId: 2,
          buttons: [prose.continueLabel, prose.recoveryLabel, text.exit, text.copy, text.feedback, text.releases],
          detail: [prose.continueHint, prose.fileHint, text.analysis].join('\n\n')
        })
        expect(JSON.stringify(box)).not.toContain(RAW)
        expect(JSON.stringify(box)).not.toContain('[to be translated]')
        expect(box.buttons[0]).toBe(prose.continueLabel)
        expect(box.buttons[1]).toBe(prose.recoveryLabel)
        expect(box.buttons[2]).toBe(text.exit)
      }

      it('keeps the loaded values when continue is chosen', async () => {
        const before = bootConfigService.getAll()
        await open(0)
        expect(clearLoadError).toHaveBeenCalledOnce()
        expect(repair).not.toHaveBeenCalled()
        expect(reset).not.toHaveBeenCalled()
        expect(bootConfigService.getAll()).toEqual(before)
        expect(electron.exit).not.toHaveBeenCalled()
        expect(electron.relaunch).not.toHaveBeenCalled()
        expect(electron.showMessageBoxSync).not.toHaveBeenCalled()
      })

      it('uses the recovery index only for that error kind', async () => {
        const before = bootConfigService.getAll()
        await open(1)
        expect(clearLoadError).not.toHaveBeenCalled()
        expect(bootConfigService.getAll()).toEqual(before)
        if (kind === 'validation_error') {
          expect(repair).toHaveBeenCalledOnce()
          expect(reset).not.toHaveBeenCalled()
        } else if (kind === 'parse_error') {
          expect(reset).toHaveBeenCalledOnce()
          expect(repair).not.toHaveBeenCalled()
        } else {
          expect(repair).not.toHaveBeenCalled()
          expect(reset).not.toHaveBeenCalled()
        }
        expect(electron.relaunch).not.toHaveBeenCalled()
        expect(electron.showMessageBoxSync).toHaveBeenCalledExactlyOnceWith({
          type: 'info',
          title: text.manualTitle,
          message: text.manualMessage,
          detail: text.manualDetail,
          buttons: [text.ok]
        })
        expect(electron.exit).toHaveBeenCalledExactlyOnceWith(0)
      })

      it('keeps exit at index 2', async () => {
        const before = bootConfigService.getAll()
        await open(2)
        expect(clearLoadError).not.toHaveBeenCalled()
        expect(repair).not.toHaveBeenCalled()
        expect(reset).not.toHaveBeenCalled()
        expect(bootConfigService.getAll()).toEqual(before)
        expect(electron.showMessageBoxSync).not.toHaveBeenCalled()
        expect(electron.relaunch).not.toHaveBeenCalled()
        expect(electron.exit).toHaveBeenCalledExactlyOnceWith(1)
      })
    })
  })

  describe.each(['en-US', 'zh-CN'] as const)('%s fatal service error', (locale) => {
    const text = COPY[locale]
    const causeStack = 'Error: sector RAW-CAUSE-9f3\n    at Disk.read (disk.ts:9:3)'

    function fatalError(): ServiceInitError {
      const cause = new Error('sector RAW-CAUSE-9f3')
      cause.stack = causeStack
      return new ServiceInitError('DbService', cause)
    }

    async function openFatal(responses: number[]): Promise<ShownBox> {
      armReady(locale)
      const show = electron.showMessageBox
      for (const response of responses) show.mockResolvedValueOnce({ response })
      const pending = Application.getInstance()['handleFatalServiceError'](fatalError())
      expect(electron.getLocale).not.toHaveBeenCalled()
      expect(show).not.toHaveBeenCalled()
      releaseReady()
      await pending
      expect(preferenceGet).not.toHaveBeenCalled()
      const box = firstBox()
      expect(box).toMatchObject({
        type: 'error',
        title: text.fatalTitle,
        message: text.fatalMessage,
        detail: `${text.fatalDetail}\n\n${text.analysis}`,
        buttons: [text.exit, text.restart, text.copy, text.feedback, text.releases],
        defaultId: 1,
        cancelId: 0
      })
      expect(JSON.stringify(box)).not.toContain('RAW-CAUSE-9f3')
      expect(JSON.stringify(box)).not.toContain('disk.ts')
      expect(JSON.stringify(box)).not.toContain('[to be translated]')
      return box
    }

    it('quits on the exit index and restarts on the restart index', async () => {
      await openFatal([0])
      expect(electron.exit).toHaveBeenCalledExactlyOnceWith(1)
      expect(electron.relaunch).not.toHaveBeenCalled()
      expect(electron.showMessageBoxSync).not.toHaveBeenCalled()
      expect(electron.writeText).not.toHaveBeenCalled()

      electron.exit.mockClear()
      electron.showMessageBox.mockReset()
      await openFatal([1])
      expect(electron.relaunch).not.toHaveBeenCalled()
      expect(electron.showMessageBoxSync).toHaveBeenCalledExactlyOnceWith({
        type: 'info',
        title: text.manualTitle,
        message: text.manualMessage,
        detail: text.manualDetail,
        buttons: [text.ok]
      })
      expect(electron.exit).toHaveBeenCalledExactlyOnceWith(0)
    })

    it('copies the raw cause and still quits from the original exit index', async () => {
      await openFatal([2, 0])
      expect(electron.writeText).toHaveBeenCalledExactlyOnceWith(causeStack)
      expect(electron.showMessageBox).toHaveBeenCalledTimes(2)
      expect(electron.exit).toHaveBeenCalledExactlyOnceWith(1)
      expect(electron.relaunch).not.toHaveBeenCalled()
    })
  })

  it('does not read the locale before Electron is ready', () => {
    electron.isReady.mockReturnValue(false)
    electron.getLocale.mockImplementation(() => {
      throw new Error('app.getLocale called before ready')
    })
    Object.assign(app, { isPackaged: false })

    Application.getInstance().relaunch()

    expect(electron.getLocale).not.toHaveBeenCalled()
    expect(preferenceGet).not.toHaveBeenCalled()
    expect(electron.showMessageBoxSync).toHaveBeenCalledExactlyOnceWith({
      type: 'info',
      title: 'Manual Restart Required',
      message: 'Auto-relaunch is not available in development mode.',
      detail: 'The app will now exit. Please run `pnpm dev` again to restart.',
      buttons: ['OK']
    })
    expect(electron.exit).toHaveBeenCalledExactlyOnceWith(0)
    expect(electron.relaunch).not.toHaveBeenCalled()
  })
})
