import { and, eq, isNull, sql } from 'drizzle-orm'

import { messageTable } from '@data/db/schemas/message'

export const sideChatSourceTopicId = sql<string>`json_extract(${messageTable.data}, '$.sideChat.sourceTopicId')`

export function sideChatRootFilter() {
  return and(
    eq(messageTable.role, 'root'),
    isNull(messageTable.parentId),
    isNull(messageTable.deletedAt),
    sql`json_type(${messageTable.data}, '$.sideChat') = 'object'`
  )
}
