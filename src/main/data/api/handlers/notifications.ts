import * as z from 'zod'

import { notificationRecordService } from '@data/services/NotificationRecordService'
import { DataApiErrorFactory } from '@shared/data/api/errors'
import {
  ReadConversationNotificationsSchema,
  ReadNotificationSchema,
  type NotificationSchemas
} from '@shared/data/api/schemas/notifications'
import type { HandlersFor } from '@shared/data/api/types'

export const notificationHandlers: HandlersFor<NotificationSchemas> = {
  '/notifications': { GET: async ({ query }) => notificationRecordService.list(query) },
  '/notifications/unread-count': { GET: async () => ({ count: notificationRecordService.unreadCount() }) },
  '/notifications/read-all': { POST: async () => notificationRecordService.markAllRead() },
  '/notifications/read-conversation': {
    POST: async ({ body }) =>
      notificationRecordService.markConversationRead(ReadConversationNotificationsSchema.parse(body))
  },
  '/notifications/:id': {
    GET: async ({ params }) => {
      const record = notificationRecordService.getById(z.uuid().parse(params.id))
      if (!record) throw DataApiErrorFactory.notFound('Notification', params.id)
      return record
    },
    PATCH: async ({ params, body }) => {
      ReadNotificationSchema.parse(body)
      notificationRecordService.markRead(z.uuid().parse(params.id))
    },
    DELETE: async ({ params }) => notificationRecordService.dismiss(z.uuid().parse(params.id))
  }
}
