import { setupTestDatabase } from '@test-helpers/db'
import { describe, expect, it } from 'vitest'

import { notificationRecordService } from '../NotificationRecordService'

const create = (eventKey: string) =>
  notificationRecordService.create({
    eventKey,
    category: 'system',
    kind: 'backup-success',
    title: eventKey,
    message: eventKey,
    createdAt: Date.now()
  })!

describe('NotificationRecordService.dismissRead', () => {
  setupTestDatabase()

  it('removes read notifications from the list and keeps unread ones', () => {
    const read = create('read')
    const unread = create('unread')
    notificationRecordService.markRead(read.id)

    notificationRecordService.dismissRead()

    expect(notificationRecordService.list({}).items.map((record) => record.id)).toEqual([unread.id])
    expect(notificationRecordService.unreadCount()).toBe(1)
    expect(notificationRecordService.getById(read.id)).toBeNull()
  })
})
