import { EventEmitter } from 'events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Hoisted state lets individual tests mutate platform flags / preferences without
// re-mocking modules. The mock factories below read these via getters, preserving
// live-binding semantics so each test sees the current value.
const { platformState, prefValues, applicationMock, windowManagerMock } = vi.hoisted(() => {
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
    open: vi.fn(() => 'mock-window-id')
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
      throw new Error(`unexpected service: ${name}`)
    }),
    getPath: vi.fn((key: string, filename?: string) => (filename ? `/mock/${key}/${filename}` : `/mock/${key}`))
  }
  return { platformState, prefValues, applicationMock, windowManagerMock }
})

vi.mock('@main/constant', () => ({
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
    withContext: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() })
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

vi.mock('electron-window-state', () => ({
  default: vi.fn(() => ({ x: 0, y: 0, width: 960, height: 600, isMaximized: false, manage: vi.fn() }))
}))

vi.mock('electron-devtools-installer', () => ({ default: vi.fn(), REACT_DEVELOPER_TOOLS: 'react-devtools' }))

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
  setVisibleOnAllWorkspaces: ReturnType<typeof vi.fn>
  setFullScreen: ReturnType<typeof vi.fn>
  webContents: { reload: ReturnType<typeof vi.fn>; on: ReturnType<typeof vi.fn> }
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
  win.setVisibleOnAllWorkspaces = vi.fn()
  win.setFullScreen = vi.fn()
  win.webContents = {
    reload: vi.fn(),
    // capture render-process-gone listener for crash-recovery tests
    on: vi.fn()
  }
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

    svc = new MainWindowService()
    win = createMockWindow()
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
})
