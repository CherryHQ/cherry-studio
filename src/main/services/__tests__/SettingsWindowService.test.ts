import { EventEmitter } from 'events'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { applicationMock, windowManagerMock } = vi.hoisted(() => {
  const windowManagerMock = {
    open: vi.fn<(type: string, args?: { initData?: unknown; options?: unknown }) => string>(() => 'settings-window-id'),
    getWindow: vi.fn<(id: string) => unknown>(() => undefined),
    getWindowsByType: vi.fn<(type: string) => unknown[]>(() => []),
    getWindowIdByWebContents: vi.fn<(sender: unknown) => string | null>(() => null),
    close: vi.fn<(id: string) => void>(),
    onWindowCreatedByType: vi.fn(() => ({ dispose: vi.fn() })),
    onWindowDestroyedByType: vi.fn(() => ({ dispose: vi.fn() }))
  }
  const applicationMock = {
    get: vi.fn((name: string) => {
      if (name === 'WindowManager') return windowManagerMock
      throw new Error(`unexpected service: ${name}`)
    })
  }
  return { applicationMock, windowManagerMock }
})

vi.mock('@application', () => ({ application: applicationMock }))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      debug: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      info: vi.fn()
    })
  }
}))

vi.mock('electron', () => ({
  nativeTheme: {
    shouldUseDarkColors: false
  }
}))

vi.mock('@main/core/lifecycle', async () => {
  const actual = (await vi.importActual('@main/core/lifecycle')) as Record<string, unknown>
  class StubBase {
    protected ipcHandle = vi.fn()
    protected registerDisposable = vi.fn(<T>(disposable: T) => disposable)
  }
  return { ...actual, BaseService: StubBase }
})

import { WindowType } from '@main/core/window/types'
import { IpcChannel } from '@shared/IpcChannel'

import { createSettingsWindowOptions, SettingsWindowService } from '../SettingsWindowService'

interface MockWebContents extends EventEmitter {
  send: ReturnType<typeof vi.fn>
  isDestroyed: ReturnType<typeof vi.fn>
}

interface MockBrowserWindow extends EventEmitter {
  webContents: MockWebContents
  setTitle: ReturnType<typeof vi.fn>
  getBounds: ReturnType<typeof vi.fn>
  setBounds: ReturnType<typeof vi.fn>
  isDestroyed: ReturnType<typeof vi.fn>
  isMinimized: ReturnType<typeof vi.fn>
  isVisible: ReturnType<typeof vi.fn>
  restore: ReturnType<typeof vi.fn>
  show: ReturnType<typeof vi.fn>
  focus: ReturnType<typeof vi.fn>
}

function createMockWindow(): MockBrowserWindow {
  const window = new EventEmitter() as MockBrowserWindow
  window.webContents = new EventEmitter() as MockWebContents
  window.webContents.send = vi.fn()
  window.webContents.isDestroyed = vi.fn(() => false)
  window.setTitle = vi.fn()
  window.getBounds = vi.fn(() => ({ x: 0, y: 0, width: 1280, height: 800 }))
  window.setBounds = vi.fn()
  window.isDestroyed = vi.fn(() => false)
  window.isMinimized = vi.fn(() => false)
  window.isVisible = vi.fn(() => false)
  window.restore = vi.fn()
  window.show = vi.fn()
  window.focus = vi.fn()
  return window
}

function getCreatedListener() {
  const call = windowManagerMock.onWindowCreatedByType.mock.calls.at(-1)
  if (!call) throw new Error('onWindowCreatedByType was not registered')
  return (call as unknown as [WindowType, (managed: { id: string; window: MockBrowserWindow }) => void])[1]
}

function getIpcHandleHandler(service: SettingsWindowService, channel: string) {
  const call = (service as any).ipcHandle.mock.calls.find(
    ([registeredChannel]: [string]) => registeredChannel === channel
  )
  if (!call) throw new Error(`ipcHandle handler not registered for channel: ${channel}`)
  return call[1]
}

function mockManagedWindows({
  mainWindow,
  settingsWindow
}: {
  mainWindow: MockBrowserWindow
  settingsWindow?: MockBrowserWindow
}) {
  windowManagerMock.getWindowsByType.mockImplementation((type: string) => {
    if (type === WindowType.Main) return [{ id: 'main-window-id' }]
    if (type === WindowType.Settings && settingsWindow) return [{ id: 'settings-window-id' }]
    return []
  })
  windowManagerMock.getWindow.mockImplementation((id: string) => {
    if (id === 'main-window-id') return mainWindow
    if (id === 'settings-window-id') return settingsWindow
    return undefined
  })
}

describe('SettingsWindowService', () => {
  let service: SettingsWindowService

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.useRealTimers()

    windowManagerMock.open.mockReset().mockReturnValue('settings-window-id')
    windowManagerMock.getWindow.mockReset().mockReturnValue(undefined)
    windowManagerMock.getWindowsByType.mockReset().mockReturnValue([])
    windowManagerMock.getWindowIdByWebContents.mockReset().mockReturnValue(null)
    windowManagerMock.close.mockReset()
    windowManagerMock.onWindowCreatedByType.mockReset().mockReturnValue({ dispose: vi.fn() })
    windowManagerMock.onWindowDestroyedByType.mockReset().mockReturnValue({ dispose: vi.fn() })

    service = new SettingsWindowService()
    await (service as any).onInit()
  })

  it('registers settings IPC and opens the settings window through the service', () => {
    const handler = getIpcHandleHandler(service, IpcChannel.SettingsWindow_Open)
    handler({}, '/settings/about')

    expect(windowManagerMock.open).toHaveBeenCalledWith(
      WindowType.Settings,
      expect.objectContaining({ initData: '/settings/about' })
    )
    expect(windowManagerMock.getWindow).not.toHaveBeenCalled()
  })

  it('tracks lifecycle disposables for window subscriptions and settings window cleanup', () => {
    expect((service as any).registerDisposable).toHaveBeenCalledWith(
      windowManagerMock.onWindowCreatedByType.mock.results[0].value
    )
    expect((service as any).registerDisposable).toHaveBeenCalledWith(expect.any(Function))
  })

  it('normalizes non-settings paths to the provider settings page', () => {
    const handler = getIpcHandleHandler(service, IpcChannel.SettingsWindow_Open)
    handler({}, '/agents')

    expect(windowManagerMock.open).toHaveBeenCalledWith(
      WindowType.Settings,
      expect.objectContaining({ initData: '/settings/provider' })
    )
  })

  it('sizes the settings window to 80% of the main window and centers it', () => {
    const mainWindow = createMockWindow()
    const settingsWindow = createMockWindow()
    // 1440 * 0.8 = 1152, 900 * 0.8 = 720
    // centered: x = 20 + (1440-1152)/2 = 164, y = 40 + (900-720)/2 = 130
    mainWindow.getBounds.mockReturnValue({ x: 20, y: 40, width: 1440, height: 900 })
    mockManagedWindows({ mainWindow, settingsWindow })

    service.open('/settings/about')

    expect(windowManagerMock.open).toHaveBeenCalledWith(
      WindowType.Settings,
      expect.objectContaining({
        options: expect.objectContaining({
          x: 164,
          y: 130,
          width: 1152,
          height: 720
        })
      })
    )
    expect(settingsWindow.setBounds).toHaveBeenCalledWith({ x: 164, y: 130, width: 1152, height: 720 })
  })

  it('clamps small main-window cases to the 760x560 floor and recenters', () => {
    const mainWindow = createMockWindow()
    const settingsWindow = createMockWindow()
    // 900 * 0.8 = 720 < 760 floor → width clamped to 760
    // 600 * 0.8 = 480 < 560 floor → height clamped to 560
    // centered: x = 0 + (900-760)/2 = 70, y = 0 + (600-560)/2 = 20
    mainWindow.getBounds.mockReturnValue({ x: 0, y: 0, width: 900, height: 600 })
    mockManagedWindows({ mainWindow, settingsWindow })

    service.open('/settings/about')

    expect(windowManagerMock.open).toHaveBeenCalledWith(
      WindowType.Settings,
      expect.objectContaining({
        options: expect.objectContaining({
          x: 70,
          y: 20,
          width: 760,
          height: 560
        })
      })
    )
    expect(settingsWindow.setBounds).toHaveBeenCalledWith({ x: 70, y: 20, width: 760, height: 560 })
  })

  it('caps ultra-wide main-window cases to 1280px width and recenters', () => {
    const mainWindow = createMockWindow()
    const settingsWindow = createMockWindow()
    // 2560 * 0.8 = 2048 > 1280 ceiling → width capped to 1280
    // 1400 * 0.8 = 1120, centered at x = 100 + (2560-1280)/2 = 740
    mainWindow.getBounds.mockReturnValue({ x: 100, y: 50, width: 2560, height: 1400 })
    mockManagedWindows({ mainWindow, settingsWindow })

    service.open('/settings/about')

    expect(windowManagerMock.open).toHaveBeenCalledWith(
      WindowType.Settings,
      expect.objectContaining({
        options: expect.objectContaining({
          x: 740,
          y: 190,
          width: 1280,
          height: 1120
        })
      })
    )
    expect(settingsWindow.setBounds).toHaveBeenCalledWith({ x: 740, y: 190, width: 1280, height: 1120 })
  })

  it('keeps the native title empty even when the page title changes', () => {
    const window = createMockWindow()
    const event = { preventDefault: vi.fn() }

    getCreatedListener()({ id: 'settings-window-id', window })
    window.webContents.emit('page-title-updated', event)

    expect(window.setTitle).toHaveBeenCalledWith('')
    expect(event.preventDefault).toHaveBeenCalledOnce()
  })

  it('removes settings window listeners when the window closes', () => {
    const window = createMockWindow()
    const webContents = window.webContents
    const event = { preventDefault: vi.fn() }

    getCreatedListener()({ id: 'settings-window-id', window })
    window.emit('closed')
    webContents.emit('page-title-updated', event)

    expect(event.preventDefault).not.toHaveBeenCalled()
    expect(window.setTitle).toHaveBeenCalledOnce()
  })

  it('does not read BrowserWindow.webContents during closed cleanup', () => {
    const window = createMockWindow()
    const webContents = window.webContents

    getCreatedListener()({ id: 'settings-window-id', window })
    Object.defineProperty(window, 'webContents', {
      configurable: true,
      get: () => {
        throw new TypeError('Object has been destroyed')
      }
    })

    expect(() => window.emit('closed')).not.toThrow()
    webContents.emit('page-title-updated', { preventDefault: vi.fn() })

    expect(window.setTitle).toHaveBeenCalledOnce()
  })

  it('falls back to the default size when no main window is registered', () => {
    const settingsWindow = createMockWindow()
    windowManagerMock.getWindowsByType.mockReturnValue([])
    windowManagerMock.getWindow.mockImplementation((id: string) =>
      id === 'settings-window-id' ? settingsWindow : undefined
    )

    service.open('/settings/about')

    const openCall = windowManagerMock.open.mock.calls.at(-1)
    const passedOptions = (openCall![1] as { options: Record<string, unknown> }).options
    expect(passedOptions).not.toHaveProperty('x')
    expect(passedOptions).not.toHaveProperty('y')
    expect(passedOptions).not.toHaveProperty('width')
    expect(passedOptions).not.toHaveProperty('height')
    expect(settingsWindow.setBounds).not.toHaveBeenCalled()
  })

  it('falls back to the default size when the registered main window is destroyed', () => {
    const mainWindow = createMockWindow()
    const settingsWindow = createMockWindow()
    mainWindow.isDestroyed.mockReturnValue(true)
    mockManagedWindows({ mainWindow, settingsWindow })

    service.open('/settings/about')

    const openCall = windowManagerMock.open.mock.calls.at(-1)
    const passedOptions = (openCall![1] as { options: Record<string, unknown> }).options
    expect(passedOptions).not.toHaveProperty('x')
    expect(passedOptions).not.toHaveProperty('y')
    expect(passedOptions).not.toHaveProperty('width')
    expect(passedOptions).not.toHaveProperty('height')
    expect(settingsWindow.setBounds).not.toHaveBeenCalled()
  })

  it('falls back to the default size when the main window reports non-positive bounds', () => {
    const mainWindow = createMockWindow()
    const settingsWindow = createMockWindow()
    mainWindow.getBounds.mockReturnValue({ x: 0, y: 0, width: 0, height: 0 })
    mockManagedWindows({ mainWindow, settingsWindow })

    service.open('/settings/about')

    const openCall = windowManagerMock.open.mock.calls.at(-1)
    const passedOptions = (openCall![1] as { options: Record<string, unknown> }).options
    expect(passedOptions).not.toHaveProperty('x')
    expect(passedOptions).not.toHaveProperty('y')
    expect(passedOptions).not.toHaveProperty('width')
    expect(passedOptions).not.toHaveProperty('height')
    expect(settingsWindow.setBounds).not.toHaveBeenCalled()
  })

  it('uses platform-specific settings window options', () => {
    expect(createSettingsWindowOptions(true, true)).toEqual({ darkTheme: true })
    expect(createSettingsWindowOptions(true, false)).toEqual({ darkTheme: false })
    expect(createSettingsWindowOptions(false, true)).toEqual({
      darkTheme: true,
      backgroundColor: '#181818'
    })
    expect(createSettingsWindowOptions(false, false)).toEqual({
      darkTheme: false,
      backgroundColor: '#FFFFFF'
    })
  })
})
