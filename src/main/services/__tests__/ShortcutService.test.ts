import { EventEmitter } from 'events'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      debug: vi.fn(),
      error: vi.fn(),
      warn: vi.fn()
    })
  }
}))

vi.mock('@data/PreferenceService', async () => {
  const { MockMainPreferenceServiceExport } = await import('@test-mocks/main/PreferenceService')
  return MockMainPreferenceServiceExport
})

const { windowServiceMock, selectionServiceMock, globalShortcutMock } = vi.hoisted(() => ({
  windowServiceMock: {
    getMainWindow: vi.fn(),
    onMainWindowCreated: vi.fn(),
    showMainWindow: vi.fn(),
    toggleMainWindow: vi.fn(),
    toggleMiniWindow: vi.fn()
  },
  selectionServiceMock: {
    toggleEnabled: vi.fn(),
    processSelectTextByShortcut: vi.fn()
  },
  globalShortcutMock: {
    register: vi.fn(),
    unregister: vi.fn()
  }
}))

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory({
    WindowService: windowServiceMock,
    SelectionService: selectionServiceMock
  } as any)
})

vi.mock('@main/core/lifecycle', () => {
  class MockBaseService {
    protected readonly _disposables: Array<{ dispose: () => void } | (() => void)> = []

    protected registerDisposable<T extends { dispose: () => void } | (() => void)>(disposable: T): T {
      this._disposables.push(disposable)
      return disposable
    }
  }

  return {
    BaseService: MockBaseService,
    Injectable: () => (target: unknown) => target,
    ServicePhase: () => (target: unknown) => target,
    DependsOn: () => (target: unknown) => target,
    Phase: { WhenReady: 'whenReady' }
  }
})

vi.mock('@main/utils/zoom', () => ({
  handleZoomFactor: vi.fn()
}))

vi.mock('electron', () => ({
  globalShortcut: globalShortcutMock
}))

import { handleZoomFactor } from '@main/utils/zoom'
import { IpcChannel } from '@shared/IpcChannel'
import { MockMainPreferenceServiceUtils } from '@test-mocks/main/PreferenceService'

import { ShortcutService } from '../ShortcutService'

const supportsSelectionShortcuts = ['darwin', 'win32'].includes(process.platform)

class MockBrowserWindow {
  private readonly events = new EventEmitter()
  private readonly webContentsEvents = new EventEmitter()
  private destroyed = false
  private focused = true

  public readonly webContents = {
    send: vi.fn(),
    isLoadingMainFrame: vi.fn(() => false),
    once: vi.fn((event: string, callback: (...args: any[]) => void) => {
      this.webContentsEvents.once(event, callback)
    })
  }

  public readonly on = vi.fn((event: string, callback: (...args: any[]) => void) => {
    this.events.on(event, callback)
    return this
  })

  public readonly once = vi.fn((event: string, callback: (...args: any[]) => void) => {
    this.events.once(event, callback)
    return this
  })

  public readonly off = vi.fn((event: string, callback: (...args: any[]) => void) => {
    this.events.off(event, callback)
    return this
  })

  public readonly isDestroyed = vi.fn(() => this.destroyed)
  public readonly isFocused = vi.fn(() => this.focused)
  public readonly isMinimized = vi.fn(() => false)
  public readonly isVisible = vi.fn(() => true)

  public emit(event: string, ...args: any[]) {
    this.events.emit(event, ...args)
  }

  public emitWebContents(event: string, ...args: any[]) {
    this.webContentsEvents.emit(event, ...args)
  }

  public setFocused(value: boolean) {
    this.focused = value
  }

  public destroy() {
    this.destroyed = true
  }
}

describe('ShortcutService', () => {
  let service: ShortcutService
  let mainWindow: MockBrowserWindow

  beforeEach(() => {
    vi.clearAllMocks()
    MockMainPreferenceServiceUtils.resetMocks()

    mainWindow = new MockBrowserWindow()
    windowServiceMock.getMainWindow.mockReturnValue(mainWindow)
    windowServiceMock.onMainWindowCreated.mockImplementation((callback: (window: MockBrowserWindow) => void) => {
      return { dispose: vi.fn(), callback }
    })

    globalShortcutMock.register.mockReturnValue(true)

    service = new ShortcutService()
  })

  it('registers focused window shortcuts including shortcut variants', async () => {
    await (service as any).onInit()

    expect(globalShortcutMock.register).toHaveBeenCalledWith('CommandOrControl+,', expect.any(Function))
    expect(globalShortcutMock.register).toHaveBeenCalledWith('CommandOrControl+=', expect.any(Function))
    expect(globalShortcutMock.register).toHaveBeenCalledWith('CommandOrControl+numadd', expect.any(Function))
  })

  it('re-registers only the changed accelerator when shortcut binding changes', async () => {
    await (service as any).onInit()
    globalShortcutMock.register.mockClear()
    globalShortcutMock.unregister.mockClear()

    MockMainPreferenceServiceUtils.setPreferenceValue('shortcut.general.show_settings', {
      binding: ['Alt', ','],
      enabled: true
    })

    expect(globalShortcutMock.unregister).toHaveBeenCalledWith('CommandOrControl+,')
    expect(globalShortcutMock.register).toHaveBeenCalledWith('Alt+,', expect.any(Function))
    expect(globalShortcutMock.register).not.toHaveBeenCalledWith('CommandOrControl+=', expect.any(Function))
  })

  it('reacts to quick assistant enablement changes for mini window shortcut', async () => {
    MockMainPreferenceServiceUtils.setPreferenceValue('shortcut.feature.quick_assistant.toggle_window', {
      binding: ['CommandOrControl', 'E'],
      enabled: true
    })
    MockMainPreferenceServiceUtils.setPreferenceValue('feature.quick_assistant.enabled', false)

    await (service as any).onInit()

    expect(globalShortcutMock.register).not.toHaveBeenCalledWith('CommandOrControl+E', expect.any(Function))

    globalShortcutMock.register.mockClear()
    MockMainPreferenceServiceUtils.setPreferenceValue('feature.quick_assistant.enabled', true)

    expect(globalShortcutMock.register).toHaveBeenCalledWith('CommandOrControl+E', expect.any(Function))
  })

  it('reacts to selection assistant enablement changes for selection shortcuts', async () => {
    MockMainPreferenceServiceUtils.setPreferenceValue('shortcut.feature.selection.toggle_enabled', {
      binding: ['CommandOrControl', 'Shift', 'S'],
      enabled: true
    })
    MockMainPreferenceServiceUtils.setPreferenceValue('feature.selection.enabled', false)

    await (service as any).onInit()

    expect(globalShortcutMock.register).not.toHaveBeenCalledWith('CommandOrControl+Shift+S', expect.any(Function))

    globalShortcutMock.register.mockClear()
    MockMainPreferenceServiceUtils.setPreferenceValue('feature.selection.enabled', true)

    if (supportsSelectionShortcuts) {
      expect(globalShortcutMock.register).toHaveBeenCalledWith('CommandOrControl+Shift+S', expect.any(Function))
    } else {
      expect(globalShortcutMock.register).not.toHaveBeenCalledWith('CommandOrControl+Shift+S', expect.any(Function))
    }
  })

  it('re-registers window-bound shortcuts when the main window instance changes', async () => {
    await (service as any).onInit()

    const nextWindow = new MockBrowserWindow()
    globalShortcutMock.register.mockClear()
    globalShortcutMock.unregister.mockClear()

    ;(service as any).registerForWindow(nextWindow)

    expect(globalShortcutMock.unregister).toHaveBeenCalledWith('CommandOrControl+=')

    const zoomInRegistration = globalShortcutMock.register.mock.calls.find(
      ([accelerator]) => accelerator === 'CommandOrControl+='
    )
    expect(zoomInRegistration).toBeTruthy()

    const zoomInHandler = zoomInRegistration?.[1] as (() => void) | undefined
    zoomInHandler?.()

    expect(handleZoomFactor).toHaveBeenCalledWith([nextWindow], 0.1)
  })

  it('resets boot registration state when the service stops and starts again', async () => {
    await (service as any).onInit()
    await (service as any).onStop()

    const nextWindow = new MockBrowserWindow()
    windowServiceMock.getMainWindow.mockReturnValue(nextWindow)

    await (service as any).onInit()

    expect(nextWindow.once).toHaveBeenCalledWith('ready-to-show', expect.any(Function))
  })

  it('notifies the renderer when a shortcut cannot be registered', async () => {
    globalShortcutMock.register.mockImplementation((accelerator: string) => accelerator !== 'CommandOrControl+,')

    await (service as any).onInit()

    expect(mainWindow.webContents.send).toHaveBeenCalledWith(IpcChannel.Shortcut_RegistrationConflict, {
      key: 'shortcut.general.show_settings',
      accelerator: 'CommandOrControl+,',
      hasConflict: true
    })
  })

  it('does not notify repeatedly for the same shortcut conflict', async () => {
    globalShortcutMock.register.mockImplementation((accelerator: string) => accelerator !== 'CommandOrControl+,')

    await (service as any).onInit()
    mainWindow.webContents.send.mockClear()

    ;(service as any).reregisterShortcuts()

    expect(mainWindow.webContents.send).not.toHaveBeenCalledWith(
      IpcChannel.Shortcut_RegistrationConflict,
      expect.objectContaining({
        key: 'shortcut.general.show_settings',
        hasConflict: true
      })
    )
  })
})
