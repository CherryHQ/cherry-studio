import { WindowType } from '@main/core/window/types'
import { IpcChannel } from '@shared/IpcChannel'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { applicationMock, mainWindowServiceMock, windowManagerMock, notificationInstances } = vi.hoisted(() => {
  const mainWindowServiceMock = { showMainWindow: vi.fn() }
  const windowManagerMock = { broadcastToType: vi.fn() }
  const applicationMock = {
    get: vi.fn((name: string) => {
      if (name === 'MainWindowService') return mainWindowServiceMock
      if (name === 'WindowManager') return windowManagerMock
      throw new Error(`unexpected service: ${name}`)
    })
  }
  const notificationInstances: Array<{
    options: { title: string; body: string }
    show: ReturnType<typeof vi.fn>
    fireClick: () => void
  }> = []
  return { applicationMock, mainWindowServiceMock, windowManagerMock, notificationInstances }
})

vi.mock('@application', () => ({ application: applicationMock }))

vi.mock('electron', () => ({
  Notification: class {
    options: { title: string; body: string }
    show = vi.fn()
    private clickListener: (() => void) | null = null

    constructor(options: { title: string; body: string }) {
      this.options = options
      notificationInstances.push({
        options,
        show: this.show,
        fireClick: () => this.clickListener?.()
      })
    }

    on(event: string, cb: () => void) {
      if (event === 'click') this.clickListener = cb
      return this
    }
  }
}))

// Bypass real BaseService ipc internals — capture ipcHandle registrations instead.
vi.mock('@main/core/lifecycle', async () => {
  const actual = (await vi.importActual('@main/core/lifecycle')) as Record<string, unknown>
  class StubBase {
    ipcHandle = vi.fn()
    ipcOn = vi.fn()
    registerDisposable = <T>(d: T) => d
  }
  return { ...actual, BaseService: StubBase }
})

import { NotificationService } from '../NotificationService'

describe('NotificationService', () => {
  let svc: NotificationService

  beforeEach(() => {
    notificationInstances.length = 0
    svc = new NotificationService()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('registers the Notification_Send IPC handler on init', async () => {
    await (svc as any).onInit()

    const ipcHandle = (svc as any).ipcHandle as ReturnType<typeof vi.fn>
    expect(ipcHandle).toHaveBeenCalledWith(IpcChannel.Notification_Send, expect.any(Function))
  })

  it('delegates the Notification_Send handler to sendNotification', async () => {
    await (svc as any).onInit()
    const ipcHandle = (svc as any).ipcHandle as ReturnType<typeof vi.fn>
    const handler = ipcHandle.mock.calls.find(([channel]) => channel === IpcChannel.Notification_Send)![1]

    await handler({}, { title: 'T', message: 'M' })

    expect(notificationInstances).toHaveLength(1)
    expect(notificationInstances[0].options).toEqual({ title: 'T', body: 'M' })
  })

  it('shows an Electron notification with the given title and body', async () => {
    await svc.sendNotification({ title: 'Hello', message: 'World' } as any)

    expect(notificationInstances).toHaveLength(1)
    expect(notificationInstances[0].options).toEqual({ title: 'Hello', body: 'World' })
    expect(notificationInstances[0].show).toHaveBeenCalledTimes(1)
  })

  it('on click, focuses the main window and broadcasts notification-click to Main windows', async () => {
    const notification = { title: 'Hi', message: 'there' }
    await svc.sendNotification(notification as any)

    notificationInstances[0].fireClick()

    expect(mainWindowServiceMock.showMainWindow).toHaveBeenCalledTimes(1)
    expect(windowManagerMock.broadcastToType).toHaveBeenCalledWith(WindowType.Main, 'notification-click', notification)
  })
})
