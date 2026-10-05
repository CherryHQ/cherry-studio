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

interface ArchiveParent {
  parentId: string | null
  parentName: string | null
}

type ArchiveRow = Omit<ArchiveEntry, 'parentId' | 'parentName'>

const EMPTY_PARENT: ArchiveParent = { parentId: null, parentName: null }

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
  const parents = fetchParents(page)
  const items: ArchiveEntry[] = page.map((row) => ({ ...row, ...(parents.get(row.id) ?? EMPTY_PARENT) }))
  const last = items.at(-1)
  return {
    items,
    nextCursor: rows.length > query.limit && last ? encodeCursor(last.deletedAt, last.id) : undefined
  }
}

/** Resolve owning assistant/agent for a page of entries; a purged owner yields null. */
function fetchParents(rows: ArchiveRow[]): Map<string, ArchiveParent> {
  const db = application.get('DbService').getDb()
  const parents = new Map<string, ArchiveParent>()
  const sessionIds = rows.filter((row) => row.domain === 'sessions').map((row) => row.entityId)
  const topicIds = rows.filter((row) => row.domain === 'topics').map((row) => row.entityId)

  if (sessionIds.length > 0) {
    const sessionRows = db
      .select({ id: agentSessionTable.id, parentId: agentSessionTable.agentId, parentName: agentTable.name })
      .from(agentSessionTable)
      .leftJoin(agentTable, eq(agentTable.id, agentSessionTable.agentId))
      .where(inArray(agentSessionTable.id, sessionIds))
      .all()
    for (const row of sessionRows) {
      parents.set(`sessions:${row.id}`, { parentId: row.parentId ?? null, parentName: row.parentName ?? null })
    }
  }

  if (topicIds.length > 0) {
    const topicRows = db
      .select({ id: topicTable.id, parentId: topicTable.assistantId, parentName: assistantTable.name })
      .from(topicTable)
      .leftJoin(assistantTable, eq(assistantTable.id, topicTable.assistantId))
      .where(inArray(topicTable.id, topicIds))
      .all()
    for (const row of topicRows) {
      parents.set(`topics:${row.id}`, { parentId: row.parentId ?? null, parentName: row.parentName ?? null })
    }
  }

  return parents
}
