import { eq, inArray, sql } from 'drizzle-orm'

import { application } from '@application'
import { agentTable } from '@data/db/schemas/agent'
import { agentSessionTable } from '@data/db/schemas/agentSession'
import { assistantTable } from '@data/db/schemas/assistant'
import { fileEntryTable } from '@data/db/schemas/file'
import { paintingTable } from '@data/db/schemas/painting'
import { topicTable } from '@data/db/schemas/topic'
import type { ArchiveDomain, ArchiveEntry } from '@shared/data/api/schemas/archives'
import type { CursorPaginationResponse } from '@shared/data/api/types'

import { asNumericKey, decodeListCursor, encodeCursor, keysetOrdering } from './utils/keysetCursor'

type ArchiveRow = Omit<ArchiveEntry, 'parentName'>

export function listArchives(query: {
  domain?: ArchiveDomain
  cursor?: string
  limit: number
}): CursorPaginationResponse<ArchiveEntry> {
  const db = application.get('DbService').getDb()
  const cursor = decodeListCursor(query.cursor, asNumericKey, 'archives')
  const ordering = keysetOrdering(sql`"deletedAt"`, sql`"id"`, { major: 'desc', tie: 'asc' })
  const rows = db.all<ArchiveRow>(sql`
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
    ) WHERE ${cursor ? sql`(${ordering.where(cursor)})` : sql`1 = 1`}
    ${query.domain ? sql`AND "domain" = ${query.domain}` : sql``}
    ORDER BY ${sql.join(ordering.orderBy, sql`, `)} LIMIT ${query.limit + 1}
  `)
  const page = rows.slice(0, query.limit)
  const parentNames = fetchParentNames(page)
  const items: ArchiveEntry[] = page.map((row) => ({ ...row, parentName: parentNames.get(row.id) ?? null }))
  const last = items.at(-1)
  return {
    items,
    nextCursor: rows.length > query.limit && last ? encodeCursor(last.deletedAt, last.id) : undefined
  }
}

/** Resolve owning assistant/agent names for a page of entries; a purged owner yields null. */
function fetchParentNames(rows: ArchiveRow[]): Map<string, string | null> {
  const db = application.get('DbService').getDb()
  const parentNames = new Map<string, string | null>()
  const sessionIds = rows.filter((row) => row.domain === 'sessions').map((row) => row.entityId)
  const topicIds = rows.filter((row) => row.domain === 'topics').map((row) => row.entityId)

  if (sessionIds.length > 0) {
    const sessionRows = db
      .select({ id: agentSessionTable.id, parentName: agentTable.name })
      .from(agentSessionTable)
      .leftJoin(agentTable, eq(agentTable.id, agentSessionTable.agentId))
      .where(inArray(agentSessionTable.id, sessionIds))
      .all()
    for (const row of sessionRows) {
      parentNames.set(`sessions:${row.id}`, row.parentName)
    }
  }

  if (topicIds.length > 0) {
    const topicRows = db
      .select({ id: topicTable.id, parentName: assistantTable.name })
      .from(topicTable)
      .leftJoin(assistantTable, eq(assistantTable.id, topicTable.assistantId))
      .where(inArray(topicTable.id, topicIds))
      .all()
    for (const row of topicRows) {
      parentNames.set(`topics:${row.id}`, row.parentName)
    }
  }

  return parentNames
}
