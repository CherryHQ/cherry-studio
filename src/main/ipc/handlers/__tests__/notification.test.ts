import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { Notification } from '@shared/types/notification'

const sendMock = vi.hoisted(() => vi.fn())
vi.mock('@application', () => ({
  application: { get: () => ({ sendNotification: sendMock }) }
}))

import { notificationHandlers } from '../notification'

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
  it('delegates system notification delivery to NotificationService', async () => {
    await notificationHandlers['notification.send'](notification, { senderId: 'w1' })
    expect(sendMock).toHaveBeenCalledWith(notification)
  })
})
