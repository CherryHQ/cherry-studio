import type { Notification } from '@shared/types/notification'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { sendMock } = vi.hoisted(() => ({ sendMock: vi.fn() }))
vi.mock('@main/services/NotificationService', () => ({
  default: vi.fn(() => ({ sendNotification: sendMock }))
}))

import { notificationHandlers } from '../notification'

const ctx = { senderId: 'w1' }

const notification: Notification = {
  id: '1',
  type: 'info',
  title: 'Title',
  message: 'Message',
  timestamp: 0,
  source: 'assistant'
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('notificationHandlers', () => {
  it('send delegates the notification to NotificationService.sendNotification', async () => {
    await notificationHandlers['notification.send'](notification, ctx)
    expect(sendMock).toHaveBeenCalledWith(notification)
  })
})
