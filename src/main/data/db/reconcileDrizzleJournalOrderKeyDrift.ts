import crypto from 'node:crypto'

import type { DbType } from '@data/db/types'
import { loggerService } from '@logger'
import { sql } from 'drizzle-orm'
import fs from 'fs'
import path from 'path'

const logger = loggerService.withContext('drizzle-journal-reconcile')

function isIgnorableIdempotentMigrationError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err)
  return (
    /duplicate column name/i.test(msg) ||
    /no such index/i.test(msg) ||
    /no such column/i.test(msg) ||
    /index .* already exists/i.test(msg)
  )
}

/**
 * When `order_key` columns already exist (e.g. after `drizzle-kit push`) but
 * `__drizzle_migrations` has no row for the matching migration, Drizzle would
 * re-run `ALTER TABLE ... ADD order_key` and fail with SQLITE_ERROR duplicate column.
 *
 * If `user_provider.order_key` exists but `topic.order_key` does not, we cannot
 * only record 0022 in the journal (Drizzle would skip 0017 by `created_at`). In
 * that case we apply `0017_giant_vermin.sql` statements idempotently, then record
 * 0017 and 0022 so `migrate()` skips both.
 *
 * Inserts journal row(s) only when the live schema already has the column so
 * `migrate()` can skip safely. Used by `DbService` and `MigrationDbService`.
 */
export async function reconcileDrizzleJournalOrderKeyDrift(db: DbType, migrationsFolder: string): Promise<void> {
  const journalPath = path.join(migrationsFolder, 'meta', '_journal.json')
  if (!fs.existsSync(journalPath)) {
    return
  }

  const migrationsTableRows = await db.all(sql`
    SELECT 1 AS ok
    FROM sqlite_master
    WHERE type = 'table' AND name = '__drizzle_migrations'
    LIMIT 1
  `)
  if (migrationsTableRows.length === 0) {
    return
  }

  const journal = JSON.parse(fs.readFileSync(journalPath, 'utf8')) as {
    entries: { tag: string; when: number }[]
  }

  const readHash = (tag: string): { hash: string; when: number } | undefined => {
    const entry = journal.entries.find((e) => e.tag === tag)
    if (!entry) {
      return undefined
    }
    const migrationPath = path.join(migrationsFolder, `${tag}.sql`)
    if (!fs.existsSync(migrationPath)) {
      return undefined
    }
    const body = fs.readFileSync(migrationPath, 'utf8')
    return {
      hash: crypto.createHash('sha256').update(body).digest('hex'),
      when: entry.when
    }
  }

  const journalHasHash = async (hash: string): Promise<boolean> => {
    const rows = await db.all(sql`
      SELECT 1 AS ok FROM __drizzle_migrations WHERE hash = ${hash} LIMIT 1
    `)
    return rows.length > 0
  }

  const tableHasColumn = async (table: string, column: string): Promise<boolean> => {
    if (!/^[a-z0-9_]+$/.test(table)) {
      return false
    }
    const rows = await db.all(sql.raw(`PRAGMA table_info(${JSON.stringify(table)})`))
    return rows.some((r) => (r as { name?: string }).name === column)
  }

  const insertJournal = async (hash: string, when: number): Promise<void> => {
    await db.run(sql`
      INSERT INTO __drizzle_migrations ("hash", "created_at") VALUES (${hash}, ${when})
    `)
  }

  try {
    const meta0017 = readHash('0017_giant_vermin')
    const meta0022 = readHash('0022_provider_order_key')

    let topicHasOrderKey = await tableHasColumn('topic', 'order_key')
    const providerHasOrderKey = await tableHasColumn('user_provider', 'order_key')

    const apply0017SqlStatements = async (): Promise<boolean> => {
      if (!meta0017) {
        return false
      }
      const migrationPath = path.join(migrationsFolder, '0017_giant_vermin.sql')
      if (!fs.existsSync(migrationPath)) {
        return false
      }
      const body = fs.readFileSync(migrationPath, 'utf8')
      const statements = body
        .split('--> statement-breakpoint')
        .map((s) => s.trim())
        .filter((s) => s.length > 0)
      for (const stmt of statements) {
        try {
          await db.run(sql.raw(stmt))
        } catch (e) {
          if (isIgnorableIdempotentMigrationError(e)) {
            continue
          }
          logger.warn('0017_giant_vermin reconcile statement failed', e as Error)
          return false
        }
      }
      logger.warn(
        'Reconciled schema drift: applied 0017_giant_vermin SQL (topic was missing order_key while journal lacked 0017)'
      )
      return true
    }

    if (meta0017 && !topicHasOrderKey && !(await journalHasHash(meta0017.hash)) && (await apply0017SqlStatements())) {
      topicHasOrderKey = await tableHasColumn('topic', 'order_key')
    }

    if (meta0017 && topicHasOrderKey && !(await journalHasHash(meta0017.hash))) {
      await insertJournal(meta0017.hash, meta0017.when)
      logger.warn('Reconciled schema drift: recorded 0017_giant_vermin in __drizzle_migrations')
    }

    const journalHas0017 = meta0017 ? await journalHasHash(meta0017.hash) : false

    if (
      meta0022 &&
      providerHasOrderKey &&
      journalHas0017 &&
      topicHasOrderKey &&
      !(await journalHasHash(meta0022.hash))
    ) {
      await insertJournal(meta0022.hash, meta0022.when)
      logger.warn(
        'Reconciled schema drift: recorded 0022_provider_order_key in __drizzle_migrations (user_provider.order_key already present)'
      )
    } else if (meta0022 && providerHasOrderKey && !(await journalHasHash(meta0022.hash)) && !journalHas0017) {
      logger.warn(
        'user_provider.order_key exists but 0017_giant_vermin is not recorded and topic.order_key could not be reconciled — reset DB or repair schema manually'
      )
    }
  } catch (error) {
    logger.warn('Drizzle journal reconciliation skipped', error as Error)
  }
}
