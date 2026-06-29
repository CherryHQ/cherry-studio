import { EventEmitter } from 'events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Hoisted state lets individual tests mutate platform flags / preferences without
// re-mocking modules. The mock factories below read these via getters, preserving
// live-binding semantics so each test sees the current value.
const { platformState, prefValues, applicationMock, windowManagerMock, ipcApiServiceMock, loggerMock } = vi.hoisted(
  () => {
    const platformState = { isMac: false, isWin: false, isLinux: false, isDev: false }
    const prefValues: Record<string, unknown> = {
      'app.tray.enabled': false,
      'app.tray.on_close': false,
      'app.tray.on_launch': false,
      'app.zoom_factor': 1,
      'app.spell_check.enabled': false,
      'app.spell_check.languages': [],
      'app.use_system_title_bar': false
    }
    const windowManagerMock = {
      getWindow: vi.fn(),
      // Mirrors the real shape: runtime behavior setters live on `wm.behavior`
      // (see BehaviorController in src/main/core/window/behavior.ts).
      behavior: {
        setMacShowInDockByType: vi.fn()
      },
      onWindowCreatedByType: vi.fn(() => vi.fn()),
      onWindowDestroyedByType: vi.fn(() => vi.fn()),
      open: vi.fn(() => 'mock-window-id'),
      // Bounds are restored declaratively by WindowManager; setupMainWindow reads
      // the saved maximized flag back through this to re-apply maximize itself.
      peekWindowBounds: vi.fn()
    }
    const ipcApiServiceMock = {
      broadcast: vi.fn()
    }
    const loggerMock = {
      error: vi.fn(),
      info: vi.fn(),
      warn: vi.fn()
    }
    const applicationMock = {
      isQuitting: false,
      quit: vi.fn(),
      forceExit: vi.fn(),
      get: vi.fn((name: string) => {
        if (name === 'PreferenceService') {
          return { get: (key: string) => prefValues[key] }
        }
        if (name === 'WindowManager') {
          return windowManagerMock
        }
        if (name === 'IpcApiService') {
          return ipcApiServiceMock
        }
        throw new Error(`unexpected service: ${name}`)
      }),
      getPath: vi.fn((key: string, filename?: string) => (filename ? `/mock/${key}/${filename}` : `/mock/${key}`))
    }
    return { platformState, prefValues, applicationMock, windowManagerMock, ipcApiServiceMock, loggerMock }
  }
)

vi.mock('@main/core/platform', () => ({
  get isMac() {
    return platformState.isMac
  },
  get isWin() {
    return platformState.isWin
  },
  get isLinux() {
    return platformState.isLinux
  },
  get isDev() {
    return platformState.isDev
  }
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => loggerMock
  }
}))

vi.mock('@application', () => ({
  application: applicationMock
}))

vi.mock('electron', () => ({
  app: { dock: { hide: vi.fn(), show: vi.fn() }, on: vi.fn(), removeListener: vi.fn() },
  BrowserWindow: { fromWebContents: vi.fn() },
  nativeImage: { createFromPath: vi.fn(() => ({})) },
  nativeTheme: { shouldUseDarkColors: false },
  shell: { openExternal: vi.fn(), openPath: vi.fn() }
}))

vi.mock('@electron-toolkit/utils', () => ({ optimizer: { watchWindowShortcuts: vi.fn() } }))

vi.mock('@main/utils/windowUtil', () => ({
  getWindowsBackgroundMaterial: vi.fn(() => undefined),
  replaceDevtoolsFont: vi.fn()
}))

vi.mock('../ContextMenu', () => ({ contextMenu: { contextMenu: vi.fn() } }))
vi.mock('../../utils/externalUrlSafety', () => ({ isSafeExternalUrl: vi.fn(() => false) }))

// `?asset` import resolves to a string at build time; in tests we just stub the path.
vi.mock('../../../../build/icon.png?asset', () => ({ default: '/mock/icon.png' }))

// BaseService.ipcHandle/ipcOn/registerDisposable rely on real ipc internals; bypass them here.
vi.mock('@main/core/lifecycle', async () => {
  const actual = (await vi.importActual('@main/core/lifecycle')) as Record<string, unknown>
  class StubBase {
    ipcHandle = vi.fn()
    ipcOn = vi.fn()
    registerDisposable = <T>(d: T) => d
  }
  return { ...actual, BaseService: StubBase }
})

import { WindowType } from '@main/core/window/types'

import { MainWindowService } from '../MainWindowService'

interface MockBrowserWindow extends EventEmitter {
  isDestroyed: ReturnType<typeof vi.fn>
  isFullScreen: ReturnType<typeof vi.fn>
  isMinimized: ReturnType<typeof vi.fn>
  isVisible: ReturnType<typeof vi.fn>
  isFocused: ReturnType<typeof vi.fn>
  hide: ReturnType<typeof vi.fn>
  show: ReturnType<typeof vi.fn>
  focus: ReturnType<typeof vi.fn>
  restore: ReturnType<typeof vi.fn>
  maximize: ReturnType<typeof vi.fn>
  setVisibleOnAllWorkspaces: ReturnType<typeof vi.fn>
  setFullScreen: ReturnType<typeof vi.fn>
  webContents: EventEmitter & {
    reload: ReturnType<typeof vi.fn>
    on: ReturnType<typeof vi.fn>
    isLoadingMainFrame: ReturnType<typeof vi.fn>
  }
}

function createMockWindow(): MockBrowserWindow {
  const win = new EventEmitter() as MockBrowserWindow
  win.isDestroyed = vi.fn(() => false)
  win.isFullScreen = vi.fn(() => false)
  win.isMinimized = vi.fn(() => false)
  win.isVisible = vi.fn(() => true)
  win.isFocused = vi.fn(() => true)
  win.hide = vi.fn()
  win.show = vi.fn()
  win.focus = vi.fn()
  win.restore = vi.fn()
  win.maximize = vi.fn()
  win.setVisibleOnAllWorkspaces = vi.fn()
  win.setFullScreen = vi.fn()
  win.webContents = new EventEmitter() as MockBrowserWindow['webContents']
  win.webContents.reload = vi.fn()
  // capture render-process-gone listener for crash-recovery tests
  win.webContents.on = vi.fn((event: string | symbol, listener: (...args: any[]) => void) => {
    EventEmitter.prototype.on.call(win.webContents, event, listener)
    return win.webContents
  }) as MockBrowserWindow['webContents']['on']
  win.webContents.isLoadingMainFrame = vi.fn(() => false)
  return win
}

function attachCloseListener(svc: MainWindowService, win: MockBrowserWindow) {
  // Private method — invoked directly so we can capture the registered close handler.

  ;(svc as any).setupWindowLifecycleEvents(win)
}

function attachCrashMonitor(svc: MainWindowService, win: MockBrowserWindow) {

  ;(svc as any).setupMainWindowMonitor(win)
}

function getCrashListener(win: MockBrowserWindow): (event: unknown, details: unknown) => void {
  const call = win.webContents.on.mock.calls.find(([event]) => event === 'render-process-gone')
  if (!call) throw new Error('render-process-gone listener not registered')
  return call[1]
}

function getCreatedByTypeListener() {
  const calls = windowManagerMock.onWindowCreatedByType.mock.calls as unknown as Array<
    [WindowType | string, (managed: { window: MockBrowserWindow }) => void]
  >
  const call = calls.find(([type]) => type === WindowType.Main)
  if (!call) throw new Error('main window created listener not registered')
  return call[1]
}

function makeCloseEvent() {
  return { preventDefault: vi.fn() }
}

describe('MainWindowService', () => {
  let svc: MainWindowService
  let win: MockBrowserWindow

  beforeEach(() => {
    platformState.isMac = false
    platformState.isWin = false
    platformState.isLinux = false
    platformState.isDev = false
    prefValues['app.tray.enabled'] = false
    prefValues['app.tray.on_close'] = false
    applicationMock.isQuitting = false
    applicationMock.quit.mockReset()
    applicationMock.forceExit.mockReset()
    windowManagerMock.behavior.setMacShowInDockByType.mockReset()
    windowManagerMock.open.mockClear()
    ipcApiServiceMock.broadcast.mockReset()
    loggerMock.error.mockReset()

    svc = new MainWindowService()
    win = createMockWindow()
    ;(svc as any).onInit()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('replays the existing main window to late subscribers', () => {
    ;(svc as any).mainWindow = win
    const listener = vi.fn()

    svc.onMainWindowCreated(listener)

    expect(listener).toHaveBeenCalledWith(win)
  })

  it('logs late subscriber replay failures without throwing', () => {
    ;(svc as any).mainWindow = win
    const error = new Error('listener failed')
    const listener = vi.fn(() => {
      throw error
    })

    expect(() => svc.onMainWindowCreated(listener)).not.toThrow()

    expect(listener).toHaveBeenCalledWith(win)
    expect(loggerMock.error).toHaveBeenCalledWith('Failed to replay main window listener', error)
  })

  describe('close handler', () => {
    it('does nothing when application.isQuitting is true (lets native close proceed)', () => {
      applicationMock.isQuitting = true
      attachCloseListener(svc, win)
      const event = makeCloseEvent()

      win.emit('close', event)

      expect(event.preventDefault).not.toHaveBeenCalled()
      expect(win.hide).not.toHaveBeenCalled()
      expect(applicationMock.quit).not.toHaveBeenCalled()
    })

    it('calls application.quit() on Win when tray is disabled', () => {
      platformState.isWin = true
      prefValues['app.tray.enabled'] = false
      attachCloseListener(svc, win)
      const event = makeCloseEvent()

      win.emit('close', event)

      expect(applicationMock.quit).toHaveBeenCalledTimes(1)
      expect(event.preventDefault).not.toHaveBeenCalled()
      expect(win.hide).not.toHaveBeenCalled()
    })

    it('calls application.quit() on Linux when tray is enabled but on_close is false', () => {
      platformState.isLinux = true
      prefValues['app.tray.enabled'] = true
      prefValues['app.tray.on_close'] = false
      attachCloseListener(svc, win)
      const event = makeCloseEvent()

      win.emit('close', event)

      expect(applicationMock.quit).toHaveBeenCalledTimes(1)
      expect(win.hide).not.toHaveBeenCalled()
    })

    it('preventDefaults and hides on Win when tray + on_close are both enabled', () => {
      platformState.isWin = true
      prefValues['app.tray.enabled'] = true
      prefValues['app.tray.on_close'] = true
      attachCloseListener(svc, win)
      const event = makeCloseEvent()

      win.emit('close', event)

      expect(applicationMock.quit).not.toHaveBeenCalled()
      expect(event.preventDefault).toHaveBeenCalledTimes(1)
      expect(win.hide).toHaveBeenCalledTimes(1)
    })

    it('hides on macOS by default (system handles dock + relaunch)', () => {
      platformState.isMac = true
      prefValues['app.tray.enabled'] = false
      attachCloseListener(svc, win)
      const event = makeCloseEvent()

      win.emit('close', event)

      // No quit on macOS even with tray disabled — system follows the standard
      // "close hides, app stays in Dock" pattern; quit is reserved for Cmd+Q.
      expect(applicationMock.quit).not.toHaveBeenCalled()
      expect(event.preventDefault).toHaveBeenCalledTimes(1)
      expect(win.hide).toHaveBeenCalledTimes(1)
      // Critical: must NOT suppress Dock on standard mac close. Previous regression
      // hid the Dock icon along with the window, breaking macOS native semantics
      // (Dock tracks app liveness, not window visibility).
      expect(windowManagerMock.behavior.setMacShowInDockByType).not.toHaveBeenCalled()
    })

    it('does not preventDefault when window is fullscreen on macOS+tray (lets native close exit fullscreen)', () => {
      platformState.isMac = true
      prefValues['app.tray.enabled'] = true
      prefValues['app.tray.on_close'] = true
      win.isFullScreen.mockReturnValue(true)
      attachCloseListener(svc, win)
      const event = makeCloseEvent()

      win.emit('close', event)

      expect(event.preventDefault).not.toHaveBeenCalled()
      // hide is still called — the native close path will tear down fullscreen first.
      expect(win.hide).toHaveBeenCalledTimes(1)
    })

    it('suppresses Main-type Dock contribution on macOS + tray on_close', () => {
      platformState.isMac = true
      prefValues['app.tray.enabled'] = true
      prefValues['app.tray.on_close'] = true
      attachCloseListener(svc, win)
      const event = makeCloseEvent()

      win.emit('close', event)

      // wm.behavior.setMacShowInDockByType(Main, false) must be called BEFORE hide so the
      // Dock update resolves to hidden before the window transition lands.
      expect(windowManagerMock.behavior.setMacShowInDockByType).toHaveBeenCalledWith('main', false)
      expect(event.preventDefault).toHaveBeenCalledTimes(1)
      expect(win.hide).toHaveBeenCalledTimes(1)
    })

    it('does not touch Dock override on Win/Linux tray close (Dock is macOS-only)', () => {
      platformState.isWin = true
      prefValues['app.tray.enabled'] = true
      prefValues['app.tray.on_close'] = true
      attachCloseListener(svc, win)
      const event = makeCloseEvent()

      win.emit('close', event)

      expect(windowManagerMock.behavior.setMacShowInDockByType).not.toHaveBeenCalled()
    })
  })

  describe('toggleMainWindow', () => {
    it('hides a focused visible main window even when tray-close is disabled', () => {
      ;(svc as any).mainWindow = win
      prefValues['app.tray.on_close'] = false

      svc.toggleMainWindow()

      expect(win.hide).toHaveBeenCalledTimes(1)
      expect(windowManagerMock.behavior.setMacShowInDockByType).not.toHaveBeenCalled()
    })

    it('focuses a visible unfocused main window instead of hiding it', () => {
      ;(svc as any).mainWindow = win
      win.isFocused.mockReturnValue(false)

      svc.toggleMainWindow()

      expect(win.focus).toHaveBeenCalledTimes(1)
      expect(win.hide).not.toHaveBeenCalled()
    })

    it('keeps Dock suppression when hiding on macOS with tray-close enabled', () => {
      platformState.isMac = true
      prefValues['app.tray.on_close'] = true
      ;(svc as any).mainWindow = win

      svc.toggleMainWindow()

      expect(windowManagerMock.behavior.setMacShowInDockByType).toHaveBeenCalledWith('main', false)
      expect(win.hide).toHaveBeenCalledTimes(1)
    })
  })

  describe('openSettingsTab', () => {
    it('shows the existing main window and broadcasts a settings-tab request', () => {
      ;(svc as any).mainWindow = win

      svc.openSettingsTab()

      expect(win.show).toHaveBeenCalledTimes(1)
      expect(win.focus).toHaveBeenCalledTimes(1)
      expect(ipcApiServiceMock.broadcast).toHaveBeenCalledWith('app.open_settings_tab', {})
    })

    it('waits for the created main window to finish loading before broadcasting', () => {
      win.webContents.isLoadingMainFrame.mockReturnValue(true)
      vi.spyOn(svc as any, 'setupMainWindow').mockImplementation(() => {})
      const createdByTypeListener = getCreatedByTypeListener()
      windowManagerMock.open.mockImplementationOnce(() => {
        createdByTypeListener({ window: win })
        return 'mock-window-id'
      })

      svc.openSettingsTab()

      expect(windowManagerMock.open).toHaveBeenCalledWith(WindowType.Main, expect.any(Object))
      expect(ipcApiServiceMock.broadcast).not.toHaveBeenCalled()

      win.webContents.isLoadingMainFrame.mockReturnValue(false)
      win.webContents.emit('did-finish-load')

      expect(ipcApiServiceMock.broadcast).toHaveBeenCalledWith('app.open_settings_tab', {})
    })

    it('coalesces repeated settings-tab requests while a newly created main window is loading', () => {
      win.webContents.isLoadingMainFrame.mockReturnValue(true)
      vi.spyOn(svc as any, 'setupMainWindow').mockImplementation(() => {})
      const didFinishLoadListenerCount = () => win.webContents.listenerCount('did-finish-load')
      const createdByTypeListener = getCreatedByTypeListener()
      windowManagerMock.open.mockImplementationOnce(() => {
        createdByTypeListener({ window: win })
        return 'mock-window-id'
      })

      svc.openSettingsTab()
      svc.openSettingsTab()

      expect(windowManagerMock.open).toHaveBeenCalledTimes(1)
      expect(didFinishLoadListenerCount()).toBe(1)
      expect(ipcApiServiceMock.broadcast).not.toHaveBeenCalled()

      win.webContents.isLoadingMainFrame.mockReturnValue(false)
      win.webContents.emit('did-finish-load')

      expect(ipcApiServiceMock.broadcast).toHaveBeenCalledTimes(1)
    })
  })

  describe('crash recovery', () => {
    it('reloads webContents on first crash', () => {
      attachCrashMonitor(svc, win)
      const listener = getCrashListener(win)

      listener(null, { reason: 'crashed' })

      expect(win.webContents.reload).toHaveBeenCalledTimes(1)
      expect(applicationMock.forceExit).not.toHaveBeenCalled()
    })

    it('forceExits on second crash within 60 seconds', () => {
      attachCrashMonitor(svc, win)
      const listener = getCrashListener(win)
      const realNow = Date.now
      try {
        Date.now = vi.fn().mockReturnValueOnce(1000).mockReturnValueOnce(1500)
        listener(null, { reason: 'crashed' })
        listener(null, { reason: 'crashed' })
      } finally {
        Date.now = realNow
      }

      expect(applicationMock.forceExit).toHaveBeenCalledWith(1)
    })
  })

  // Maximize restore stays consumer-side (WindowManager restores position/size
  // declaratively; the service re-applies the maximized flag on its own show
  // schedule because tray-on-launch must defer it to the first show).
  describe('setupMaximize restore', () => {
    const setupMaximize = (isMaximized: boolean) => (svc as any).setupMaximize(win, isMaximized)

    it('maximizes immediately when restoring a maximized window on a normal launch', () => {
      prefValues['app.tray.on_launch'] = false
      setupMaximize(true)
      expect(win.maximize).toHaveBeenCalledTimes(1)
    })

    it('defers maximize to first show when launching to tray', () => {
      prefValues['app.tray.on_launch'] = true
      setupMaximize(true)

      // Not yet — the window is still hidden in the tray.
      expect(win.maximize).not.toHaveBeenCalled()

      win.emit('show')
      expect(win.maximize).toHaveBeenCalledTimes(1)
    })

    it('does nothing when the saved state was not maximized', () => {
      prefValues['app.tray.on_launch'] = false
      setupMaximize(false)
      win.emit('show')
      expect(win.maximize).not.toHaveBeenCalled()
    })
  })

  // The wiring itself: setupMainWindow must read the saved maximized flag back
  // from WindowManager (bounds are restored declaratively by WM; the service only
  // re-applies maximize). Tested via setupMainWindow (not setupMaximize directly)
  // so a regression that read the wrong type or dropped the call would be caught.
  describe('setupMainWindow → maximize wiring', () => {
    beforeEach(() => {
      // Stub the other (heavy) setup steps so this isolates the read-back path.
      for (const m of [
        'setupContextMenu',
        'setupSpellCheck',
        'setupWindowEvents',
        'setupWebContentsHandlers',
        'setupWindowLifecycleEvents',
        'setupMainWindowMonitor'
      ]) {
        vi.spyOn(svc as any, m).mockImplementation(() => {})
      }
      prefValues['app.tray.on_launch'] = false
    })

    it('reads the saved maximized flag from WindowManager and re-applies maximize', () => {
      windowManagerMock.peekWindowBounds.mockReturnValue({
        x: 0,
        y: 0,
        width: 800,
        height: 600,
        isMaximized: true,
        displayBounds: { x: 0, y: 0, width: 1920, height: 1080 }
      })

      ;(svc as any).setupMainWindow(win)

      expect(windowManagerMock.peekWindowBounds).toHaveBeenCalledWith(WindowType.Main)
      expect(win.maximize).toHaveBeenCalledTimes(1)
    })

    it('does not maximize when WindowManager has no saved bounds', () => {
      windowManagerMock.peekWindowBounds.mockReturnValue(undefined)

      ;(svc as any).setupMainWindow(win)

      expect(windowManagerMock.peekWindowBounds).toHaveBeenCalledWith(WindowType.Main)
      expect(win.maximize).not.toHaveBeenCalled()
    })
  })
})
