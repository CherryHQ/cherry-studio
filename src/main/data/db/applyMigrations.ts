import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { sql } from 'drizzle-orm'
// The one sanctioned call site: this module is what wraps migrate() in the foreign-key
// handling that the ban points every other caller to.
// eslint-disable-next-line @typescript-eslint/no-restricted-imports
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'

import { loggerService } from '@logger'

import { CUSTOM_SQL_STATEMENTS } from './customSqls'
import type { DbType } from './types'

const logger = loggerService.withContext('applyMigrations')

/**
 * Apply drizzle migrations, then the custom SQL drizzle cannot manage
 * (FTS5 virtual tables, triggers — all idempotent, see customSqls.ts).
 *
 * Pure function over an injected connection so all three consumers share one
 * migration path: DbService.onInit (live DB), the test harness (throwaway DB),
 * and the backup restore pipeline (detached work.sqlite migrate-forward).
 */
export function applyMigrations(db: DbType, migrationsFolder: string): void {
  repairLegacyAgentSessionTrees(db, migrationsFolder)

  // SQLite cannot alter a table constraint in place, so drizzle-kit compiles any
  // constraint / column-type change into a table recreate (CREATE __new_x →
  // INSERT SELECT → DROP x → RENAME) guarded by its own `PRAGMA foreign_keys=OFF`.
  // That guard never takes effect: drizzle-orm's migrator wraps every statement in
  // one transaction, and SQLite documents the pragma as a no-op inside one — so the
  // DROP fires every child's ON DELETE action and silently takes their rows with it.
  // Toggling enforcement here, outside the migrator's transaction, is the only place
  // it actually applies.
  const enforced = isForeignKeysEnforced(db)
  db.run(sql.raw('PRAGMA foreign_keys = OFF'))
  try {
    migrate(db, { migrationsFolder })
  } finally {
    db.run(sql.raw(`PRAGMA foreign_keys = ${enforced ? 'ON' : 'OFF'}`))
  }

  // Enforcement was on before the call, so anything reported now is a dangling
  // reference the migration itself introduced. Boot must not be blocked over it —
  // applyMigrations is also the restore and test-harness path, and a hard failure
  // would be unrecoverable for the user — but it must never pass unremarked.
  if (enforced) {
    const violations = db.all(sql.raw('PRAGMA foreign_key_check'))
    if (violations.length > 0) {
      logger.error('Migration left dangling foreign key references', { violations })
    }
  }

  for (const statement of CUSTOM_SQL_STATEMENTS) {
    db.run(sql.raw(statement))
  }
}

function isForeignKeysEnforced(db: DbType): boolean {
  const rows = db.all<{ foreign_keys?: number }>(sql.raw('PRAGMA foreign_keys'))
  return Number(rows[0]?.foreign_keys ?? 0) === 1
}

function repairLegacyAgentSessionTrees(db: DbType, migrationsFolder: string): void {
  if (!db.get(sql`SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = '__drizzle_migrations'`)) return
  const latest = db.get<{ created_at: number }>(
    sql`SELECT created_at FROM __drizzle_migrations ORDER BY created_at DESC LIMIT 1`
  )
  // Journal timestamps for 0032 (tree columns) and 0039 (tree backfill).
  if (!latest || latest.created_at < 1_793_700_436_233 || latest.created_at >= 1_794_662_249_449) return
  if (!existsSync(join(migrationsFolder, '0039_agent_session_tree_backfill.sql'))) return

  const recovered = db.transaction(
    (tx) => {
      // Leave explicit invalid edges to the shipped integrity check.
      if (
        tx.get(sql`
          SELECT 1 FROM agent_session_message m
          WHERE m.parent_id IS NOT NULL AND (m.role = 'root' OR NOT EXISTS (
            SELECT 1 FROM agent_session_message p WHERE p.id = m.parent_id AND p.session_id = m.session_id
          ))
          LIMIT 1
        `)
      )
        return 0

      const repairs = tx.all<{ id: string; sessionId: string; parentId: string; selectHead: 0 | 1 }>(sql`
        WITH rooted_sessions AS (
          SELECT s.id, s.active_node_id, root.id AS root_id,
            EXISTS (
              SELECT 1 FROM agent_session_message child
              WHERE child.session_id = s.id AND child.parent_id IS NOT NULL
            ) AS has_edges
          FROM agent_session s
          JOIN agent_session_message root
            ON root.session_id = s.id AND root.role = 'root' AND root.parent_id IS NULL
        ), detached AS (
          SELECT m.id, m.session_id, m.created_at, s.root_id,
            (NOT s.has_edges AND s.active_node_id IS s.root_id) AS was_flat
          FROM agent_session_message m
          JOIN rooted_sessions s ON s.id = m.session_id
          WHERE m.role != 'root' AND m.parent_id IS NULL
            AND (s.active_node_id IS NOT NULL OR s.has_edges)
        )
        SELECT id, session_id AS sessionId,
          coalesce(CASE WHEN was_flat THEN lag(id) OVER history END, root_id) AS parentId,
          (was_flat AND lead(id) OVER history IS NULL) AS selectHead
        FROM detached
        WINDOW history AS (PARTITION BY session_id ORDER BY created_at, id)
      `)
      for (const { id, sessionId, parentId, selectHead } of repairs) {
        tx.run(sql`UPDATE agent_session_message SET parent_id = ${parentId} WHERE id = ${id}`)
        if (selectHead) {
          tx.run(sql`UPDATE agent_session SET active_node_id = ${id} WHERE id = ${sessionId}`)
        }
      }
      return repairs.length
    },
    { behavior: 'immediate' }
  )

  if (recovered > 0) logger.info('Reattached legacy Agent Session messages before migration', { recovered })
}
