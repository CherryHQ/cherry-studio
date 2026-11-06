import { and, count, eq, gt, isNull, lte, sql } from 'drizzle-orm'

import { application } from '@application'
import { notifyDataApiDataChange } from '@data/dataApiDataChange'
import { notificationRecordTable as table } from '@data/db/schemas/notificationRecord'
import {
  ListNotificationsQuerySchema,
  type ListNotificationsQuery,
  type NotificationPage
} from '@shared/data/api/schemas/notifications'
import type { NotificationRecord, NotificationTarget } from '@shared/data/types/notification'
import type { ConversationNavigationTarget } from '@shared/types/navigation'

import { asNumericKey, decodeListCursor, encodeCursor, keysetOrdering } from './utils/keysetCursor'

export type CreateNotificationRecordInput = Pick<
  NotificationRecord,
  'eventKey' | 'category' | 'kind' | 'title' | 'message' | 'createdAt'
> & { target?: NotificationTarget | null }

const RETENTION_MS = 30 * 24 * 60 * 60 * 1000
const visible = () => and(isNull(table.dismissedAt), gt(table.createdAt, Date.now() - RETENTION_MS))
const notifyChanged = () =>
  notifyDataApiDataChange([
    { endpoint: '/notifications', kind: 'membership' },
    { endpoint: '/notifications/unread-count' },
    { endpoint: '/notifications/:id' }
  ])

class NotificationRecordService {
  private get db() {
    return application.get('DbService').getDb()
  }

  create(input: CreateNotificationRecordInput): NotificationRecord | null {
    if (input.createdAt <= Date.now() - RETENTION_MS) return null
    const record = this.db
      .insert(table)
      .values({ ...input, target: input.target ?? null })
      .onConflictDoNothing({ target: table.eventKey })
      .returning()
      .get()
    if (record) notifyChanged()
    return record ?? null
  }

  getById(id: string): NotificationRecord | null {
    return (
      this.db
        .select()
        .from(table)
        .where(and(eq(table.id, id), visible()))
        .get() ?? null
    )
  }

  list(query: Partial<ListNotificationsQuery> = {}): NotificationPage {
    const { category, cursor: rawCursor, limit } = ListNotificationsQuerySchema.parse(query)
    const ordering = keysetOrdering(table.createdAt, table.id, { major: 'desc', tie: 'desc' })
    const cursor = decodeListCursor(rawCursor, asNumericKey, 'notifications')
    const rows = this.db
      .select()
      .from(table)
      .where(
        and(visible(), category ? eq(table.category, category) : undefined, cursor ? ordering.where(cursor) : undefined)
      )
      .orderBy(...ordering.orderBy)
      .limit(limit + 1)
      .all()
    const items = rows.slice(0, limit)
    const last = items.at(-1)
    return { items, nextCursor: rows.length > limit && last ? encodeCursor(last.createdAt, last.id) : undefined }
  }

  unreadCount(): number {
    return this.db
      .select({ count: count() })
      .from(table)
      .where(and(visible(), isNull(table.readAt)))
      .get()!.count
  }

  markRead(id: string): void {
    const { changes } = this.db
      .update(table)
      .set({ readAt: Date.now() })
      .where(and(eq(table.id, id), visible(), isNull(table.readAt)))
      .run()
    if (changes) notifyChanged()
  }

  markAllRead(): void {
    const { changes } = this.db
      .update(table)
      .set({ readAt: Date.now() })
      .where(and(visible(), isNull(table.readAt)))
      .run()
    if (changes) notifyChanged()
  }

  markConversationRead({ conversationType, conversationId }: ConversationNavigationTarget): void {
    const { changes } = this.db
      .update(table)
      .set({ readAt: Date.now() })
      .where(
        and(
          visible(),
          isNull(table.readAt),
          sql`json_extract(${table.target}, '$.kind') = 'conversation'`,
          sql`json_extract(${table.target}, '$.conversationType') = ${conversationType}`,
          sql`json_extract(${table.target}, '$.conversationId') = ${conversationId}`
        )
      )
      .run()
    if (changes) notifyChanged()
  }

  dismiss(id: string): void {
    const { changes } = this.db
      .update(table)
      .set({ dismissedAt: Date.now() })
      .where(and(eq(table.id, id), visible()))
      .run()
    if (changes) notifyChanged()
  }

  purgeExpired(now = Date.now()): void {
    if (
      this.db
        .delete(table)
        .where(lte(table.createdAt, now - RETENTION_MS))
        .run().changes
    )
      notifyChanged()
  }
}

export const notificationRecordService = new NotificationRecordService()
