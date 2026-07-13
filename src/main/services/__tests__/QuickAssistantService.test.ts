import { defaultServiceInstances } from '@test-mocks/main/application'
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
})
