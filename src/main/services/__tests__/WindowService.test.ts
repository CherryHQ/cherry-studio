import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@main/constant', () => ({
  isDev: false,
  isLinux: false,
  isMac: false,
  isWin: true
}))

vi.mock('@main/utils/file', () => ({
  getFilesDir: vi.fn(() => '/mock/files')
}))

vi.mock('@main/utils/windowUtil', () => ({
  getWindowsBackgroundMaterial: vi.fn(() => undefined)
}))

vi.mock('@electron-toolkit/utils', () => ({
  is: {
    dev: false
  }
}))

vi.mock('electron', () => {
  const mock = {
    app: {
      dock: {
        hide: vi.fn(),
        show: vi.fn()
      },
      getPath: vi.fn((key: string) => {
        switch (key) {
          case 'userData':
            return '/mock/userData'
          case 'temp':
            return '/mock/temp'
          case 'logs':
            return '/mock/logs'
          default:
            return '/mock/unknown'
        }
      }),
      getVersion: vi.fn(() => '1.0.0'),
      isQuitting: false,
      quit: vi.fn(),
      on: vi.fn(),
      whenReady: vi.fn(() => Promise.resolve()),
      requestSingleInstanceLock: vi.fn(() => true)
    },
    BrowserWindow: vi.fn(),
    ipcMain: {
      handle: vi.fn(),
      on: vi.fn(),
      once: vi.fn(),
      removeHandler: vi.fn(),
      removeAllListeners: vi.fn()
    },
    dialog: {
      showErrorBox: vi.fn(),
      showMessageBox: vi.fn(),
      showOpenDialog: vi.fn(),
      showSaveDialog: vi.fn()
    },
    nativeImage: {
      createFromPath: vi.fn(() => ({}))
    },
    nativeTheme: {
      shouldUseDarkColors: false,
      themeSource: 'system',
      on: vi.fn(),
      removeListener: vi.fn()
    },
    net: {
      fetch: vi.fn()
    },
    Notification: vi.fn(),
    screen: {
      getCursorScreenPoint: vi.fn(() => ({ x: 0, y: 0 })),
      getDisplayNearestPoint: vi.fn(() => ({ id: 1, bounds: { x: 0, y: 0, width: 1920, height: 1080 } })),
      getPrimaryDisplay: vi.fn(() => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } })),
      getAllDisplays: vi.fn(() => [])
    },
    session: {
      defaultSession: {
        clearCache: vi.fn(),
        clearStorageData: vi.fn()
      }
    },
    shell: {
      openExternal: vi.fn(),
      showItemInFolder: vi.fn()
    },
    systemPreferences: {
      askForMediaAccess: vi.fn(),
      getMediaAccessStatus: vi.fn()
    },
    webContents: {
      getAllWebContents: vi.fn(() => [])
    }
  }

  return { __esModule: true, ...mock, default: mock }
})

vi.mock('../ConfigManager', () => ({
  configManager: {
    getEnableQuickAssistant: vi.fn(() => false),
    getTheme: vi.fn(() => 'system'),
    getTray: vi.fn(() => true),
    getTrayOnClose: vi.fn(() => true),
    getUseSystemTitleBar: vi.fn(() => false),
    getZoomFactor: vi.fn(() => 1),
    setTheme: vi.fn()
  }
}))

vi.mock('../ContextMenu', () => ({
  contextMenu: {
    contextMenu: vi.fn()
  }
}))

vi.mock('../WebviewService', () => ({
  initSessionUserAgent: vi.fn()
}))

vi.mock('../config', () => ({
  titleBarOverlayDark: {},
  titleBarOverlayLight: {}
}))

vi.mock('electron-window-state', () => ({
  default: vi.fn(() => ({ manage: vi.fn(), isMaximized: false }))
}))

import { configManager } from '../ConfigManager'

type MockMainWindow = {
  webContents: {
    send: ReturnType<typeof vi.fn>
  }
  on: ReturnType<typeof vi.fn>
  once: ReturnType<typeof vi.fn>
  hide: ReturnType<typeof vi.fn>
  minimize: ReturnType<typeof vi.fn>
  focus: ReturnType<typeof vi.fn>
  restore: ReturnType<typeof vi.fn>
  show: ReturnType<typeof vi.fn>
  isDestroyed: ReturnType<typeof vi.fn>
  isMinimized: ReturnType<typeof vi.fn>
  isFullScreen: ReturnType<typeof vi.fn>
  isVisible: ReturnType<typeof vi.fn>
  isFocused: ReturnType<typeof vi.fn>
}

const flushImmediate = () => new Promise<void>((resolve) => setImmediate(resolve))

let app: any
let windowService: any

function createMockMainWindow(): MockMainWindow {
  const listeners = new Map<string, (...args: any[]) => void>()

  return {
    webContents: {
      send: vi.fn()
    },
    on: vi.fn((event: string, handler: (...args: any[]) => void) => {
      listeners.set(event, handler)
    }),
    once: vi.fn(),
    hide: vi.fn(),
    minimize: vi.fn(),
    focus: vi.fn(),
    restore: vi.fn(),
    show: vi.fn(),
    isDestroyed: vi.fn(() => false),
    isMinimized: vi.fn(() => false),
    isFullScreen: vi.fn(() => false),
    isVisible: vi.fn(() => true),
    isFocused: vi.fn(() => true),
    getListener: (event: string) => listeners.get(event)
  } as MockMainWindow & { getListener: (event: string) => ((...args: any[]) => void) | undefined }
}

describe('WindowService Windows hide behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    return import('../../../../tests/main.setup').then(async () => {
      const electron = await import('electron')
      app = electron.app
      windowService = (await import('../WindowService')).windowService

      vi.spyOn(app, 'quit').mockImplementation(vi.fn())
      app.isQuitting = false
      windowService.mainWindow = null
      windowService.miniWindow = null
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('minimizes before hiding the main window from the show/hide shortcut', async () => {
    const mainWindow = createMockMainWindow()
    windowService.mainWindow = mainWindow

    windowService.toggleMainWindow()

    expect(mainWindow.minimize).toHaveBeenCalledTimes(1)
    expect(mainWindow.hide).not.toHaveBeenCalled()

    await flushImmediate()

    expect(mainWindow.hide).toHaveBeenCalledTimes(1)
  })

  it('minimizes before hiding the main window when closing to tray', async () => {
    const mainWindow = createMockMainWindow()
    windowService.setupWindowLifecycleEvents(mainWindow)

    const closeHandler = mainWindow.getListener('close')
    expect(closeHandler).toBeDefined()

    const event = {
      preventDefault: vi.fn()
    }

    closeHandler?.(event)

    expect(event.preventDefault).toHaveBeenCalledTimes(1)
    expect(mainWindow.minimize).toHaveBeenCalledTimes(1)
    expect(mainWindow.hide).not.toHaveBeenCalled()

    await flushImmediate()

    expect(mainWindow.hide).toHaveBeenCalledTimes(1)
    expect(app.quit).not.toHaveBeenCalled()
    expect(vi.mocked(configManager.getTray)).toHaveBeenCalled()
    expect(vi.mocked(configManager.getTrayOnClose)).toHaveBeenCalled()
  })

  it('restores and refocuses a minimized main window when reopening', () => {
    const mainWindow = createMockMainWindow()
    mainWindow.isMinimized = vi.fn(() => true)
    windowService.mainWindow = mainWindow

    windowService.showMainWindow()

    expect(mainWindow.restore).toHaveBeenCalledTimes(1)
    expect(mainWindow.focus).toHaveBeenCalledTimes(1)
    expect(mainWindow.show).not.toHaveBeenCalled()
  })
})
