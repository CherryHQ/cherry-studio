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
  handleZoomFactorMock
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
    getAllWindows: vi.fn((): Array<{ type: string; window: any }> => [])
  },
  handleZoomFactorMock: vi.fn()
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
  class MockBaseService {}

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

import { MockMainPreferenceServiceUtils } from '@test-mocks/main/PreferenceService'

import { CommandService } from '../CommandService'

describe('CommandService', () => {
  let service: CommandService

  beforeEach(async () => {
    vi.clearAllMocks()
    MockMainPreferenceServiceUtils.resetMocks()
    windowManagerMock.getAllWindows.mockReturnValue([])
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
    const destroyedMainWindow = { isDestroyed: vi.fn(() => true) } as any
    const settingsWindow = { isDestroyed: vi.fn(() => false) } as any
    windowManagerMock.getAllWindows.mockReturnValue([
      { type: 'main', window: mainWindow },
      { type: 'main', window: destroyedMainWindow },
      { type: 'settings', window: settingsWindow }
    ])

    service.execute('app.zoom.reset')

    expect(handleZoomFactorMock).toHaveBeenCalledWith([mainWindow], 0, true)
  })
})
