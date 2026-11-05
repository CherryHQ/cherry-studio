import { and, asc, desc, eq, gt, gte, lt, lte, or, sql } from 'drizzle-orm'

import { agentSessionMessageTable as messages } from '@data/db/schemas/agentSessionMessage'
import type { AgentSessionMessageRow } from '@data/db/schemas/agentSessionMessage'
import type { DbOrTx } from '@data/db/types'

import { asNumericKey, decodeListCursor, encodeCursor, keysetOrdering } from './utils/keysetCursor'

type Boundary = Pick<AgentSessionMessageRow, 'id' | 'createdAt' | 'provenance'>
const imported = sql`json_extract(${messages.provenance}, '$.source') = 'workbuddy'`
const band = sql<number>`CASE WHEN ${imported} THEN 0 ELSE 1 END`
const position = sql<number>`CASE WHEN ${imported} THEN json_extract(${messages.provenance}, '$.sourceOrder') ELSE ${messages.createdAt} END`

/** Imported WorkBuddy rows form a fixed prefix; native continuation keeps its existing ordering. */
export function sessionMessageOrdering(db: DbOrTx, sessionId: string, direction: 'asc' | 'desc' = 'asc') {
  const hasHistory = Boolean(
    db
      .select({ id: messages.id })
      .from(messages)
      .where(and(eq(messages.sessionId, sessionId), imported))
      .limit(1)
      .get()
  )
  const ordinary = keysetOrdering(messages.createdAt, messages.id, { major: direction, tie: direction })
  const sort = direction === 'asc' ? asc : desc
  const compare = direction === 'asc' ? gt : lt
  const compareInclusive = direction === 'asc' ? gte : lte
  const key = (row: Boundary) =>
    row.provenance?.source === 'workbuddy'
      ? { band: 0, position: row.provenance.sourceOrder, id: row.id }
      : { band: 1, position: row.createdAt, id: row.id }
  const boundary = (value: ReturnType<typeof key>, inclusive = false) =>
    or(
      compare(band, value.band),
      and(eq(band, value.band), compare(position, value.position)),
      and(
        eq(band, value.band),
        eq(position, value.position),
        (inclusive ? compareInclusive : compare)(messages.id, value.id)
      )
    )!
  return {
    orderBy: hasHistory ? [sort(band), sort(position), sort(messages.id)] : ordinary.orderBy,
    whereRow(row: Boundary, inclusive = false) {
      if (hasHistory) return boundary(key(row), inclusive)
      return inclusive
        ? or(
            compare(messages.createdAt, row.createdAt),
            and(eq(messages.createdAt, row.createdAt), compareInclusive(messages.id, row.id))
          )!
        : ordinary.where({ key: row.createdAt, id: row.id })
    },
    encode(row: Boundary) {
      return hasHistory
        ? 'history:' + encodeURIComponent(JSON.stringify(key(row)))
        : encodeCursor(row.createdAt, row.id)
    },
    fromCursor(raw?: string) {
      if (!raw) return undefined
      if (hasHistory && raw.startsWith('history:')) {
        try {
          const value = JSON.parse(decodeURIComponent(raw.slice(8)))
          if (
            (value.band === 0 || value.band === 1) &&
            Number.isSafeInteger(value.position) &&
            typeof value.id === 'string' &&
            value.id
          )
            return boundary(value)
        } catch {
          /* Invalid list cursors restart at the newest page. */
        }
        return undefined
      }
      const cursor = decodeListCursor(raw, asNumericKey, 'agent-session-message')
      if (!cursor) return undefined
      if (!hasHistory) return ordinary.where(cursor)
      const row = db
        .select()
        .from(messages)
        .where(and(eq(messages.sessionId, sessionId), eq(messages.id, cursor.id)))
        .get()
      return row ? boundary(key(row)) : undefined
    }
  }
}
