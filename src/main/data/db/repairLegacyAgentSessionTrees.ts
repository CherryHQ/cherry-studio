import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { sql } from 'drizzle-orm'
import { v7 as uuidv7 } from 'uuid'

import { loggerService } from '@logger'

import type { DbType } from './types'

const logger = loggerService.withContext('applyMigrations')

export function repairLegacyAgentSessionTrees(db: DbType, migrationsFolder: string): void {
  if (!db.get(sql`SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = '__drizzle_migrations'`)) return
  const latest = db.get<{ created_at: number }>(
    sql`SELECT created_at FROM __drizzle_migrations ORDER BY created_at DESC LIMIT 1`
  )
  // Journal timestamps for 0032 (tree columns) and 0039 (tree backfill).
  if (!latest || latest.created_at < 1_793_700_436_233 || latest.created_at >= 1_794_662_249_449) return
  if (!existsSync(join(migrationsFolder, '0039_agent_session_tree_backfill.sql'))) return

  const recovered = db.transaction(
    (tx) => {
      const sessions = tx.all<{ id: string; activeNodeId: string | null }>(sql`
        SELECT DISTINCT s.id, s.active_node_id AS activeNodeId
        FROM agent_session_message m
        JOIN agent_session s ON s.id = m.session_id
        LEFT JOIN agent_session_message p ON p.id = m.parent_id AND p.session_id = m.session_id
        WHERE (m.parent_id IS NOT NULL AND (m.role = 'root' OR p.id IS NULL OR m.id = p.id))
           OR (m.role != 'root' AND m.parent_id IS NULL AND (
             s.active_node_id IS NOT NULL OR EXISTS (
               SELECT 1 FROM agent_session_message child
               WHERE child.session_id = s.id AND child.parent_id IS NOT NULL
             )
           ))
      `)

      let repairedEdges = 0
      for (const session of sessions) {
        const rows = tx.all<{ id: string; role: string; parentId: string | null; createdAt: number }>(sql`
          SELECT id, role, parent_id AS parentId, created_at AS createdAt
          FROM agent_session_message WHERE session_id = ${session.id} ORDER BY created_at, id
        `)
        const root = rows.find((row) => row.role === 'root')
        const rootId = root?.id ?? uuidv7()
        if (!root) {
          tx.run(sql`
            INSERT INTO agent_session_message (id, session_id, role, data, status, fts_rowid, created_at, updated_at)
            SELECT ${rootId}, id, 'root', '{"parts":[]}', 'success',
              (SELECT coalesce(max(fts_rowid), 0) + 1 FROM agent_session_message), created_at, updated_at
            FROM agent_session WHERE id = ${session.id}
          `)
        }

        const ids = new Set(rows.map((row) => row.id))
        const parents = new Set(
          rows.filter((row) => row.role !== 'root' && row.parentId !== row.id).map((row) => row.parentId)
        )
        const isFlat = rows.every((row) => row.role === 'root' || row.parentId === null)
        const prefixParents = new Map<string, string>()
        let prefixTip = rootId
        for (const row of rows) {
          if (row.role === 'root' || row.parentId !== null) continue
          // The shipped tree writer created the root before appending the first linked turn.
          if (isFlat || (root && row.createdAt < root.createdAt && !parents.has(row.id))) {
            prefixParents.set(row.id, prefixTip)
            prefixTip = row.id
          }
        }

        for (const row of rows) {
          let parentId = row.parentId
          if (row.role === 'root') {
            parentId = null
          } else if (parentId === rootId) {
            parentId = prefixTip
          } else if (parentId === null || parentId === row.id || !ids.has(parentId)) {
            parentId = prefixParents.get(row.id) ?? rootId
          }
          if (parentId === row.parentId) continue
          tx.run(sql`UPDATE agent_session_message SET parent_id = ${parentId} WHERE id = ${row.id}`)
          repairedEdges++
        }

        if (isFlat && session.activeNodeId === rootId && prefixTip !== rootId) {
          tx.run(sql`UPDATE agent_session SET active_node_id = ${prefixTip} WHERE id = ${session.id}`)
        }
      }
      return repairedEdges
    },
    { behavior: 'immediate' }
  )

  if (recovered > 0) logger.info('Reattached legacy Agent Session messages before migration', { recovered })
}
