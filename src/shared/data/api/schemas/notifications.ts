import * as z from 'zod'

import { NotificationCategorySchema, type NotificationRecord } from '../../types/notification'
import type { CursorPaginationResponse } from '../types'

export const ListNotificationsQuerySchema = z.object({
  category: NotificationCategorySchema.optional(),
  cursor: z.string().max(256).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50)
})
export type ListNotificationsQuery = z.infer<typeof ListNotificationsQuerySchema>
export type NotificationPage = CursorPaginationResponse<NotificationRecord>

export const ReadNotificationSchema = z.strictObject({ read: z.literal(true) })
export const ReadConversationNotificationsSchema = z.strictObject({
  conversationType: z.enum(['assistant', 'agent']),
  conversationId: z.string().min(1)
})

export type NotificationSchemas = {
  '/notifications': { GET: { query: Partial<ListNotificationsQuery>; response: NotificationPage } }
  '/notifications/unread-count': { GET: { response: { count: number } } }
  '/notifications/read-all': { POST: { response: void } }
  '/notifications/read-conversation': {
    POST: { body: z.infer<typeof ReadConversationNotificationsSchema>; response: void }
  }
  '/notifications/:id': {
    GET: { params: { id: string }; response: NotificationRecord }
    PATCH: { params: { id: string }; body: { read: true }; response: void }
    DELETE: { params: { id: string }; response: void }
  }
}
