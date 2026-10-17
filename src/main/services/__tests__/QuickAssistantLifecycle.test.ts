import { EventEmitter } from 'node:events'

import { MockMainPreferenceServiceUtils } from '@test-mocks/main/PreferenceService'
import type { BrowserWindow } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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

afterEach(() => {
  vi.useRealTimers()
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

// Detects retained conversation renderers, late prewarm resurrection, and idle expiry
// destroying a window that has already been opened by the user.
describe('Wayland fresh-window prewarming', () => {
  async function setup() {
    vi.useFakeTimers()
    const wm = application.get('WindowManager')
    let current: { id: string; window: ReturnType<typeof makeWindow> } | null = null
    const created: ReturnType<typeof makeWindow>[] = []
    vi.mocked(wm.getWindow).mockImplementation((id) =>
      current?.id === id ? (current.window as unknown as BrowserWindow) : undefined
    )
    vi.mocked(wm.open).mockImplementation(() => {
      if (!current) {
        const window = makeWindow()
        created.push(window)
        current = { id: `window-${created.length}`, window }
      }
      return current.id
    })
    vi.mocked(wm.close).mockImplementation((id) => {
      if (current?.id !== id) return false
      current = null
      const destroyed = vi.mocked(wm.onWindowDestroyedByType).mock.calls.at(-1)?.[1]
      destroyed?.({ id } as never)
      return true
    })
    const service = new QuickAssistantService()
    await service._doInit()
    await service._doActivate()
    return { service, created }
  }

  it('destroys the used renderer and prepares a fresh hidden window for the next request', async () => {
    const { service, created } = await setup()
    await service.openChat({ prompt: 'private conversation', temporary: true, submit: false })
    created[0].webContents.emit('did-finish-load')
    service.closeQuickAssistant()
    vi.advanceTimersByTime(500)
    expect(created).toHaveLength(2)
    expect(created[1].isVisible()).toBe(false)
    created[1].webContents.isLoading.mockReturnValue(false)
    await service.openChat({ prompt: 'new conversation', temporary: true, submit: false })
    expect(created).toHaveLength(2)
    expect(created[1].isVisible()).toBe(true)
    vi.advanceTimersByTime(5 * 60_000)
    expect(created[1].isVisible()).toBe(true)
    await service._doDeactivate()
  })

  it('releases unused prewarmed windows after five minutes without replenishing them', async () => {
    const { service, created } = await setup()
    service.closeQuickAssistant()
    vi.advanceTimersByTime(500)
    expect(created).toHaveLength(2)
    vi.advanceTimersByTime(5 * 60_000)
    const wm = application.get('WindowManager')
    expect(wm.getWindow('window-2')).toBeUndefined()
    vi.advanceTimersByTime(5 * 60_000)
    expect(created).toHaveLength(2)
    await service._doDeactivate()
  })

  it('does not recreate a window after the feature is disabled during the idle delay', async () => {
    const { service, created } = await setup()
    service.closeQuickAssistant()
    await service._doDeactivate()
    vi.advanceTimersByTime(10 * 60_000)
    expect(created).toHaveLength(1)
  })

  it('cancels pending prewarming when the user reopens immediately', async () => {
    const { service, created } = await setup()
    service.closeQuickAssistant()
    await service.openChat({ prompt: '', temporary: true, submit: false })
    created[1].webContents.emit('did-finish-load')
    vi.advanceTimersByTime(10 * 60_000)
    expect(created).toHaveLength(2)
    expect(created[1].isVisible()).toBe(true)
    await service._doDeactivate()
  })
})
