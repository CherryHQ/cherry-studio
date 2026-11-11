import { MockApplicationUtils } from '@test-mocks/main/application'
import type { BrowserWindow as ElectronBrowserWindow } from 'electron'
import { BrowserWindow } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import { BaseService } from '@main/core/lifecycle/BaseService'

import { ScreenshotChatService } from '../ScreenshotChatService'

describe('ScreenshotChatService', () => {
  const chatWindow = { isDestroyed: () => false } as unknown as ElectronBrowserWindow
  const overlay = { startCapture: vi.fn(async () => undefined) }
  let focused: ElectronBrowserWindow | null
  let svc: ScreenshotChatService

  const wm = () =>
    application.get('WindowManager') as unknown as {
      getWindow: ReturnType<typeof vi.fn>
      getWindowId: ReturnType<typeof vi.fn>
      onWindowReleasedToPool: ReturnType<typeof vi.fn>
    }

  beforeEach(async () => {
    vi.clearAllMocks()
    BaseService.resetInstances()
    MockApplicationUtils.setService('ScreenshotOverlayService', overlay)
    MockApplicationUtils.setService('MediaProtocolService', { store: vi.fn(), getUrl: vi.fn(), remove: vi.fn() })
    focused = chatWindow
    Object.assign(BrowserWindow, { getFocusedWindow: vi.fn(() => focused) })
    wm().getWindow.mockImplementation((id: string) => (id === 'chat' ? chatWindow : undefined))
    wm().getWindowId.mockImplementation((window: unknown) => (window === chatWindow ? 'chat' : undefined))
    svc = new ScreenshotChatService()
    await svc._doInit()
  })

  afterEach(() => {
    MockApplicationUtils.resetServices()
    BaseService.resetInstances()
  })

  it('delivers a capture taken from another app to the chat window that was last in front', async () => {
    svc.setTarget('chat', 'topic-1')
    focused = null

    await svc.startCapture()

    expect(overlay.startCapture).toHaveBeenCalledWith(
      undefined,
      expect.objectContaining({ submit: expect.any(Function) })
    )
  })

  it('stops delivering to a chat window once it is closed back into the pool', async () => {
    svc.setTarget('chat', 'topic-1')
    focused = null
    const onReleased = wm().onWindowReleasedToPool.mock.calls[0]?.[0] as (managed: { id: string }) => void

    onReleased({ id: 'chat' })
    await svc.startCapture()

    expect(overlay.startCapture).toHaveBeenCalledWith(undefined)
  })
})
