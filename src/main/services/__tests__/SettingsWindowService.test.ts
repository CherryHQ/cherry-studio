import { EventEmitter } from 'events'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { applicationMock, loggerMock, mainWindowServiceMock, preferenceServiceMock, windowManagerMock } = vi.hoisted(
  () => {
    const windowManagerMock = {
      open: vi.fn<(type: string, args?: { initData?: unknown; options?: unknown }) => string>(
        () => 'settings-window-id'
      ),
      getWindow: vi.fn<(id: string) => unknown>(() => undefined),
      getWindowsByType: vi.fn<(type: string) => unknown[]>(() => []),
      getWindowIdByWebContents: vi.fn<(sender: unknown) => string | null>(() => null),
      close: vi.fn<(id: string) => void>(),
      onWindowCreatedByType: vi.fn(() => ({ dispose: vi.fn() })),
      onWindowDestroyedByType: vi.fn(() => ({ dispose: vi.fn() }))
    }
    const mainWindowServiceMock = {
      showMainWindow: vi.fn()
    }
    const preferenceServiceMock = {
      get: vi.fn(() => 'window')
    }
    const loggerMock = {
      error: vi.fn()
    }
    const applicationMock = {
      get: vi.fn((name: string) => {
        if (name === 'WindowManager') return windowManagerMock
        if (name === 'MainWindowService') return mainWindowServiceMock
        if (name === 'PreferenceService') return preferenceServiceMock
        throw new Error(`unexpected service: ${name}`)
      })
    }
    return { applicationMock, loggerMock, mainWindowServiceMock, preferenceServiceMock, windowManagerMock }
  }
)

vi.mock('@application', () => ({ application: applicationMock }))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => loggerMock
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

function getDestroyedListener() {
  const call = windowManagerMock.onWindowDestroyedByType.mock.calls.at(-1)
  if (!call) throw new Error('onWindowDestroyedByType was not registered')
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
  windowManagerMock.getWindowIdByWebContents.mockImplementation((sender: unknown) => {
    if (sender === mainWindow.webContents) return 'main-window-id'
    if (settingsWindow && sender === settingsWindow.webContents) return 'settings-window-id'
    return null
  })
}

function markMainWindowReady(service: SettingsWindowService, mainWindow: MockBrowserWindow) {
  const readyHandler = getIpcHandleHandler(service, IpcChannel.Tab_AttachReady)
  return readyHandler({ sender: mainWindow.webContents })
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
    mainWindowServiceMock.showMainWindow.mockReset()
    preferenceServiceMock.get.mockReset().mockReturnValue('window')
    loggerMock.error.mockReset()

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
    expect((service as any).registerDisposable).toHaveBeenCalledWith(
      windowManagerMock.onWindowDestroyedByType.mock.results[0].value
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

  it('opens settings according to the configured window target', () => {
    preferenceServiceMock.get.mockReturnValue('window')

    service.openUsingPreference('/settings/about')

    expect(windowManagerMock.open).toHaveBeenCalledWith(
      WindowType.Settings,
      expect.objectContaining({ initData: '/settings/about' })
    )
  })

  it('opens settings in the main app according to the configured app target', () => {
    const mainWindow = createMockWindow()
    mockManagedWindows({ mainWindow })
    markMainWindowReady(service, mainWindow)
    preferenceServiceMock.get.mockReturnValue('app')

    service.openUsingPreference('/settings/about')

    expect(mainWindowServiceMock.showMainWindow).toHaveBeenCalledOnce()
    expect(mainWindow.webContents.send).toHaveBeenCalledWith(
      IpcChannel.Tab_Attach,
      expect.objectContaining({
        id: 'settings:/settings/about',
        url: '/settings/about'
      })
    )
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

  it('queues in-app settings tabs until the main window registers its tab attach listener', () => {
    const mainWindow = createMockWindow()
    mockManagedWindows({ mainWindow })

    const openInAppHandler = getIpcHandleHandler(service, IpcChannel.SettingsWindow_OpenInApp)
    openInAppHandler({ sender: createMockWindow().webContents }, '/settings/about')

    expect(mainWindowServiceMock.showMainWindow).toHaveBeenCalledOnce()
    expect(mainWindow.webContents.send).not.toHaveBeenCalled()

    expect(markMainWindowReady(service, mainWindow)).toBe(true)

    expect(mainWindow.webContents.send).toHaveBeenCalledWith(
      IpcChannel.Tab_Attach,
      expect.objectContaining({
        id: 'settings:/settings/about',
        url: '/settings/about'
      })
    )
  })

  it('sends in-app settings tabs immediately after the main window is ready', () => {
    const mainWindow = createMockWindow()
    mockManagedWindows({ mainWindow })
    markMainWindowReady(service, mainWindow)

    const openInAppHandler = getIpcHandleHandler(service, IpcChannel.SettingsWindow_OpenInApp)
    openInAppHandler({ sender: createMockWindow().webContents }, '/settings/display')

    expect(mainWindow.webContents.send).toHaveBeenCalledWith(
      IpcChannel.Tab_Attach,
      expect.objectContaining({
        id: 'settings:/settings/display',
        url: '/settings/display'
      })
    )
  })

  it('closes the settings sender after opening settings in the main app', () => {
    const mainWindow = createMockWindow()
    const settingsWindow = createMockWindow()
    mockManagedWindows({ mainWindow, settingsWindow })
    markMainWindowReady(service, mainWindow)

    const openInAppHandler = getIpcHandleHandler(service, IpcChannel.SettingsWindow_OpenInApp)
    openInAppHandler({ sender: settingsWindow.webContents }, '/settings/provider')

    expect(windowManagerMock.close).toHaveBeenCalledWith('settings-window-id')
  })

  it('uses platform-specific settings window options', () => {
    expect(createSettingsWindowOptions(true, true)).toMatchObject({
      darkTheme: true,
      titleBarOverlay: expect.objectContaining({ symbolColor: '#fff' })
    })
    expect(createSettingsWindowOptions(true, false)).toMatchObject({
      darkTheme: false,
      titleBarOverlay: expect.objectContaining({ symbolColor: '#000' })
    })
    expect(createSettingsWindowOptions(false, true)).toEqual({
      darkTheme: true,
      backgroundColor: '#181818'
    })
    expect(createSettingsWindowOptions(false, false)).toEqual({
      darkTheme: false,
      backgroundColor: '#FFFFFF'
    })
  })

  it('drops pending settings tabs when the main window is destroyed before it is ready', () => {
    const mainWindow = createMockWindow()
    mockManagedWindows({ mainWindow })

    const openInAppHandler = getIpcHandleHandler(service, IpcChannel.SettingsWindow_OpenInApp)
    openInAppHandler({ sender: createMockWindow().webContents }, '/settings/about')
    getDestroyedListener()({ id: 'main-window-id', window: mainWindow })

    markMainWindowReady(service, mainWindow)

    expect(mainWindow.webContents.send).not.toHaveBeenCalled()
  })
})
