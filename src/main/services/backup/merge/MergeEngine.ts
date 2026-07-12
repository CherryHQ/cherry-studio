// MergeEngine — detached restore import pipeline (plan (b), MVP SKIP-only scaffold).
//
// Merges backup rows into a detached work.sqlite (VACUUM INTO copy of live) inside one
// synchronous better-sqlite3 transaction. MVP scope: SKIP (uuid-entity conflict) +
// INSERT (new aggregate), member cascade, and offline FK/integrity verify. FIELD_MERGE /
// OVERWRITE / RENAME, the global junction phase, identity propagation, and FTS rebuild
// are stubbed — they throw NotImplemented (MVP cannot restore any product archive; the
// production stub in BackupService stays fail-closed until the lite milestone lands).
//
// See spec `backup-restore-safety/import-orchestrator.md` + plan `cryptic-inventing-toucan.md`.

import type { AggregateBoundary, ReadonlyBackupRegistry } from '@main/data/db/backup/contributorTypes'
import type { DbTableName } from '@main/data/db/backup/dbSchemaRefs'
import { DB_FTS_VIRTUAL_TABLES } from '@main/data/db/backup/dbSchemaRefs'
import type { BackupDomain } from '@main/data/db/backup/domains'
import type { DbType } from '@main/data/db/types'
import Database from 'better-sqlite3'

import type { AggregateDecision, DegradedSkip, IdentityMap, MergeContext, MergeResult } from './types'

/**
 * Convert a Drizzle logical (camelCase) column name to its physical (snake_case)
 * SQL column name. The app's drizzle config uses `casing: 'snake_case'`, so every
 * camelCase property maps to a snake_case physical column this way. Column names
 * from the contributor schema (`viaColumn`, identityKey, PK columns) are logical
 * and MUST be converted before splicing into raw SQL.
 *
 * TODO(dbSchemaRefs): `DbColumnEntry.dbName` is meant to expose the physical name
 * but the codegen currently duplicates `name` there — once that is fixed, prefer
 * reading the physical name from the registry instead of recomputing it here.
 */
const physicalColumn = (logical: string): string => logical.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`)

/**
 * Source tables of FTS5 external-content virtual tables (message, agent_session_message).
 * On these tables the AFTER-INSERT trigger reassigns `fts_rowid` (MAX+1) and regenerates
 * `searchable_text` from `data` — so backup values for those columns MUST be stripped
 * before insert. Copying `fts_rowid` verbatim collides on the fts_rowid UNIQUE index
 * (the trigger on the first row bumps it onto the next row's backup value) and
 * `INSERT OR IGNORE` then silently drops the colliding row.
 */
const FTS_SOURCE_TABLES: ReadonlySet<string> = new Set(Object.values(DB_FTS_VIRTUAL_TABLES))
const FTS_DERIVED_PHYSICAL_COLUMNS = new Set(['fts_rowid', 'searchable_text'])

/**
 * Set an identityMap entry under its endpoint table. The maps are per-table nested
 * (see IdentityMap) so identical textual ids in different tables stay disjoint.
 */
const setIdentityEntry = (
  map: Map<DbTableName, Map<string, string>>,
  table: DbTableName,
  id: string,
  canonical: string
): void => {
  let inner = map.get(table)
  if (!inner) {
    inner = new Map()
    map.set(table, inner)
  }
  inner.set(id, canonical)
}

/** Strategy stubs not yet implemented in the MVP scaffold. */
export class MergeStrategyNotImplementedError extends Error {
  constructor(strategy: string) {
    super(`merge strategy not implemented in MVP scaffold: ${strategy}`)
    this.name = 'MergeStrategyNotImplementedError'
  }
}

/** Offline consistency check failed — work.sqlite must never promote. */
export class MergeConsistencyCheckError extends Error {
  constructor(detail: string) {
    super(`merge offline consistency check failed: ${detail}`)
    this.name = 'MergeConsistencyCheckError'
  }
}

/**
 * MergeEngine — consumed by ImportOrchestrator (which injects it as the
 * `mergeBackupIntoWork` dep). The engine opens the migrated backup.sqlite read-only,
 * scans work.sqlite (the live copy / merge base) for conflicts, then runs the import
 * inside a synchronous deferred-FK transaction on work.sqlite.
 */
export class MergeEngine {
  constructor(
    private readonly registry: ReadonlyBackupRegistry,
    private readonly deps: { readonly backupDbPath: string }
  ) {}

  /**
   * Merge backup rows into work.sqlite. The transaction fn is synchronous
   * (better-sqlite3 rejects Promise callbacks); backupDb is opened read-only and
   * consumed via sync iterators inside the tx.
   */
  async mergeBackupIntoWork(workSqlite: Database.Database, _workDb: DbType, ctx: MergeContext): Promise<MergeResult> {
    const backupDb = new Database(this.deps.backupDbPath, { readonly: true })
    try {
      const ordered = this.registry.topoSort(ctx.domains)
      const decisions = this.scanAggregates(workSqlite, ordered, backupDb, ctx)
      const identityMap: IdentityMap = { sourceMap: new Map(), targetMap: new Map() }
      const degradedToSkips: DegradedSkip[] = []

      // Synchronous deferred-FK transaction — better-sqlite3 requires a sync callback.
      const run = workSqlite.transaction(() => {
        // Defer FK enforcement to COMMIT (PRAGMA foreign_keys is a documented no-op inside
        // a tx; defer_foreign_keys is tx-scoped). The whole-graph foreign_key_check below
        // validates consistency before COMMIT.
        workSqlite.pragma('defer_foreign_keys = ON')
        this.importRows(workSqlite, ordered, decisions, ctx, backupDb, identityMap, degradedToSkips)
        // MVP stubs (lite milestone): junction phase, identity propagation, FTS rebuild.
        // Each throws NotImplemented if reached with data requiring it; SKIP-only uuid-entity
        // aggregates do not exercise them.
        this.runConsistencyCheck(workSqlite)
      })
      run()

      return { degradedToSkips }
    } finally {
      backupDb.close()
    }
  }

  /**
   * Scan work.sqlite (merge base) + backup.sqlite for each aggregate root and produce
   * a decision per backup root. Runs BEFORE the write tx (read-only on both DBs).
   *
   * MVP: uuid-entity aggregates → identityKey = PK; conflict (work has same PK) → SKIP;
   * else INSERT. natural-key/slot aggregates would FIELD_MERGE but the MVP scaffold throws
   * NotImplemented (lite milestone).
   */
  private scanAggregates(
    workSqlite: Database.Database,
    ordered: readonly BackupDomain[],
    backupDb: Database.Database,
    ctx: MergeContext
  ): AggregateDecision[] {
    // Honor an explicit user strategy override. The MVP supports only SKIP conflict
    // resolution for uuid-entity aggregates; FIELD_MERGE/OVERWRITE/RENAME are unsupported
    // — fail loud here rather than silently degrading to skip (which would ignore the
    // user's choice and quietly no-op a RENAME/OVERWRITE request).
    if (ctx.userStrategy !== undefined && ctx.userStrategy !== 'SKIP') {
      throw new MergeStrategyNotImplementedError(`userStrategy ${ctx.userStrategy}`)
    }
    const decisions: AggregateDecision[] = []
    for (const domain of ordered) {
      for (const agg of this.registry.getAggregatesForDomain(domain)) {
        const pkColumns = this.registry.getPrimaryKey(agg.root).columns
        const naturalKey = (agg.identityClass ?? 'uuid-entity') !== 'uuid-entity'
        // natural-key needs FIELD_MERGE (not implemented). Default → fail loud. An explicit
        // SKIP override opts out of FIELD_MERGE → forceSkip every backup row (skip-with-warning
        // semantics; local rows survive = available). Other overrides already rejected above.
        if (naturalKey && ctx.userStrategy !== 'SKIP') {
          throw new MergeStrategyNotImplementedError(`FIELD_MERGE for ${agg.root} (natural-key/slot)`)
        }
        const forceSkip = naturalKey && ctx.userStrategy === 'SKIP'
        // TODO(Stage3): stream via prepare().iterate() instead of .all() to avoid OOM on
        // unbounded roots (TOPICS chat history / translate_history) — spec MAJOR 2. Acceptable
        // for the non-production scaffold (production restore stays fail-closed via BackupService
        // stub; no large archive reaches this engine until Stage 3 wires it in).
        const backupRoots = backupDb.prepare(`SELECT * FROM ${agg.root}`).all() as Record<string, unknown>[]
        for (const backupRow of backupRoots) {
          // backupRow keys are physical (SELECT *); pkColumns are logical → convert.
          const backupPrimaryKey = pkColumns.map((c) => backupRow[physicalColumn(c)] as string | number)
          const exists = forceSkip || this.workHasIdentity(workSqlite, agg, pkColumns, backupPrimaryKey)
          // Honor skippedFileEntryIds — a file_entry root whose blob was not staged MUST be
          // skipped, else the merged DB holds a row + refs pointing at a missing blob.
          const skipped = agg.root === 'file_entry' && ctx.skippedFileEntryIds.has(String(backupPrimaryKey[0]))
          const action = skipped || exists ? 'skip' : 'insert'
          decisions.push({
            aggregate: agg,
            identity: backupPrimaryKey,
            backupPrimaryKey,
            action
          })
        }
      }
    }
    return decisions
  }

  /** True when work.sqlite already has a row with the same PK (uuid-entity identity). */
  private workHasIdentity(
    workSqlite: Database.Database,
    agg: AggregateBoundary,
    pkColumns: readonly string[],
    values: readonly (string | number)[]
  ): boolean {
    // pkColumns are logical (camelCase); convert to physical (snake_case) for SQL.
    const where = pkColumns.map((c) => `${physicalColumn(c)} = ?`).join(' AND ')
    const row = workSqlite.prepare(`SELECT 1 FROM ${agg.root} WHERE ${where} LIMIT 1`).get(...values)
    return row !== undefined
  }

  /**
   * importRows — exhaustive action switch (B3). Each strategy exclusively owns root +
   * member processing; no fall-through. MVP: insert writes root + include members;
   * skip is a no-op. overwrite/field-merge/rename throw NotImplemented.
   */
  private importRows(
    workSqlite: Database.Database,
    ordered: readonly BackupDomain[],
    decisions: readonly AggregateDecision[],
    ctx: MergeContext,
    backupDb: Database.Database,
    identityMap: IdentityMap,
    degradedToSkips: DegradedSkip[]
  ): void {
    for (const decision of decisions) {
      switch (decision.action) {
        case 'skip': {
          // R8 role-aware identityMap: skip = the local row survives = available. Record
          // target availability (local canonical = the existing work PK, which for a
          // uuid-entity equals the backup PK) so the deferred junction phase can resolve
          // cross-domain refs to it. sourceMap stays empty — the backup row was not
          // imported, so it is ineligible as a merge source.
          const pkStr = String(decision.backupPrimaryKey[0])
          setIdentityEntry(identityMap.targetMap, decision.aggregate.root, pkStr, pkStr)
          continue
        }
        case 'insert': {
          this.insertAggregate(workSqlite, decision, ctx, backupDb, identityMap)
          break
        }
        case 'overwrite':
        case 'field-merge':
        case 'rename':
          throw new MergeStrategyNotImplementedError(decision.action)
      }
    }
    // Record any degraded skips (MVP: none yet — RENAME fallback lands at lite milestone).
    void degradedToSkips
    void ordered
  }

  /**
   * Insert an aggregate (root + include members) into work.sqlite. Top-level members are
   * queried by viaColumn = root PK; nested members (parent set) by viaColumn against their
   * PARENT member's inserted ids — so e.g. chat_message_file_ref.sourceId→message resolves
   * against the imported message ids, NOT the topic id (which would silently drop every
   * attachment). Contributors declare a nested member's parent before it. MVP: no identity
   * propagation (uuid-entity INSERT keeps backup PK). FTS-derived columns stripped in insertRow.
   */
  private insertAggregate(
    workSqlite: Database.Database,
    decision: AggregateDecision,
    _ctx: MergeContext,
    backupDb: Database.Database,
    identityMap: IdentityMap
  ): void {
    const { aggregate: agg, backupPrimaryKey } = decision
    // Root row — read from backup, insert into work. PK columns are logical → physical.
    const where = this.registry
      .getPrimaryKey(agg.root)
      .columns.map((c) => `${physicalColumn(c)} = ?`)
      .join(' AND ')
    const rootRow = backupDb.prepare(`SELECT * FROM ${agg.root} WHERE ${where}`).get(...backupPrimaryKey) as
      | Record<string, unknown>
      | undefined
    if (!rootRow) return // root vanished from backup mid-merge — skip defensively
    this.insertRow(workSqlite, agg.root, rootRow)
    // Record source eligibility (inserted) + target availability (inserted) for this root,
    // scoped per endpoint table (R8 + endpoint-disjoint — see IdentityMap).
    const pkStr = String(backupPrimaryKey[0])
    setIdentityEntry(identityMap.sourceMap, agg.root, pkStr, pkStr)
    setIdentityEntry(identityMap.targetMap, agg.root, pkStr, pkStr)

    // Include members — cascade with the root. Track each member's inserted PKs so a
    // nested member (parent set) resolves against its PARENT member's ids, not the root PK.
    // Members are declared parent-first in the contributor schema; viaColumn is logical → physical.
    const members = agg.members ?? []
    const memberPksByTable = new Map<DbTableName, Set<string>>()
    for (const member of members) {
      if (member.cascade !== 'include') continue
      const anchorIds = member.parent
        ? (memberPksByTable.get(member.parent) ?? new Set<string>())
        : new Set(backupPrimaryKey.map(String))
      if (anchorIds.size === 0) continue // parent imported nothing → no nested rows to cascade
      const placeholders = [...anchorIds].map(() => '?').join(',')
      const memberRows = backupDb
        .prepare(`SELECT * FROM ${member.table} WHERE ${physicalColumn(member.viaColumn)} IN (${placeholders})`)
        .all(...anchorIds) as Record<string, unknown>[]
      const memberPkCol = physicalColumn(this.registry.getPrimaryKey(member.table).columns[0])
      for (const memberRow of memberRows) {
        this.insertRow(workSqlite, member.table, memberRow)
        let bucket = memberPksByTable.get(member.table)
        if (!bucket) {
          bucket = new Set()
          memberPksByTable.set(member.table, bucket)
        }
        bucket.add(String(memberRow[memberPkCol]))
      }
    }
  }

  /**
   * Insert a row. Columns not on the work table are dropped (schema-drift defense),
   * and FTS-derived columns (`fts_rowid`, `searchable_text`) are stripped on FTS source
   * tables so the AFTER-INSERT trigger can recompute them — see FTS_SOURCE_TABLES.
   */
  private insertRow(workSqlite: Database.Database, table: DbTableName, row: Record<string, unknown>): void {
    const workColumns = new Set(
      (workSqlite.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name)
    )
    const isFtsSource = FTS_SOURCE_TABLES.has(table)
    const cols = Object.keys(row).filter(
      (c) => workColumns.has(c) && !(isFtsSource && FTS_DERIVED_PHYSICAL_COLUMNS.has(c))
    )
    if (cols.length === 0) return
    const placeholders = cols.map(() => '?').join(', ')
    // INSERT does not return rows — use run(), not all(). Plain INSERT (NOT INSERT OR
    // IGNORE) so any non-PK UNIQUE / CHECK / NOT NULL failure throws + rolls the tx back
    // — fail-closed: the engine never silently drops a row and reports a clean merge.
    // PK idempotency is handled at the decision layer (scanAggregates SKIPs roots work
    // already has), so a plain INSERT here never collides on the PK in normal SKIP/INSERT
    // flow. Stage 3 will swap this for ON CONFLICT DO NOTHING with explicit diagnostics
    // once ConflictResolver/upsert lands (plan (b)).
    workSqlite
      .prepare(`INSERT INTO ${table} (${cols.join(', ')}) VALUES (${placeholders})`)
      .run(...cols.map((c) => row[c]))
  }

  /**
   * Offline consistency check — whole-graph FK integrity + structure. Runs inside the tx
   * (defer_foreign_keys pushes FK enforcement here). A non-empty foreign_key_check or a
   * non-ok integrity_check means work.sqlite is inconsistent and MUST NOT promote.
   *
   * TODO(lite): the spec (import-orchestrator.md) lists additional in-tx checks this MVP
   * omits — FTS integrity-check (`INSERT INTO <fts>(<fts>) VALUES('integrity-check',1)` +
   * row-count parity), app_state preservation assert, and dangling file_ref detection.
   * Track via the FtsCentralHelper / after-commit FS verify stages.
   */
  private runConsistencyCheck(workSqlite: Database.Database): void {
    const fkViolations = workSqlite.pragma('foreign_key_check') as unknown[]
    if (fkViolations.length > 0) {
      throw new MergeConsistencyCheckError(`foreign_key_check returned ${fkViolations.length} violations`)
    }
    // `{ simple: true }` returns the first cell as a bare value (string 'ok' when
    // the DB is consistent). Any other value means structural corruption — work.sqlite
    // MUST NOT promote.
    const integrity = workSqlite.pragma('integrity_check', { simple: true })
    if (integrity !== 'ok') {
      throw new MergeConsistencyCheckError(`integrity_check: ${JSON.stringify(integrity)}`)
    }
  }
}
