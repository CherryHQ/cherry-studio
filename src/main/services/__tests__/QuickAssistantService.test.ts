import { defaultServiceInstances } from '@test-mocks/main/application'
import { app, screen } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { platformState } = vi.hoisted(() => ({
  platformState: { isMac: false, isWin: false }
}))

vi.mock('@main/core/platform', () => ({
  get isMac() {
    return platformState.isMac
  },
  get isWin() {
    return platformState.isWin
  }
}))

import { QuickAssistantService } from '../QuickAssistantService'

const appHide = vi.fn()
Object.assign(app, { hide: appHide })
Object.assign(process, { getSystemVersion: vi.fn(() => '15.0') })
Object.assign(screen, {
  getCursorScreenPoint: vi.fn(() => ({ x: 100, y: 100 })),
  getDisplayNearestPoint: vi.fn(() => ({ id: 1, bounds: { x: 0, y: 0, width: 1440, height: 900 } }))
})

beforeEach(() => {
  vi.clearAllMocks()
  platformState.isMac = false
  platformState.isWin = false
})

describe('QuickAssistantService.restoreMainWindow', () => {
  it('shows Main and hides Quick Assistant on non-Windows platforms even when pinned', () => {
    const service = Object.create(QuickAssistantService.prototype) as QuickAssistantService
    const quickWindow = { hide: vi.fn(), minimize: vi.fn(), setOpacity: vi.fn() }

    Object.assign(service, { isPinnedQuickAssistant: true })
    vi.spyOn(
      service as unknown as { getQuickAssistant: () => typeof quickWindow },
      'getQuickAssistant'
    ).mockReturnValue(quickWindow)

    service.restoreMainWindow()

    expect(defaultServiceInstances.MainWindowService.showMainWindow).toHaveBeenCalledTimes(1)
    expect(quickWindow.hide).toHaveBeenCalledTimes(1)
    expect(defaultServiceInstances.MainWindowService.showMainWindow.mock.invocationCallOrder[0]).toBeLessThan(
      quickWindow.hide.mock.invocationCallOrder[0]
    )
  })

  it('uses the flicker-free minimize path when restoring Main on Windows', () => {
    platformState.isWin = true
    const service = Object.create(QuickAssistantService.prototype) as QuickAssistantService
    const quickWindow = { hide: vi.fn(), minimize: vi.fn(), setOpacity: vi.fn() }

    vi.spyOn(
      service as unknown as { getQuickAssistant: () => typeof quickWindow },
      'getQuickAssistant'
    ).mockReturnValue(quickWindow)

    service.restoreMainWindow()

    expect(defaultServiceInstances.MainWindowService.showMainWindow).toHaveBeenCalledTimes(1)
    expect(quickWindow.setOpacity).toHaveBeenCalledWith(0)
    expect(quickWindow.minimize).toHaveBeenCalledTimes(1)
    expect(quickWindow.hide).not.toHaveBeenCalled()
  })

  it('restores an opaque Quick Assistant after dismissing it for Main on Windows', () => {
    platformState.isWin = true
    let minimized = false
    const service = Object.create(QuickAssistantService.prototype) as QuickAssistantService
    const quickWindow = {
      getBounds: vi.fn(() => ({ x: 0, y: 0, width: 600, height: 400 })),
      hide: vi.fn(),
      isMinimized: vi.fn(() => minimized),
      minimize: vi.fn(() => {
        minimized = true
      }),
      setBounds: vi.fn(),
      setOpacity: vi.fn(),
      setPosition: vi.fn(),
      show: vi.fn(() => {
        minimized = false
      })
    }

    Object.defineProperty(service, 'isActivated', { value: true })
    vi.spyOn(
      service as unknown as { getQuickAssistant: () => typeof quickWindow },
      'getQuickAssistant'
    ).mockReturnValue(quickWindow)

    service.restoreMainWindow()
    service.showQuickAssistant()

    expect(quickWindow.setOpacity).toHaveBeenLastCalledWith(1)
    expect(quickWindow.show).toHaveBeenCalled()
  })

  it('does not hide the app when an unpinned Quick Assistant blurs while restoring Main on macOS', () => {
    platformState.isMac = true
    const service = Object.create(QuickAssistantService.prototype) as QuickAssistantService
    const quickWindow = { hide: vi.fn(), minimize: vi.fn(), setOpacity: vi.fn() }

    Object.assign(service, { isPinnedQuickAssistant: false, wasMainWindowFocused: false })
    vi.spyOn(
      service as unknown as { getQuickAssistant: () => typeof quickWindow },
      'getQuickAssistant'
    ).mockReturnValue(quickWindow)
    defaultServiceInstances.MainWindowService.showMainWindow.mockImplementationOnce(() => {
      service.hideQuickAssistant()
    })

    service.restoreMainWindow()

    expect(defaultServiceInstances.MainWindowService.showMainWindow).toHaveBeenCalledTimes(1)
    expect(appHide).not.toHaveBeenCalled()
  })
})
