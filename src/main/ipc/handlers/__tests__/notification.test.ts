import type { Notification } from '@shared/types/notification'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { focusTaskTargetMock, sendMock, syncTaskTargetsMock } = vi.hoisted(() => ({
  focusTaskTargetMock: vi.fn(),
  sendMock: vi.fn(),
  syncTaskTargetsMock: vi.fn()
}))
vi.mock('@application', () => ({
  application: {
    get: () => ({
      focusTaskTarget: focusTaskTargetMock,
      sendNotification: sendMock,
      syncTaskTargets: syncTaskTargetsMock
    })
  }
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

  it('syncs task targets against the calling window', async () => {
    const targets = [{ conversationType: 'assistant' as const, conversationId: 'topic-1' }]
    await notificationHandlers['notification.sync_task_targets']({ targets }, ctx)
    expect(syncTaskTargetsMock).toHaveBeenCalledWith('w1', targets)
  })

  it('delegates cross-window target focus with the calling window excluded', async () => {
    const target = { conversationType: 'agent' as const, conversationId: 'session-1' }
    focusTaskTargetMock.mockReturnValue(true)

    await expect(notificationHandlers['notification.focus_task_target'](target, ctx)).resolves.toBe(true)
    expect(focusTaskTargetMock).toHaveBeenCalledWith(target, 'w1')
  })
})
