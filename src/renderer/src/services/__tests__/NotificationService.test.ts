import type { Notification } from '@renderer/types/notification'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const queueAdd = vi.fn()

vi.mock('../../queue/NotificationQueue', () => ({
  NotificationQueue: {
    getInstance: () => ({
      add: queueAdd,
      clear: vi.fn(),
      pending: 0,
      size: 0
    })
  }
}))

vi.mock('@renderer/store', () => ({
  default: {
    getState: vi.fn()
  }
}))

vi.mock('@renderer/store/settings', () => ({
  initialState: {
    notification: { assistant: false, backup: false, knowledge: false, sound: false }
  }
}))

const mockIpcOn = vi.fn()
;(global as any).window = {
  ...(global as any).window,
  electron: { ipcRenderer: { on: mockIpcOn } }
}

import store from '@renderer/store'

import { NotificationService } from '../NotificationService'

const mockGetState = vi.mocked(store.getState)

function makeNotification(overrides: Partial<Notification> = {}): Notification {
  return {
    id: 'n1',
    type: 'success',
    title: 'done',
    message: 'hello',
    timestamp: 1,
    source: 'assistant',
    ...overrides
  }
}

function setNotificationSettings(settings: Partial<{ assistant: boolean; sound: boolean }>) {
  mockGetState.mockReturnValue({
    settings: {
      notification: { assistant: false, backup: false, knowledge: false, sound: false, ...settings }
    }
  } as any)
}

describe('NotificationService.send', () => {
  beforeEach(() => {
    queueAdd.mockClear()
    mockGetState.mockReset()
  })

  it('drops the notification when its source toggle is off', async () => {
    setNotificationSettings({ assistant: false })
    await NotificationService.getInstance().send(makeNotification())
    expect(queueAdd).not.toHaveBeenCalled()
  })

  it('queues silently when source is enabled and sound is off', async () => {
    setNotificationSettings({ assistant: true, sound: false })
    await NotificationService.getInstance().send(makeNotification())
    expect(queueAdd).toHaveBeenCalledTimes(1)
    expect(queueAdd.mock.calls[0][0]).toMatchObject({ source: 'assistant', silent: true })
  })

  it('queues with sound when both source and sound toggles are on', async () => {
    setNotificationSettings({ assistant: true, sound: true })
    await NotificationService.getInstance().send(makeNotification())
    expect(queueAdd).toHaveBeenCalledTimes(1)
    expect(queueAdd.mock.calls[0][0]).toMatchObject({ silent: false })
  })

  it('preserves an explicit silent flag from the caller', async () => {
    setNotificationSettings({ assistant: true, sound: true })
    await NotificationService.getInstance().send(makeNotification({ silent: true }))
    expect(queueAdd.mock.calls[0][0].silent).toBe(true)
  })

  it('falls back to default settings when the slice is missing', async () => {
    mockGetState.mockReturnValue({ settings: {} } as any)
    await NotificationService.getInstance().send(makeNotification())
    expect(queueAdd).not.toHaveBeenCalled()
  })
})
