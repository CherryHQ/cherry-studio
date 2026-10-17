import { EventEmitter } from 'node:events'

import { MockMainPreferenceServiceUtils } from '@test-mocks/main/PreferenceService'
import type { BrowserWindow } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import { BaseService } from '@main/core/lifecycle'

import { QuickAssistantService } from '../QuickAssistantService'

vi.mock('@main/core/platform', () => ({ isLinuxWayland: true, isMac: false, isWin: false }))

function makeWindow() {
  let visible = false
  return Object.assign(new EventEmitter(), {
    isDestroyed: () => false,
    isMinimized: () => false,
    isVisible: () => visible,
    setOpacity: vi.fn(),
    show: vi.fn(() => {
      visible = true
    }),
    focus: vi.fn(),
    webContents: Object.assign(new EventEmitter(), {
      isLoading: vi.fn(() => true),
      setWindowOpenHandler: vi.fn()
    })
  })
}

beforeEach(() => {
  vi.restoreAllMocks()
  BaseService.resetInstances()
  MockMainPreferenceServiceUtils.resetMocks()
})

describe('quick window lifecycle', () => {
  it('does not reopen after being dismissed before the renderer finishes loading', async () => {
    const service = new QuickAssistantService()
    vi.spyOn(service, 'activate').mockResolvedValue(true)
    const window = makeWindow()
    const wm = application.get('WindowManager')
    vi.mocked(wm.open).mockReturnValue('quick-window')
    vi.mocked(wm.getWindow).mockReturnValue(window as unknown as BrowserWindow)

    await service.openChat({ prompt: '', temporary: true, submit: false })
    service.toggleQuickAssistant()
    // A subsequent request must not be shown by the old renderer's load callback.
    const replacement = makeWindow()
    vi.mocked(wm.getWindow).mockReturnValue(replacement as unknown as BrowserWindow)
    await service.openChat({ prompt: 'replacement', temporary: true, submit: false })
    window.webContents.emit('did-finish-load')
    expect(replacement.isVisible()).toBe(false)
    replacement.webContents.emit('did-finish-load')
    expect(replacement.isVisible()).toBe(true)
    expect(replacement.focus).toHaveBeenCalledOnce()
  })

  it('lets the shortcut reopen a window destroyed by the desktop', async () => {
    const service = new QuickAssistantService()
    // Exercise normal activation, including the WindowManager lifecycle subscription.
    MockMainPreferenceServiceUtils.setPreferenceValue('feature.quick_assistant.enabled', true)
    await service._doInit()
    const wm = application.get('WindowManager')
    const firstId = vi.mocked(wm.open).mock.results.at(-1)!.value
    const destroyed = vi.mocked(wm.onWindowDestroyedByType).mock.calls.at(-1)?.[1]
    destroyed?.({ id: firstId } as never)
    vi.mocked(wm.getWindow).mockReturnValue(undefined)
    const window = makeWindow()
    vi.mocked(wm.open).mockImplementation(() => {
      vi.mocked(wm.getWindow).mockReturnValue(window as unknown as BrowserWindow)
      return 'reopened-window'
    })
    service.toggleQuickAssistant()
    window.webContents.emit('did-finish-load')
    expect(window.isVisible()).toBe(true)
    expect(window.focus).toHaveBeenCalledOnce()
  })
})
