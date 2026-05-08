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

  it('opens the standalone settings window over the current main window bounds', () => {
    const mainWindow = createMockWindow()
    const settingsWindow = createMockWindow()
    mainWindow.getBounds.mockReturnValue({ x: 20, y: 40, width: 1440, height: 900 })
    mockManagedWindows({ mainWindow, settingsWindow })

    service.open('/settings/about')

    expect(windowManagerMock.open).toHaveBeenCalledWith(
      WindowType.Settings,
      expect.objectContaining({
        options: expect.objectContaining({
          x: 20,
          y: 40,
          width: 1440,
          height: 900
        })
      })
    )
    expect(settingsWindow.setBounds).toHaveBeenCalledWith({ x: 20, y: 40, width: 1440, height: 900 })
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
