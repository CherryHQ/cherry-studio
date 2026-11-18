import type { AnySQLiteColumn } from 'drizzle-orm/sqlite-core'

import type { ConversationListSortBy } from '@shared/data/types/conversationList'

import { decodeListCursor, keysetOrdering } from './utils/keysetCursor'
import type { PinnedListCursor } from './utils/pinnedListCursor'
import { encodeEntityCursor } from './utils/pinnedListCursor'

type ConversationOrderRow = {
  id: string
  orderKey: string
  lastActivityAt: number
  createdAt: number
  name: string
}

export function conversationListOrdering({
  columns,
  cursor,
  sortBy = 'orderKey',
  sortOrder = sortBy === 'orderKey' ? 'asc' : 'desc'
}: {
  columns: Record<keyof ConversationOrderRow, AnySQLiteColumn>
  cursor: PinnedListCursor
  sortBy?: ConversationListSortBy
  sortOrder?: 'asc' | 'desc'
}) {
  const ordering = keysetOrdering(columns[sortBy], columns.id, { major: sortOrder, tie: 'asc' })
  const boundary =
    cursor.section === 'entity' && cursor.orderKey !== null
      ? sortBy === 'orderKey'
        ? { key: cursor.orderKey, id: cursor.id }
        : decodeListCursor(
            `${cursor.orderKey}:${cursor.id}`,
            (encoded) => {
              try {
                const key: unknown = JSON.parse(encoded)
                return sortBy === 'name'
                  ? typeof key === 'string'
                    ? key
                    : null
                  : typeof key === 'number' && Number.isFinite(key)
                    ? key
                    : null
              } catch {
                return null
              }
            },
            'conversation-list'
          )
      : null

  return {
    after: boundary ? ordering.where(boundary) : undefined,
    orderBy: ordering.orderBy,
    encode: (row: ConversationOrderRow) =>
      encodeEntityCursor(sortBy === 'orderKey' ? row.orderKey : encodeURIComponent(JSON.stringify(row[sortBy])), row.id)
  }
}
