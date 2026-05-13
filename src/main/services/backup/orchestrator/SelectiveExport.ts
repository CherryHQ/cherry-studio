/**
 * Selective Backup Database Export
 *
 * Creates a compact backup database containing only the selected domains.
 * Unlike full backup (VACUUM INTO), this builds a fresh SQLite file from scratch
 * by migrating the schema first, then copying only the required tables.
 *
 * Strategy:
 *   1. Create empty SQLite file
 *   2. Run migrate() + CUSTOM_SQL_STATEMENTS to establish full schema
 *   3. ATTACH the live database and INSERT per-table for each selected domain
 *   4. Fall back to dual-client batch INSERT if ATTACH fails (WAL compat issues)
 *   5. Nullify cross-domain foreign keys referencing unselected domains
 *   6. VACUUM to reclaim empty pages
 */

import { application } from '@application'
import type { Client, InValue } from '@libsql/client'
import { createClient } from '@libsql/client'
import { loggerService } from '@logger'
import { CUSTOM_SQL_STATEMENTS } from '@main/data/db/customSqls'
import type { BackupDomain } from '@shared/backup'
import { drizzle } from 'drizzle-orm/libsql'
import { migrate } from 'drizzle-orm/libsql/migrator'
import { pathToFileURL } from 'url'

import type { CancellationToken } from '../CancellationToken'
import { DOMAIN_TABLE_MAP, IMPORT_ORDER } from '../domain/DomainRegistry'
import { CROSS_DOMAIN_FK_RULES } from '../domain/DomainStripper'

const logger = loggerService.withContext('SelectiveExport')

/** Batch size for fallback dual-client row copying */
const FALLBACK_BATCH_SIZE = 500

/**
 * Creates a selective backup database containing only the specified domains.
 *
 * The output file has the complete schema but only rows from selected domains.
 * Cross-domain foreign keys pointing to unselected domains are nullified or
 * the referencing rows are deleted, depending on the FK rule.
 *
 * @param backupDbPath - Absolute path where the backup SQLite file will be created
 * @param selectedDomains - Domains to include in the backup
 * @param token - Cancellation token to abort the operation
 * @throws {BackupCancelledError} If the operation is cancelled via token
 */
export async function createSelectiveBackupDb(
  backupDbPath: string,
  selectedDomains: BackupDomain[],
  token: CancellationToken
): Promise<void> {
  const selectedSet = new Set(selectedDomains)

  // Step 1: Create empty SQLite and apply full schema
  const { client: backupClient, cleanup } = await initializeSchema(backupDbPath)

  try {
    // Step 2: Copy domain tables from live database
    await copyDomainTables(backupClient, selectedDomains, token)

    // Step 3: Handle cross-domain FK references
    token.throwIfCancelled()
    await applyCrossDomainFkRules(backupClient, selectedSet, token)

    // Step 4: VACUUM to compact the file
    token.throwIfCancelled()
    await backupClient.execute('VACUUM')

    logger.info('Selective backup database created', {
      domains: selectedDomains,
      path: backupDbPath
    })
  } finally {
    cleanup()
  }
}

/**
 * Creates an empty SQLite file and applies the full database schema
 * using Drizzle migrations and custom SQL statements.
 *
 * Returns the raw client for subsequent operations and a cleanup function
 * that must be called when done.
 */
async function initializeSchema(backupDbPath: string): Promise<{ client: Client; cleanup: () => void }> {
  const url = pathToFileURL(backupDbPath).href
  const client = createClient({ url })

  try {
    const migrationsFolder = application.getPath('app.database.migrations')
    const db = drizzle({ client, casing: 'snake_case' })

    await migrate(db, { migrationsFolder })

    // Run custom SQL (FTS virtual tables, triggers, etc.)
    for (const stmt of CUSTOM_SQL_STATEMENTS) {
      await client.execute(stmt)
    }

    logger.info('Schema initialized for selective backup', { path: backupDbPath })
  } catch (error) {
    client.close()
    throw error
  }

  return {
    client,
    cleanup: () => client.close()
  }
}

/**
 * Copies data for each selected domain from the live database into the backup.
 *
 * Uses ATTACH DATABASE for efficient bulk INSERT...SELECT when possible.
 * Falls back to dual-client batched INSERT if ATTACH is unavailable.
 */
async function copyDomainTables(
  backupClient: Client,
  selectedDomains: BackupDomain[],
  token: CancellationToken
): Promise<void> {
  const liveDbPath = application.getPath('app.database.file')
  const tables = getOrderedTables(selectedDomains)

  // Try ATTACH strategy first
  const attached = await tryAttachAndCopy(backupClient, liveDbPath, tables, token)
  if (attached) return

  // Fallback: open a second client against the live database
  logger.info('ATTACH unavailable, falling back to dual-client copy')
  const liveClient = createClient({ url: pathToFileURL(liveDbPath).href })
  try {
    for (const table of tables) {
      token.throwIfCancelled()
      await copyTableDualClient(liveClient, backupClient, table, token)
    }
  } finally {
    liveClient.close()
  }
}

/**
 * Collects table names for selected domains in IMPORT_ORDER to respect
 * FK dependencies during insertion.
 */
function getOrderedTables(selectedDomains: BackupDomain[]): string[] {
  const selectedSet = new Set(selectedDomains)
  const tables: string[] = []

  for (const domain of IMPORT_ORDER) {
    if (selectedSet.has(domain)) {
      for (const table of DOMAIN_TABLE_MAP[domain]) {
        tables.push(table)
      }
    }
  }

  return tables
}

/**
 * Attempts to ATTACH the live database and copy tables using INSERT...SELECT.
 *
 * ATTACH is faster because SQLite handles the row transfer internally
 * without round-tripping data through the Node.js process.
 *
 * @returns true if ATTACH succeeded and all tables were copied, false otherwise
 */
async function tryAttachAndCopy(
  backupClient: Client,
  liveDbPath: string,
  tables: string[],
  token: CancellationToken
): Promise<boolean> {
  try {
    const escaped = liveDbPath.replaceAll("'", "''")
    await backupClient.execute(`ATTACH DATABASE '${escaped}' AS source`)
  } catch (error) {
    logger.warn('ATTACH DATABASE failed, will use fallback', error as Error)
    return false
  }

  try {
    for (const table of tables) {
      token.throwIfCancelled()
      // Column-order consistency: both databases share identical schema from the same
      // Drizzle migrations, so SELECT * column order matches INSERT target order.
      // This assumption breaks if migrations ever diverge between live and backup.
      await backupClient.execute(`INSERT INTO "${table}" SELECT * FROM source."${table}"`)
    }
    logger.info('Tables copied via ATTACH', { count: tables.length })
    return true
  } finally {
    // Always detach, even on error
    try {
      await backupClient.execute('DETACH DATABASE source')
    } catch {
      // DETACH failure is non-critical; the backup client will be closed anyway
    }
  }
}

/**
 * Copies a single table from live to backup using batched SELECT/INSERT.
 *
 * Used when ATTACH is unavailable. Reads rows in batches from the live
 * database and writes them to the backup database.
 */
async function copyTableDualClient(
  liveClient: Client,
  backupClient: Client,
  table: string,
  token: CancellationToken
): Promise<void> {
  const countResult = await liveClient.execute(`SELECT COUNT(*) as cnt FROM "${table}"`)
  const totalRows = Number(countResult.rows[0].cnt)

  if (totalRows === 0) {
    logger.debug('Table is empty, skipping', { table })
    return
  }

  // Read column names to build parameterized INSERT
  const sampleResult = await liveClient.execute(`SELECT * FROM "${table}" LIMIT 0`)
  const columns = sampleResult.columns

  if (columns.length === 0) {
    logger.warn('Table has no columns, skipping', { table })
    return
  }

  const columnList = columns.map((c) => `"${c}"`).join(', ')
  const placeholders = columns.map(() => '?').join(', ')
  const insertSql = `INSERT INTO "${table}" (${columnList}) VALUES (${placeholders})`

  // Cursor-based pagination via rowid — safe under concurrent WAL writes
  let lastRowid = 0
  let copied = 0

  while (copied < totalRows) {
    token.throwIfCancelled()

    const batch = await liveClient.execute({
      sql: `SELECT rowid AS _rowid_, * FROM "${table}" WHERE rowid > ? ORDER BY rowid LIMIT ?`,
      args: [lastRowid, FALLBACK_BATCH_SIZE]
    })

    if (batch.rows.length === 0) break

    // Batch INSERT: send all rows in a single transaction round-trip
    const stmts = batch.rows.map((row) => ({
      sql: insertSql,
      args: columns.map((col) => (row as Record<string, unknown>)[col]) as InValue[]
    }))
    await backupClient.batch(stmts)

    // Advance cursor to the last rowid in this batch
    lastRowid = Number((batch.rows[batch.rows.length - 1] as Record<string, unknown>)._rowid_)
    copied += batch.rows.length
  }

  logger.debug('Table copied via dual-client', { table, rows: copied })
}

/**
 * Applies cross-domain FK rules to nullify or delete rows that reference
 * unselected domains.
 *
 * For SET_NULL rules: the FK column is set to NULL.
 * For DELETE_ROW rules: rows with non-NULL FK values are deleted entirely.
 */
async function applyCrossDomainFkRules(
  backupClient: Client,
  selectedDomains: Set<BackupDomain>,
  token: CancellationToken
): Promise<void> {
  // Collect table names present in backup to skip rules for absent tables
  const tableResult = await backupClient.execute(
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`
  )
  const existingTables = new Set(tableResult.rows.map((r) => r.name as string))

  let applied = 0

  for (const rule of CROSS_DOMAIN_FK_RULES) {
    token.throwIfCancelled()

    // Skip if the referenced domain is selected (FK is valid)
    if (selectedDomains.has(rule.referencedDomain)) continue

    // Skip if the table does not exist in the backup
    if (!existingTables.has(rule.table)) continue

    if (rule.action === 'SET_NULL') {
      await backupClient.execute(`UPDATE "${rule.table}" SET "${rule.column}" = NULL`)
    } else {
      // DELETE_ROW: remove rows that still reference the unselected domain
      await backupClient.execute(`DELETE FROM "${rule.table}" WHERE "${rule.column}" IS NOT NULL`)
    }

    applied++
  }

  if (applied > 0) {
    logger.info('Cross-domain FK rules applied', { count: applied })
  }
}
