import { sql } from 'drizzle-orm'

import { application } from '@application'
import { agentTable } from '@data/db/schemas/agent'
import { agentSessionTable } from '@data/db/schemas/agentSession'
import { assistantTable } from '@data/db/schemas/assistant'
import { fileEntryTable } from '@data/db/schemas/file'
import { paintingTable } from '@data/db/schemas/painting'
import { topicTable } from '@data/db/schemas/topic'
import type { ArchiveEntry } from '@shared/data/api/schemas/archives'
import type { CursorPaginationResponse } from '@shared/data/api/types'

import { asNumericKey, decodeListCursor, encodeCursor, keysetOrdering } from './utils/keysetCursor'

export function listArchives(query: { cursor?: string; limit: number }): CursorPaginationResponse<ArchiveEntry> {
  const db = application.get('DbService').getDb()
  const cursor = decodeListCursor(query.cursor, asNumericKey, 'archives')
  const ordering = keysetOrdering(sql`"deletedAt"`, sql`"id"`, { major: 'desc', tie: 'asc' })
  const rows = db.all<ArchiveEntry>(sql`
    SELECT * FROM (
      SELECT 'topics:' || id AS id, id AS entityId, 'topics' AS domain, name, deleted_at AS deletedAt
      FROM ${topicTable} WHERE deleted_at IS NOT NULL
      UNION ALL
      SELECT 'assistants:' || id, id, 'assistants', name, deleted_at
      FROM ${assistantTable} WHERE deleted_at IS NOT NULL
      UNION ALL
      SELECT 'agents:' || id, id, 'agents', name, deleted_at
      FROM ${agentTable} WHERE deleted_at IS NOT NULL
      UNION ALL
      SELECT 'sessions:' || id, id, 'sessions', name, deleted_at
      FROM ${agentSessionTable} WHERE deleted_at IS NOT NULL AND type = 'conversation'
      UNION ALL
      SELECT 'paintings:' || id, id, 'paintings', prompt, deleted_at
      FROM ${paintingTable} WHERE deleted_at IS NOT NULL
      UNION ALL
      SELECT 'files:' || id, id, 'files', CASE WHEN ext IS NOT NULL AND ext != '' THEN name || '.' || ext ELSE name END, deleted_at
      FROM ${fileEntryTable} WHERE deleted_at IS NOT NULL AND origin = 'internal'
    ) WHERE ${cursor ? ordering.where(cursor) : sql`1 = 1`}
    ORDER BY ${sql.join(ordering.orderBy, sql`, `)} LIMIT ${query.limit + 1}
  `)
  const items = rows.slice(0, query.limit)
  const last = items.at(-1)
  return {
    items,
    nextCursor: rows.length > query.limit && last ? encodeCursor(last.deletedAt, last.id) : undefined
  }
}
