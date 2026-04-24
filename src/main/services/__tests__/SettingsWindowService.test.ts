import { EventEmitter } from 'events'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { applicationMock, windowManagerMock, loggerMock } = vi.hoisted(() => {
  const windowManagerMock = {
    open: vi.fn<(type: string, args?: { initData?: unknown }) => string>(() => 'settings-window-id'),
    getWindow: vi.fn<(id: string) => unknown>(() => undefined),
    getWindowsByType: vi.fn<(type: string) => unknown[]>(() => []),
    onWindowCreatedByType: vi.fn(() => ({ dispose: vi.fn() }))
  }
  const applicationMock = {
    get: vi.fn((name: string) => {
      if (name === 'WindowManager') return windowManagerMock
      throw new Error(`unexpected service: ${name}`)
    })
  }
  const loggerMock = {
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    debug: vi.fn()
  }
  return { applicationMock, windowManagerMock, loggerMock }
})

vi.mock('@application', () => ({ application: applicationMock }))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => loggerMock
  }
}))

vi.mock('@main/core/lifecycle', async () => {
  const actual = (await vi.importActual('@main/core/lifecycle')) as Record<string, unknown>
  class StubBase {
    protected ipcHandle = vi.fn()
    protected registerDisposable = <T>(disposable: T) => disposable
  }
  return { ...actual, BaseService: StubBase }
})

import { WindowType } from '@main/core/window/types'
import { IpcChannel } from '@shared/IpcChannel'

import { SettingsWindowService } from '../SettingsWindowService'

interface MockBrowserWindow extends EventEmitter {
  webContents: EventEmitter
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
  window.webContents = new EventEmitter()
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

function getIpcHandleHandler(service: SettingsWindowService, channel: string) {
  const call = (service as any).ipcHandle.mock.calls.find(
    ([registeredChannel]: [string]) => registeredChannel === channel
  )
  if (!call) throw new Error(`ipcHandle handler not registered for channel: ${channel}`)
  return call[1]
}

describe('SettingsWindowService', () => {
  let service: SettingsWindowService

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.useRealTimers()

    windowManagerMock.open.mockReset().mockReturnValue('settings-window-id')
    windowManagerMock.getWindow.mockReset().mockReturnValue(undefined)
    windowManagerMock.getWindowsByType.mockReset().mockReturnValue([])
    windowManagerMock.onWindowCreatedByType.mockReset().mockReturnValue({ dispose: vi.fn() })

    service = new SettingsWindowService()
    await (service as any).onInit()
  })

  it('registers settings IPC and opens the settings window through the service', () => {
    const handler = getIpcHandleHandler(service, IpcChannel.SettingsWindow_Open)
    handler({}, '/settings/about')

    expect(windowManagerMock.open).toHaveBeenCalledWith(WindowType.Settings, { initData: '/settings/about' })
  })

  it('normalizes non-settings paths to the provider settings page', () => {
    service.open('/agents')

    expect(windowManagerMock.open).toHaveBeenCalledWith(WindowType.Settings, { initData: '/settings/provider' })
  })

  it('shows and focuses a ready settings window immediately', () => {
    const window = createMockWindow()
    getCreatedListener()({ id: 'settings-window-id', window })
    window.emit('ready-to-show')
    windowManagerMock.getWindow.mockReturnValue(window)

    service.open('/settings/about')

    expect(window.show).toHaveBeenCalledOnce()
    expect(window.focus).toHaveBeenCalledOnce()
  })

  it('waits for ready-to-show before showing a cold settings window', () => {
    const window = createMockWindow()
    getCreatedListener()({ id: 'settings-window-id', window })
    windowManagerMock.getWindow.mockReturnValue(window)

    service.open('/settings/about')
    expect(window.show).not.toHaveBeenCalled()

    window.emit('ready-to-show')

    expect(window.show).toHaveBeenCalledOnce()
    expect(window.focus).toHaveBeenCalledOnce()
  })

  it('prewarms a hidden settings window without showing it', () => {
    const id = service.prewarm()

    expect(id).toBe('settings-window-id')
    expect(windowManagerMock.open).toHaveBeenCalledWith(WindowType.Settings, { initData: '/settings/provider' })
    expect(windowManagerMock.getWindow).not.toHaveBeenCalled()
  })

  it('skips prewarm when a settings window already exists', () => {
    windowManagerMock.getWindowsByType.mockReturnValue([{ id: 'existing-settings-window' }])

    const id = service.prewarm()

    expect(id).toBeNull()
    expect(windowManagerMock.open).not.toHaveBeenCalled()
  })

  it('keeps the native title empty even when the page title changes', () => {
    const window = createMockWindow()
    const event = { preventDefault: vi.fn() }

    getCreatedListener()({ id: 'settings-window-id', window })
    window.webContents.emit('page-title-updated', event)

    expect(window.setTitle).toHaveBeenCalledWith('')
    expect(event.preventDefault).toHaveBeenCalledOnce()
  })

  it('schedules best-effort prewarm after all services are ready', () => {
    vi.useFakeTimers()
    const prewarmSpy = vi.spyOn(service, 'prewarm')

    ;(service as any).onAllReady()
    vi.advanceTimersByTime(1000)

    expect(prewarmSpy).toHaveBeenCalledOnce()
    vi.useRealTimers()
  })
})
