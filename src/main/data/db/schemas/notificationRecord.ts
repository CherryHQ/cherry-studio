import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

import type { NotificationCategory, NotificationTarget } from '@shared/data/types/notification'

import { uuidPrimaryKey } from './_columnHelpers'

export const notificationRecordTable = sqliteTable(
  'notification_record',
  {
    id: uuidPrimaryKey(),
    eventKey: text().notNull(),
    category: text().$type<NotificationCategory>().notNull(),
    kind: text().notNull(),
    title: text().notNull(),
    message: text().notNull(),
    createdAt: integer().notNull(),
    readAt: integer(),
    dismissedAt: integer(),
    target: text({ mode: 'json' }).$type<NotificationTarget>()
  },
  (t) => [
    uniqueIndex('notification_record_event_key_idx').on(t.eventKey),
    index('notification_record_time_idx').on(t.createdAt, t.id),
    index('notification_record_category_time_idx').on(t.category, t.createdAt, t.id)
  ]
)

export type NotificationRecordRow = typeof notificationRecordTable.$inferSelect
export type InsertNotificationRecordRow = typeof notificationRecordTable.$inferInsert
