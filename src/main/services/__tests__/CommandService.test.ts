import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      error: vi.fn(),
      warn: vi.fn()
    })
  }
}))

vi.mock('@data/PreferenceService', async () => {
  const { MockMainPreferenceServiceExport } = await import('@test-mocks/main/PreferenceService')
  return MockMainPreferenceServiceExport
})

const {
  windowServiceMock,
  settingsWindowServiceMock,
  quickAssistantServiceMock,
  selectionServiceMock,
  windowManagerMock,
  handleZoomFactorMock,
  showNativePopupMenuMock
} = vi.hoisted(() => ({
  windowServiceMock: {
    toggleMainWindow: vi.fn()
  },
  settingsWindowServiceMock: {
    open: vi.fn()
  },
  quickAssistantServiceMock: {
    toggleQuickAssistant: vi.fn()
  },
  selectionServiceMock: {
    toggleEnabled: vi.fn(),
    processSelectTextByShortcut: vi.fn()
  },
  windowManagerMock: {
    getWindowsByType: vi.fn((): any[] => [])
  },
  handleZoomFactorMock: vi.fn(),
  showNativePopupMenuMock: vi.fn()
}))

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory({
    MainWindowService: windowServiceMock,
    SettingsWindowService: settingsWindowServiceMock,
    QuickAssistantService: quickAssistantServiceMock,
    SelectionService: selectionServiceMock,
    WindowManager: windowManagerMock
  } as any)
})

vi.mock('@main/core/lifecycle', () => {
  class MockBaseService {
    protected readonly handlers = new Map<string, (...args: any[]) => unknown>()

    protected ipcHandle(channel: string, handler: (...args: any[]) => unknown) {
      this.handlers.set(channel, handler)
      return { dispose: vi.fn() }
    }
  }

  return {
    BaseService: MockBaseService,
    Injectable: () => (target: unknown) => target,
    ServicePhase: () => (target: unknown) => target,
    Phase: { WhenReady: 'whenReady' },
    toDisposable: (dispose: () => void) => ({ dispose })
  }
})

vi.mock('@main/utils/zoom', () => ({
  handleZoomFactor: handleZoomFactorMock
}))

vi.mock('@main/services/nativePopupMenu', () => ({
  showNativePopupMenu: showNativePopupMenuMock
}))

import { IpcChannel } from '@shared/IpcChannel'
import { MockMainPreferenceServiceUtils } from '@test-mocks/main/PreferenceService'

import { CommandService } from '../CommandService'

describe('CommandService', () => {
  let service: CommandService

  beforeEach(async () => {
    vi.clearAllMocks()
    MockMainPreferenceServiceUtils.resetMocks()
    windowManagerMock.getWindowsByType.mockReturnValue([])
    service = new CommandService()
    await (service as any).onInit()
  })

  it('executes registered application commands', () => {
    service.execute('app.window.show')

    expect(windowServiceMock.toggleMainWindow).toHaveBeenCalledTimes(1)
  })

  it('blocks commands when enablement is not satisfied', () => {
    MockMainPreferenceServiceUtils.setPreferenceValue('feature.quick_assistant.enabled', false)

    expect(service.canExecute('quick_assistant.toggle')).toBe(false)
    service.execute('quick_assistant.toggle')

    expect(quickAssistantServiceMock.toggleQuickAssistant).not.toHaveBeenCalled()
  })

  it('executes enabled feature commands', () => {
    MockMainPreferenceServiceUtils.setPreferenceValue('feature.selection.enabled', true)

    service.execute('selection.capture_text')

    expect(selectionServiceMock.processSelectTextByShortcut).toHaveBeenCalledTimes(1)
  })

  it('passes the target window to zoom commands', () => {
    const window = { isDestroyed: vi.fn(() => false) } as any

    service.execute('app.zoom.in', window)

    expect(handleZoomFactorMock).toHaveBeenCalledWith([window], 0.1)
  })

  it('falls back to all main windows for zoom commands without an explicit target window', () => {
    const mainWindow = { isDestroyed: vi.fn(() => false) } as any
    windowManagerMock.getWindowsByType.mockReturnValue([mainWindow])

    service.execute('app.zoom.reset')

    expect(handleZoomFactorMock).toHaveBeenCalledWith([mainWindow], 0, true)
  })

  describe('native popup menu IPC', () => {
    const getHandler = () => (service as any).handlers.get(IpcChannel.NativeCommandPopupMenu_Show)

    it('registers the native popup menu channel and delegates to showNativePopupMenu', () => {
      const handler = getHandler()
      expect(handler).toBeTypeOf('function')

      const event = { sender: {} } as any
      const model = { location: 'topic.context', items: [] }
      const anchor = { x: 1, y: 2 }
      handler(event, model, anchor)

      expect(showNativePopupMenuMock).toHaveBeenCalledWith(event, model, anchor, expect.any(Function))
    })

    it('executes executable commands in main through the gate callback', () => {
      const window = { isDestroyed: vi.fn(() => false) } as any
      getHandler()({ sender: {} }, {}, undefined)
      const executeCommand = showNativePopupMenuMock.mock.calls.at(-1)?.[3] as (command: any, window?: any) => boolean

      // app.window.show has a registered handler and no enablement gate → executable
      const executed = executeCommand('app.window.show', window)

      expect(executed).toBe(true)
      expect(windowServiceMock.toggleMainWindow).toHaveBeenCalledTimes(1)
    })

    it('does not execute disabled commands and reports them as not handled', () => {
      MockMainPreferenceServiceUtils.setPreferenceValue('feature.quick_assistant.enabled', false)
      getHandler()({ sender: {} }, {}, undefined)
      const executeCommand = showNativePopupMenuMock.mock.calls.at(-1)?.[3] as (command: any, window?: any) => boolean

      const executed = executeCommand('quick_assistant.toggle')

      expect(executed).toBe(false)
      expect(quickAssistantServiceMock.toggleQuickAssistant).not.toHaveBeenCalled()
    })
  })
})
