import { MockApplicationUtils } from '@test-mocks/main/application'
import { screen } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import { BaseService } from '@main/core/lifecycle/BaseService'

import { QuickAssistantService } from '../QuickAssistantService'

describe('QuickAssistantService open analytics', () => {
  const quickWindow = {
    isDestroyed: () => false,
    isVisible: vi.fn(() => false),
    isMinimized: () => false,
    getBounds: () => ({ x: 0, y: 0, width: 400, height: 300 }),
    setOpacity: vi.fn(),
    show: vi.fn(),
    hide: vi.fn()
  }
  const opened = () =>
    vi
      .mocked(application.get('AnalyticsService').trackProductEvent)
      .mock.calls.map(([event]) => event)
      .filter((event) => 'feature' in event && event.feature === 'quick_assistant')

  function createService(activated: boolean): QuickAssistantService {
    const service = new QuickAssistantService()
    Object.assign(service, { _activated: activated, windowId: 'quick' })
    return service
  }

  beforeEach(() => {
    BaseService.resetInstances()
    vi.mocked(application.get('AnalyticsService').trackProductEvent).mockClear()
    MockApplicationUtils.setService('WindowManager', { getWindow: () => quickWindow })
    Object.assign(screen, {
      getCursorScreenPoint: () => ({ x: 0, y: 0 }),
      getDisplayNearestPoint: () => ({ id: 1, bounds: { x: 0, y: 0, width: 1440, height: 900 } })
    })
    quickWindow.isVisible.mockReturnValue(false)
  })

  afterEach(() => {
    MockApplicationUtils.resetServices()
    BaseService.resetInstances()
  })

  it('reports each show with the entry point that opened it', () => {
    const service = createService(true)

    service.toggleQuickAssistant('shortcut')
    service.showQuickAssistant('tray')
    service.showQuickAssistant('menu')

    expect(opened()).toEqual(
      ['shortcut', 'tray', 'menu'].map((trigger) => ({
        event: 'feature_used',
        feature: 'quick_assistant',
        action: 'opened',
        trigger
      }))
    )
  })

  it('stays silent when the shortcut hides the window or the feature is off', () => {
    quickWindow.isVisible.mockReturnValue(true)
    const visible = createService(true)
    const hide = vi.spyOn(visible, 'hideQuickAssistant').mockImplementation(() => {})
    visible.toggleQuickAssistant('shortcut')
    expect(hide).toHaveBeenCalledOnce()
    quickWindow.isVisible.mockReturnValue(false)
    Object.assign(visible, { _activated: false })
    visible.showQuickAssistant('tray')

    expect(opened()).toEqual([])
  })
})
