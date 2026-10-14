import { EventEmitter } from 'node:events'

import type { BrowserWindow } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import { BaseService } from '@main/core/lifecycle/BaseService'
import type { ManagedWindow } from '@main/core/window/types'
import { WindowType } from '@main/core/window/types'

import { SelectionService } from '../SelectionService'

vi.mock('@application', async () => {
  const { defaultServiceInstances, mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory({
    WindowManager: { ...defaultServiceInstances.WindowManager, getInitData: vi.fn() }
  })
})

vi.mock('@main/core/platform', () => ({ isDev: false, isMac: false, isWin: false, isLinux: true }))

describe('Selection action playback lifetime', () => {
  let service: SelectionService
  const wm = application.get('WindowManager')
  const send = vi.mocked(application.get('IpcApiService').send)

  beforeEach(async () => {
    vi.clearAllMocks()
    BaseService.resetInstances()
    service = new SelectionService()
    await service._doInit()
  })

  afterEach(async () => {
    await service._doDestroy()
    BaseService.resetInstances()
  })

  function createActionWindow(id: string) {
    const window = new EventEmitter()
    const callback = vi
      .mocked(wm.onWindowCreatedByType)
      .mock.calls.find(([type]) => type === WindowType.SelectionAction)![1]
    callback({ id, window: window as BrowserWindow } as ManagedWindow)
    return window
  }

  it('dismisses the current launch on hide and releases listeners when the window closes', () => {
    const window = createActionWindow('pooled-action')
    vi.mocked(wm.getInitData).mockReturnValue({ sessionId: 'launch-1' })
    window.emit('hide')
    expect(send).toHaveBeenLastCalledWith('pooled-action', 'selection.action_dismissed', { sessionId: 'launch-1' })

    vi.mocked(wm.getInitData).mockReturnValue({ sessionId: 'launch-2' })
    window.emit('hide')
    expect(send).toHaveBeenLastCalledWith('pooled-action', 'selection.action_dismissed', { sessionId: 'launch-2' })

    window.emit('closed')
    window.emit('hide')
    expect(send).toHaveBeenCalledTimes(2)
    expect(window.listenerCount('hide')).toBe(0)
  })

  it('releases remaining window listeners when the owning service stops', async () => {
    const window = createActionWindow('pooled-action')
    vi.mocked(wm.getInitData).mockReturnValue({ sessionId: 'launch-1' })

    await service._doStop()
    window.emit('hide')

    expect(send).not.toHaveBeenCalled()
    expect(window.listenerCount('hide')).toBe(0)
    expect(window.listenerCount('closed')).toBe(0)
  })
})
