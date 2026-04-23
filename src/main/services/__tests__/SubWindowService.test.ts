import { EventEmitter } from 'events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Hoisted state mirrors the pattern in MainWindowService.test.ts: platform flags are
// per-test mutable, mocks use getters to preserve live-binding semantics.
const { platformState, nativeThemeState, applicationMock, windowManagerMock } = vi.hoisted(() => {
  const platformState = { isMac: false, isWin: false, isLinux: false }
  const nativeThemeState = { shouldUseDarkColors: false }
  const windowManagerMock = {
    open: vi.fn<(type: string, args?: { initData?: unknown; options?: Record<string, unknown> }) => string>(
      () => 'mock-window-id'
    ),
    close: vi.fn<(id: string) => boolean>(() => true),
    getWindow: vi.fn<(id: string) => unknown>(() => undefined),
    getWindowsByType: vi.fn<(type: string) => Array<{ id: string }>>(() => []),
    getWindowIdByWebContents: vi.fn<(wc: unknown) => string | undefined>(() => undefined),
    broadcastToType: vi.fn<(type: string, channel: string, ...rest: unknown[]) => void>()
  }
  const applicationMock = {
    get: vi.fn((name: string) => {
      if (name === 'WindowManager') return windowManagerMock
      throw new Error(`unexpected service: ${name}`)
    })
  }
  return { platformState, nativeThemeState, applicationMock, windowManagerMock }
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
  }
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })
  }
}))

vi.mock('@application', () => ({ application: applicationMock }))

vi.mock('@main/config', () => ({
  titleBarOverlayDark: { symbolColor: '#ffffff', color: '#181818', height: 40 },
  titleBarOverlayLight: { symbolColor: '#000000', color: '#FFFFFF', height: 40 }
}))

vi.mock('electron', () => ({
  BrowserWindow: { fromWebContents: vi.fn() },
  get nativeTheme() {
    return nativeThemeState
  }
}))

vi.mock('@main/core/lifecycle', async () => {
  const actual = (await vi.importActual('@main/core/lifecycle')) as Record<string, unknown>
  class StubBase {
    ipcHandle = vi.fn()
    ipcOn = vi.fn()
    registerDisposable = <T>(d: T) => d
  }
  return { ...actual, BaseService: StubBase }
})

// Import after mocks
import { BrowserWindow } from 'electron'

import { SubWindowService } from '../SubWindowService'

interface MockBrowserWindow extends EventEmitter {
  isDestroyed: ReturnType<typeof vi.fn>
  isVisible: ReturnType<typeof vi.fn>
  show: ReturnType<typeof vi.fn>
  setContentBounds: ReturnType<typeof vi.fn>
  setPosition: ReturnType<typeof vi.fn>
  setOpacity: ReturnType<typeof vi.fn>
  getOpacity: ReturnType<typeof vi.fn>
  getBounds: ReturnType<typeof vi.fn>
  getContentBounds: ReturnType<typeof vi.fn>
}

function createMockWindow(overrides: Partial<MockBrowserWindow> = {}): MockBrowserWindow {
  const win = new EventEmitter() as MockBrowserWindow
  win.isDestroyed = vi.fn(() => false)
  win.isVisible = vi.fn(() => true)
  win.show = vi.fn()
  win.setContentBounds = vi.fn()
  win.setPosition = vi.fn()
  win.setOpacity = vi.fn()
  win.getOpacity = vi.fn(() => 1)
  win.getBounds = vi.fn(() => ({ x: 100, y: 100, width: 1200, height: 800 }))
  win.getContentBounds = vi.fn(() => ({ x: 100, y: 100, width: 800, height: 600 }))
  Object.assign(win, overrides)
  return win
}

function lastOpenCall() {
  const call = windowManagerMock.open.mock.calls.at(-1)
  if (!call) throw new Error('wm.open was not called')
  const [type, args] = call
  return { type, args: args ?? {} }
}

function getIpcOnHandler(svc: SubWindowService, channel: string) {
  const call = (svc as any).ipcOn.mock.calls.find(([c]: [string]) => c === channel)
  if (!call) throw new Error(`ipcOn handler not registered for channel: ${channel}`)
  return call[1]
}

function getIpcHandleHandler(svc: SubWindowService, channel: string) {
  const call = (svc as any).ipcHandle.mock.calls.find(([c]: [string]) => c === channel)
  if (!call) throw new Error(`ipcHandle handler not registered for channel: ${channel}`)
  return call[1]
}

describe('SubWindowService', () => {
  let svc: SubWindowService

  beforeEach(async () => {
    platformState.isMac = false
    platformState.isWin = false
    platformState.isLinux = false
    nativeThemeState.shouldUseDarkColors = false
    windowManagerMock.open.mockReset().mockReturnValue('mock-window-id')
    windowManagerMock.close.mockReset().mockReturnValue(true)
    windowManagerMock.getWindow.mockReset().mockReturnValue(undefined)
    windowManagerMock.getWindowsByType.mockReset().mockReturnValue([])
    windowManagerMock.getWindowIdByWebContents.mockReset().mockReturnValue(undefined)
    windowManagerMock.broadcastToType.mockReset()
    vi.mocked(BrowserWindow.fromWebContents).mockReset()

    svc = new SubWindowService()
    // Service registers its handlers in onInit; drive it manually since we stubbed BaseService.
    await (svc as any).onInit()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('createWindow - options injection', () => {
    it('on macOS injects titleBarOverlay and omits backgroundColor (preserves vibrancy)', () => {
      platformState.isMac = true
      nativeThemeState.shouldUseDarkColors = true
      const win = createMockWindow()
      windowManagerMock.getWindow.mockReturnValue(win)

      svc.createWindow({ id: 'tab-1', url: 'cherry://chat', title: 'Chat' })

      expect(windowManagerMock.open).toHaveBeenCalledTimes(1)
      const { type, args } = lastOpenCall()
      expect(type).toBe('subWindow')
      expect(args.options).toMatchObject({
        title: 'Chat',
        darkTheme: true,
        titleBarOverlay: expect.objectContaining({ color: '#181818' })
      })
      expect(args.options).not.toHaveProperty('backgroundColor')
    })

    it('on Windows injects backgroundColor and omits titleBarOverlay', () => {
      platformState.isWin = true
      nativeThemeState.shouldUseDarkColors = false
      const win = createMockWindow()
      windowManagerMock.getWindow.mockReturnValue(win)

      svc.createWindow({ id: 'tab-2', url: 'cherry://mcp' })

      const { args } = lastOpenCall()
      expect(args.options).toMatchObject({
        darkTheme: false,
        backgroundColor: '#FFFFFF'
      })
      expect(args.options).not.toHaveProperty('titleBarOverlay')
    })

    it('threads initData shape for both route and pinned tabs', () => {
      const win = createMockWindow()
      windowManagerMock.getWindow.mockReturnValue(win)

      svc.createWindow({ id: 'tab-3', url: 'cherry://agent', title: 'Agent', type: 'webview', isPinned: true })

      const { args } = lastOpenCall()
      expect(args.initData).toEqual({
        tabId: 'tab-3',
        url: 'cherry://agent',
        title: 'Agent',
        type: 'webview',
        isPinned: true
      })
    })

    it('coerces unknown tab type to "route" in initData (renderer relies on the narrow union)', () => {
      const win = createMockWindow()
      windowManagerMock.getWindow.mockReturnValue(win)

      svc.createWindow({ id: 'tab-4', url: 'cherry://x', type: 'bogus' })

      const { args } = lastOpenCall()
      expect((args.initData as { type?: string }).type).toBe('route')
    })

    it('omits icon on macOS and Windows (system provides taskbar/Dock icon)', () => {
      const win = createMockWindow()
      windowManagerMock.getWindow.mockReturnValue(win)

      platformState.isMac = true
      svc.createWindow({ id: 'tab-mac', url: 'u' })
      expect(lastOpenCall().args.options).not.toHaveProperty('icon')

      platformState.isMac = false
      platformState.isWin = true
      svc.createWindow({ id: 'tab-win', url: 'u' })
      expect(lastOpenCall().args.options).not.toHaveProperty('icon')
    })

    it('passes through initial x/y when provided; omits them otherwise', () => {
      const win = createMockWindow()
      windowManagerMock.getWindow.mockReturnValue(win)

      svc.createWindow({ id: 'tab-5', url: 'u', x: 50, y: 60 })
      expect(lastOpenCall().args.options).toMatchObject({ x: 50, y: 60 })

      windowManagerMock.open.mockClear()
      svc.createWindow({ id: 'tab-6', url: 'u' })
      const opts = lastOpenCall().args.options
      expect(opts).not.toHaveProperty('x')
      expect(opts).not.toHaveProperty('y')
    })
  })

  describe('createWindow - tabId → windowId mapping + cleanup', () => {
    it('populates tabIdToWindowId after open and cleans up on "closed"', () => {
      const win = createMockWindow()
      windowManagerMock.getWindow.mockReturnValue(win)
      windowManagerMock.open.mockReturnValue('wid-A')

      svc.createWindow({ id: 'tab-A', url: 'u' })
      expect((svc as any).tabIdToWindowId.get('tab-A')).toBe('wid-A')

      win.emit('closed')
      expect((svc as any).tabIdToWindowId.has('tab-A')).toBe(false)
      expect((svc as any).windowState.has('tab-A')).toBe(false)
    })

    it('auto-shows on ready-to-show only when no initial position was provided', () => {
      const win = createMockWindow()
      windowManagerMock.getWindow.mockReturnValue(win)

      svc.createWindow({ id: 'tab-noxy', url: 'u' })
      win.emit('ready-to-show')
      expect(win.show).toHaveBeenCalledTimes(1)

      win.show.mockClear()
      const win2 = createMockWindow()
      windowManagerMock.getWindow.mockReturnValue(win2)
      svc.createWindow({ id: 'tab-xy', url: 'u', x: 10, y: 10 })
      win2.emit('ready-to-show')
      expect(win2.show).not.toHaveBeenCalled()
    })
  })

  describe('Tab_Attach handler', () => {
    it('closes sender when it is tracked as SubWindow by WindowManager', async () => {
      const handler = getIpcHandleHandler(svc, 'tab:attach')
      windowManagerMock.getWindowsByType.mockImplementation((type) =>
        type === 'main' ? [{ id: 'main-1' } as any] : type === 'subWindow' ? [{ id: 'sub-1' } as any] : []
      )
      windowManagerMock.getWindowIdByWebContents.mockReturnValue('sub-1')

      const result = await handler({ sender: {} } as any, { id: 'some-tab' })

      expect(result).toBe(true)
      expect(windowManagerMock.broadcastToType).toHaveBeenCalledWith('main', 'tab:attach', { id: 'some-tab' })
      expect(windowManagerMock.close).toHaveBeenCalledWith('sub-1')
    })

    it('does not close sender when sender is the Main window', async () => {
      const handler = getIpcHandleHandler(svc, 'tab:attach')
      windowManagerMock.getWindowsByType.mockImplementation((type) =>
        type === 'main' ? [{ id: 'main-1' } as any] : type === 'subWindow' ? [] : []
      )
      windowManagerMock.getWindowIdByWebContents.mockReturnValue('main-1')

      const result = await handler({ sender: {} } as any, { id: 'some-tab' })

      expect(result).toBe(true)
      expect(windowManagerMock.close).not.toHaveBeenCalled()
    })

    it('fails when no Main window exists', async () => {
      const handler = getIpcHandleHandler(svc, 'tab:attach')
      windowManagerMock.getWindowsByType.mockReturnValue([])

      const result = await handler({ sender: {} } as any, { id: 'some-tab' })
      expect(result).toBe(false)
      expect(windowManagerMock.broadcastToType).not.toHaveBeenCalled()
    })
  })

  describe('Tab_MoveWindow handler', () => {
    it('prefers tabId lookup over event.sender', () => {
      const targetWin = createMockWindow()
      const senderWin = createMockWindow()
      windowManagerMock.getWindow.mockImplementation((id) => (id === 'wid-target' ? targetWin : undefined))
      ;(svc as any).tabIdToWindowId.set('tab-move', 'wid-target')
      vi.mocked(BrowserWindow.fromWebContents).mockReturnValue(senderWin as any)

      const handler = getIpcOnHandler(svc, 'tab:move-window')
      handler({ sender: {} } as any, { tabId: 'tab-move', x: 100, y: 200 })

      // moved target window, not sender
      if (platformState.isWin || platformState.isLinux) {
        expect(targetWin.setContentBounds).toHaveBeenCalled()
      } else {
        expect(targetWin.setPosition).toHaveBeenCalledWith(100, 200)
      }
      expect(senderWin.setContentBounds).not.toHaveBeenCalled()
      expect(senderWin.setPosition).not.toHaveBeenCalled()
    })

    it('falls back to sender webContents when tabId is not mapped', () => {
      const senderWin = createMockWindow()
      vi.mocked(BrowserWindow.fromWebContents).mockReturnValue(senderWin as any)

      const handler = getIpcOnHandler(svc, 'tab:move-window')
      handler({ sender: {} } as any, { tabId: 'unknown-tab', x: 10, y: 20 })

      expect(senderWin.setPosition).toHaveBeenCalledWith(10, 20)
    })

    it('sets opacity 0.85 when sub window is moving its own tab (object-identity sender==target)', () => {
      const win = createMockWindow()
      windowManagerMock.getWindow.mockReturnValue(win)
      ;(svc as any).tabIdToWindowId.set('tab-self', 'wid-self')
      vi.mocked(BrowserWindow.fromWebContents).mockReturnValue(win as any)

      const handler = getIpcOnHandler(svc, 'tab:move-window')
      handler({ sender: {} } as any, { tabId: 'tab-self', x: 5, y: 5 })

      expect(win.setOpacity).toHaveBeenCalledWith(0.85)
    })
  })

  describe('Tab_TryAttach handler', () => {
    it('broadcasts + closes sub window when drop is over Main tab bar', async () => {
      const handler = getIpcHandleHandler(svc, 'tab:try-attach')
      const mainWin = createMockWindow()
      windowManagerMock.getWindowsByType.mockImplementation((type) =>
        type === 'main' ? [{ id: 'main-1' } as any] : []
      )
      windowManagerMock.getWindow.mockReturnValue(mainWin)
      ;(svc as any).tabIdToWindowId.set('tab-drop', 'wid-drop')

      const result = await handler({} as any, {
        tab: { id: 'tab-drop' },
        screenX: 500,
        screenY: 120 // within 100..900 x and 100..140 y (tab bar 40px)
      })

      expect(result).toBe(true)
      expect(windowManagerMock.broadcastToType).toHaveBeenCalledWith('main', 'tab:attach', { id: 'tab-drop' })
      expect(windowManagerMock.close).toHaveBeenCalledWith('wid-drop')
    })

    it('restores opacity to 1 when drop misses the tab bar', async () => {
      const handler = getIpcHandleHandler(svc, 'tab:try-attach')
      const mainWin = createMockWindow()
      const subWin = createMockWindow()
      windowManagerMock.getWindowsByType.mockImplementation((type) =>
        type === 'main' ? [{ id: 'main-1' } as any] : []
      )
      windowManagerMock.getWindow.mockImplementation((id) => {
        if (id === 'main-1') return mainWin
        if (id === 'wid-drop') return subWin
        return undefined
      })
      ;(svc as any).tabIdToWindowId.set('tab-drop', 'wid-drop')

      const result = await handler({} as any, {
        tab: { id: 'tab-drop' },
        screenX: 500,
        screenY: 500 // well below tab bar
      })

      expect(result).toBe(false)
      expect(windowManagerMock.close).not.toHaveBeenCalled()
      expect(subWin.setOpacity).toHaveBeenCalledWith(1)
    })
  })

  describe('Tab_DragEnd handler', () => {
    it('restores opacity only when sender opacity is <1 (self-gating predicate)', () => {
      const translucentWin = createMockWindow({ getOpacity: vi.fn(() => 0.85) })
      vi.mocked(BrowserWindow.fromWebContents).mockReturnValue(translucentWin as any)
      const handler = getIpcOnHandler(svc, 'tab:drag-end')
      handler({ sender: {} } as any)
      expect(translucentWin.setOpacity).toHaveBeenCalledWith(1)

      const opaqueWin = createMockWindow({ getOpacity: vi.fn(() => 1) })
      vi.mocked(BrowserWindow.fromWebContents).mockReturnValue(opaqueWin as any)
      handler({ sender: {} } as any)
      expect(opaqueWin.setOpacity).not.toHaveBeenCalled()
    })
  })
})
