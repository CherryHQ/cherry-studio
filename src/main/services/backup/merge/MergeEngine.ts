// MergeEngine — detached restore import pipeline (plan (b)).
//
// Merges backup rows into a detached work.sqlite (VACUUM INTO copy of live) inside one
// synchronous better-sqlite3 transaction. Scope: backfill-when-absent + SKIP-on-conflict,
// member cascade, the global junction phase (pure junction tables resolved via the
// role-aware identityMap), a dangling-ref repair pass (onDelete set-null → SET NULL on
// nullable FK cols; cascade/restrict/no-action → prune, with composite partial-NULL
// keeping mixed-nullability rows), FTS5 rebuild backstop, and offline
// FK/integrity/FTS/app_state consistency checks.
//
// Conflict semantics: uuid-entity conflicts SKIP (local wins). Natural-key aggregates are
// matched by identityKey — absent locally → INSERT keeping the backup PK (backfill: fresh
// installs get preferences/providers/workspaces back and incoming FKs resolve naturally);
// present locally → SKIP with the LOCAL canonical PK recorded in the identityMap so junction
// rows resolve to it. Field-level merging of conflicting rows (fieldMergePolicies, e.g.
// apiKeys remote-fills-local-empty) is the FIELD_MERGE milestone; until it lands, conflicts
// on FIELD_MERGE-default aggregates are recorded in degradedToSkips (local values win).
// OVERWRITE / RENAME / explicit FIELD_MERGE throw NotImplemented (fail-loud).
//
// See spec `backup-restore-safety/import-orchestrator.md` + plan `cryptic-inventing-toucan.md`.

import type { AggregateBoundary, ReadonlyBackupRegistry } from '@main/data/db/backup/contributorTypes'
import type { DbTableName } from '@main/data/db/backup/dbSchemaRefs'
import { DB_FTS_VIRTUAL_TABLES, DB_UNIQUE_KEYS } from '@main/data/db/backup/dbSchemaRefs'
import type { BackupDomain } from '@main/data/db/backup/domains'
import type { DbType } from '@main/data/db/types'
import type { EntityType } from '@shared/data/types/entityType'
import Database from 'better-sqlite3'

import { FtsCentralHelper } from './FtsCentralHelper'
import { deriveJunctionDescriptors } from './junctionDeriver'
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
// TODO(M7/latent): consecutive capitals (e.g. APIKey) diverge from drizzle snake_case
// (api_key vs a_p_i_key). No merge-path column hits this today — prefer DbColumnEntry.dbName
// once codegen stops duplicating `name` there.
const physicalColumn = (logical: string): string => logical.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`)

/**
 * Quote a physical column identifier for raw SQL. Some physical columns are SQL keywords
 * (user_model.`group`) — unquoted they are a syntax error. Standard SQL double-quotes;
 * embedded quotes doubled (defensive — codegen names never contain them).
 */
const quoteIdent = (name: string): string => `"${name.replace(/"/g, '""')}"`

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
  constructor(private readonly registry: ReadonlyBackupRegistry) {}

  /** Per-merge memo: table → work column Set (from PRAGMA table_info). */
  private workColumnsByTable = new Map<string, Set<string>>()
  /** Per-merge memo: cacheKey → prepared statement (bound to the active workSqlite). */
  private stmtCache = new Map<string, Database.Statement>()

  /**
   * Merge backup rows into work.sqlite. The transaction fn is synchronous
   * (better-sqlite3 rejects Promise callbacks); backupDb is opened read-only and
   * consumed via sync iterators inside the tx.
   */
  async mergeBackupIntoWork(workSqlite: Database.Database, _workDb: DbType, ctx: MergeContext): Promise<MergeResult> {
    const backupDb = new Database(ctx.backupDbPath, { readonly: true })
    try {
      // The repair pass below (repairDanglingRefs) assumes every FK violation it sees was
      // introduced by rows THIS merge inserted, so it can never destroy pre-existing local
      // data. Guarantee that by refusing to merge into a base that is already FK-dirty.
      this.assertBaseFkClean(workSqlite)
      this.workColumnsByTable.clear()
      this.stmtCache.clear()
      const ordered = this.registry.topoSort(ctx.domains)
      const degradedToSkips: DegradedSkip[] = []
      const decisions = this.scanAggregates(workSqlite, ordered, backupDb, ctx, degradedToSkips)
      const identityMap: IdentityMap = { sourceMap: new Map(), targetMap: new Map() }
      // Snapshot app_state keys BEFORE the tx — the merge tx must not add/drop keys. PREFERENCES
      // may UPDATE values (forward-compat), but the key-set is invariant. app_state is ALWAYS_STRIP
      // (backup holds none), so any key-set change is a merge bug. undefined when app_state is absent.
      const appStateSnapshot = this.snapshotAppStateKeys(workSqlite)

      // Synchronous deferred-FK transaction — better-sqlite3 requires a sync callback.
      const run = workSqlite.transaction(() => {
        // Defer FK enforcement to COMMIT (PRAGMA foreign_keys is a documented no-op inside
        // a tx; defer_foreign_keys is tx-scoped). The whole-graph foreign_key_check below
        // validates consistency before COMMIT.
        workSqlite.pragma('defer_foreign_keys = ON')
        this.importRows(workSqlite, ordered, decisions, ctx, backupDb, identityMap, degradedToSkips)
        // Global junction phase — import pure junction tables after all root/member writes,
        // resolving each endpoint via the role-aware identityMap (R8) and cascade-pruning rows
        // whose source was not imported or whose target is unavailable (§5.2).
        this.importAllJunctionRows(workSqlite, ctx.domains, backupDb, identityMap)
        // Dangling-ref repair — imported rows may reference targets that exist in neither
        // work nor this import (e.g. a conflicted natural-key row surviving locally under a
        // DIFFERENT PK — the identity-propagation milestone rewrites those FKs; until then:
        // nullable FK → SET NULL, NOT NULL FK → prune the row, both disclosed). The base was
        // asserted FK-clean pre-merge, so every repair touches merge-inserted rows only.
        this.repairDanglingRefs(workSqlite, degradedToSkips)
        // FTS rebuild backstop — whole-index resync after the bulk import (single-row triggers
        // can't backstop it; skipped rows / fts_rowid collisions leave stale indexes otherwise).
        FtsCentralHelper.rebuild(workSqlite)
        this.runConsistencyCheck(workSqlite, appStateSnapshot)
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
   * uuid-entity aggregates: conflict (work has same PK) → SKIP, else INSERT.
   * natural-key/slot aggregates: matched by identityKey — present locally → SKIP with the
   * local canonical PK recorded (junction resolution + B1 identity propagation); absent →
   * INSERT keeping the backup PK (backfill — incoming FKs resolve naturally). Field-level
   * merging of conflicting rows is the FIELD_MERGE milestone; conflicts on
   * FIELD_MERGE-default aggregates are counted into degradedToSkips (local values win).
   */
  private scanAggregates(
    workSqlite: Database.Database,
    ordered: readonly BackupDomain[],
    backupDb: Database.Database,
    ctx: MergeContext,
    degradedToSkips: DegradedSkip[]
  ): AggregateDecision[] {
    // Honor an explicit user strategy override. Only SKIP conflict resolution is
    // implemented; FIELD_MERGE/OVERWRITE/RENAME are unsupported — fail loud here rather
    // than silently degrading to skip (which would ignore the user's choice and quietly
    // no-op a RENAME/OVERWRITE request). An explicit SKIP means "keep local on conflict";
    // backfill-when-absent still applies (restoring missing rows is not a conflict).
    if (ctx.userStrategy !== undefined && ctx.userStrategy !== 'SKIP') {
      throw new MergeStrategyNotImplementedError(`userStrategy ${ctx.userStrategy}`)
    }
    const decisions: AggregateDecision[] = []
    for (const domain of ordered) {
      for (const agg of this.registry.getAggregatesForDomain(domain)) {
        const pkColumns = this.registry.getPrimaryKey(agg.root).columns
        const naturalKey = (agg.identityClass ?? 'uuid-entity') !== 'uuid-entity'
        // A conflict on a FIELD_MERGE-default aggregate keeps the local row wholesale —
        // that loses backup field values (e.g. credentials only present remotely), so it
        // is a degradation to disclose. conflictDefault 'SKIP' (PREFERENCES/note) makes
        // local-wins the spec'd behavior — not a degradation.
        const fieldMergePending = naturalKey && (agg.conflictDefault ?? 'FIELD_MERGE') !== 'SKIP'
        // TODO(Stage3): stream via prepare().iterate() instead of .all() to avoid OOM on
        // unbounded roots (TOPICS chat history / translate_history) — spec MAJOR 2. Production
        // restore reaches this engine, so large archives exercise the .all() load until
        // Stage 3 streams.
        const backupRoots = backupDb.prepare(`SELECT * FROM ${quoteIdent(agg.root)}`).all() as Record<string, unknown>[]
        let conflictCount = 0
        // pin is polymorphic (no FK) — skip rows whose entityType maps to a domain
        // outside this restore (e.g. lite archive with knowledge pins but KNOWLEDGE stripped).
        const pinEntityMap =
          agg.root === 'pin' ? this.registry.getSchema('TAGS_GROUPS').polymorphicEntityMap : undefined
        for (const backupRow of backupRoots) {
          // backupRow keys are physical (SELECT *); pkColumns are logical → convert.
          const backupPrimaryKey = pkColumns.map((c) => backupRow[physicalColumn(c)] as string | number)
          if (pinEntityMap) {
            const entityType = String(backupRow[physicalColumn('entityType')] ?? '') as EntityType
            const target = pinEntityMap[entityType]
            if (target === undefined || target === 'excluded' || !ctx.domains.includes(target)) {
              decisions.push({
                aggregate: agg,
                identity: backupPrimaryKey,
                backupPrimaryKey,
                localCanonicalPrimaryKey: undefined,
                action: 'skip'
              })
              continue
            }
          }
          // Resolve the local counterpart: natural-key → identityKey match (returns the
          // LOCAL canonical PK, which may differ from the backup PK); uuid-entity → PK
          // match (canonical = backup PK), then secondary UNIQUE (e.g. note(rootPath,path)
          // if ever scanned as uuid-entity) so plain INSERT cannot UNIQUE-abort the merge.
          let localCanonicalPrimaryKey: readonly (string | number)[] | undefined
          if (naturalKey) {
            localCanonicalPrimaryKey = this.findLocalByIdentityKey(workSqlite, agg, pkColumns, backupRow)
            if (
              localCanonicalPrimaryKey === undefined &&
              this.workHasIdentity(workSqlite, agg, pkColumns, backupPrimaryKey)
            ) {
              localCanonicalPrimaryKey = backupPrimaryKey
            }
          } else if (this.workHasIdentity(workSqlite, agg, pkColumns, backupPrimaryKey)) {
            localCanonicalPrimaryKey = backupPrimaryKey
          } else {
            localCanonicalPrimaryKey = this.findLocalBySecondaryUnique(workSqlite, agg.root, pkColumns, backupRow)
          }
          const exists = localCanonicalPrimaryKey !== undefined
          if (exists && fieldMergePending) {
            conflictCount++
          }
          // Honor skippedFileEntryIds — a file_entry root whose blob was not staged MUST be
          // skipped, else the merged DB holds a row + refs pointing at a missing blob.
          const skipped = agg.root === 'file_entry' && ctx.skippedFileEntryIds.has(String(backupPrimaryKey[0]))
          const action = skipped || exists ? 'skip' : 'insert'
          decisions.push({
            aggregate: agg,
            identity: backupPrimaryKey,
            backupPrimaryKey,
            localCanonicalPrimaryKey,
            action
          })
        }
        if (conflictCount > 0) {
          degradedToSkips.push({
            table: agg.root,
            count: conflictCount,
            reason: 'FIELD_MERGE not implemented — conflicting rows kept local values (backup field values not merged)'
          })
        }
      }
    }
    return decisions
  }

  /**
   * Find the LOCAL canonical PK of a natural-key aggregate row by its identityKey.
   * Returns undefined when work has no row under that identityKey. A key tuple
   * containing NULL never matches (`= ?` semantics) — such rows take the insert path
   * and the whole-graph checks remain the arbiter.
   */
  private findLocalByIdentityKey(
    workSqlite: Database.Database,
    agg: AggregateBoundary,
    pkColumns: readonly string[],
    backupRow: Record<string, unknown>
  ): readonly (string | number)[] | undefined {
    const keyColumns = agg.identityKey ?? this.registry.getPrimaryKey(agg.root).columns
    const values: (string | number)[] = []
    for (const c of keyColumns) {
      const v = backupRow[physicalColumn(c)]
      if (v === null || v === undefined) return undefined
      values.push(v as string | number)
    }
    return this.selectLocalPkByColumns(workSqlite, agg.root, pkColumns, keyColumns, values)
  }

  /**
   * uuid-entity secondary UNIQUE fold — when PK differs but a business UNIQUE collides
   * (e.g. note(rootPath,path) if scanned as uuid-entity), SKIP with the LOCAL PK instead
   * of plain-INSERT → UNIQUE abort of the whole restore. Skips fts_rowid-only uniques
   * (local-only, stripped on insert).
   */
  private findLocalBySecondaryUnique(
    workSqlite: Database.Database,
    table: DbTableName,
    pkColumns: readonly string[],
    backupRow: Record<string, unknown>
  ): readonly (string | number)[] | undefined {
    const uniques = DB_UNIQUE_KEYS[table] ?? []
    const pkSet = new Set(pkColumns)
    for (const uk of uniques) {
      if (uk.columns.length === pkColumns.length && uk.columns.every((c) => pkSet.has(c))) continue
      if (uk.columns.every((c) => c === 'ftsRowid')) continue
      const values: (string | number)[] = []
      let missing = false
      for (const c of uk.columns) {
        const v = backupRow[physicalColumn(c)]
        if (v === null || v === undefined) {
          missing = true
          break
        }
        values.push(v as string | number)
      }
      if (missing) continue
      const found = this.selectLocalPkByColumns(workSqlite, table, pkColumns, uk.columns, values)
      if (found !== undefined) return found
    }
    return undefined
  }

  private selectLocalPkByColumns(
    workSqlite: Database.Database,
    table: DbTableName,
    pkColumns: readonly string[],
    keyColumns: readonly string[],
    values: readonly (string | number)[]
  ): readonly (string | number)[] | undefined {
    const where = keyColumns.map((c) => `${quoteIdent(physicalColumn(c))} = ?`).join(' AND ')
    const select = pkColumns.map((c) => quoteIdent(physicalColumn(c))).join(', ')
    const sql = `SELECT ${select} FROM ${quoteIdent(table)} WHERE ${where} LIMIT 1`
    const row = this.prepareCached(workSqlite, `sel:${table}:${where}`, sql).get(...values) as
      | Record<string, unknown>
      | undefined
    if (!row) return undefined
    return pkColumns.map((c) => row[physicalColumn(c)] as string | number)
  }

  /** True when work.sqlite already has a row with the same PK (uuid-entity identity). */
  private workHasIdentity(
    workSqlite: Database.Database,
    agg: AggregateBoundary,
    pkColumns: readonly string[],
    values: readonly (string | number)[]
  ): boolean {
    const where = pkColumns.map((c) => `${quoteIdent(physicalColumn(c))} = ?`).join(' AND ')
    const sql = `SELECT 1 FROM ${quoteIdent(agg.root)} WHERE ${where} LIMIT 1`
    const row = this.prepareCached(workSqlite, `has:${agg.root}:${where}`, sql).get(...values)
    return row !== undefined
  }

  private getWorkColumns(workSqlite: Database.Database, table: DbTableName): Set<string> {
    let cols = this.workColumnsByTable.get(table)
    if (!cols) {
      cols = new Set((workSqlite.pragma(`table_info("${table}")`) as { name: string }[]).map((c) => c.name))
      this.workColumnsByTable.set(table, cols)
    }
    return cols
  }

  private prepareCached(workSqlite: Database.Database, key: string, sql: string): Database.Statement {
    let stmt = this.stmtCache.get(key)
    if (!stmt) {
      stmt = workSqlite.prepare(sql)
      this.stmtCache.set(key, stmt)
    }
    return stmt
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
          // target availability at the LOCAL canonical PK — for a uuid-entity conflict it
          // equals the backup PK; for a natural-key conflict scanAggregates resolved it via
          // identityKey, so junction rows referencing the backup PK land on the LOCAL row.
          // sourceMap stays empty — the backup row was not imported, so it is ineligible
          // as a merge source.
          //
          // No local canonical (a skipped file_entry whose blob was not staged and which
          // work does not hold) → no entry → junction rows referencing it cascade-prune.
          if (decision.localCanonicalPrimaryKey !== undefined) {
            setIdentityEntry(
              identityMap.targetMap,
              decision.aggregate.root,
              String(decision.backupPrimaryKey[0]),
              String(decision.localCanonicalPrimaryKey[0])
            )
          }
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
      .columns.map((c) => `${quoteIdent(physicalColumn(c))} = ?`)
      .join(' AND ')
    const rootRow = backupDb.prepare(`SELECT * FROM ${quoteIdent(agg.root)} WHERE ${where}`).get(...backupPrimaryKey) as
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
        .prepare(
          `SELECT * FROM ${quoteIdent(member.table)} WHERE ${quoteIdent(physicalColumn(member.viaColumn))} IN (${placeholders})`
        )
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
    const workColumns = this.getWorkColumns(workSqlite, table)
    const isFtsSource = FTS_SOURCE_TABLES.has(table)
    const cols = Object.keys(row).filter(
      (c) => workColumns.has(c) && !(isFtsSource && FTS_DERIVED_PHYSICAL_COLUMNS.has(c))
    )
    if (cols.length === 0) return
    const placeholders = cols.map(() => '?').join(', ')
    const quotedCols = cols.map(quoteIdent)
    // INSERT does not return rows — use run(), not all(). Plain INSERT (NOT INSERT OR
    // IGNORE) so any non-PK UNIQUE / CHECK / NOT NULL failure throws + rolls the tx back
    // — fail-closed: the engine never silently drops a row and reports a clean merge.
    // PK idempotency is handled at the decision layer (scanAggregates SKIPs roots work
    // already has), so a plain INSERT here never collides on the PK in normal SKIP/INSERT
    // flow. Stage 3 will swap this for ON CONFLICT DO NOTHING with explicit diagnostics
    // once ConflictResolver/upsert lands (plan (b)).
    // Stmt keyed by table+col list — hoist per distinct shape out of the row loop (N1).
    const sql = `INSERT INTO ${quoteIdent(table)} (${quotedCols.join(', ')}) VALUES (${placeholders})`
    this.prepareCached(workSqlite, `ins:${table}:${cols.join(',')}`, sql).run(...cols.map((c) => row[c]))
  }

  /**
   * importAllJunctionRows — global junction phase (B4). Import pure junction tables (those
   * with 2+ `kind:'junction'` refs, registry-derived — NOT aggregate members, which cascade
   * with their root). Runs AFTER importRows so the role-aware identityMap (R8) is populated.
   *
   * For each junction row: resolve source eligibility (sourceMap — imported this restore?)
   * + target availability (targetMap — imported OR pre-existing local). Either absent →
   * cascade-prune (§5.2: a junction endpoint missing → drop the row, NOT SET NULL). Both
   * present → rewrite both FK cols to their canonical work PKs + ON CONFLICT DO NOTHING
   * (idempotent re-import). Per-row identity propagation is a no-op for uuid-entity (Stage 4
   * keeps the backup PK); the FIELD_MERGE milestone will rewrite natural-key FKs here.
   *
   * Note: chat_message_file_ref / painting_file_ref are NOT imported here — their `sourceId`
   * ref is `kind:'owning'` (not junction), so `deriveJunctionDescriptors` filters them out;
   * they cascade as TOPICS/PAINTINGS include-members via importRows. spec L469/484's
   * skippedFileEntryId guard is therefore unreachable in THIS phase — a future contributor
   * re-classifying file_ref.sourceId as junction (or adding a 2nd junction ref) would need to
   * add the skippedFileEntryId check here.
   */
  private importAllJunctionRows(
    workSqlite: Database.Database,
    selectedDomains: readonly BackupDomain[],
    backupDb: Database.Database,
    identityMap: IdentityMap
  ): void {
    const descriptors = deriveJunctionDescriptors(this.registry, selectedDomains)
    for (const desc of descriptors) {
      const sourcePhys = physicalColumn(desc.sourceEndpoint.fkColumn)
      const targetPhys = physicalColumn(desc.targetEndpoint.fkColumn)
      // TODO(Stage3): stream via prepare().iterate() instead of .all() to avoid OOM on unbounded
      // junction tables (spec L466) — mirrors the scanAggregates deferral. Acceptable for the
      // non-production scaffold (no large archive reaches this engine until Stage 3 wires the spine).
      const rows = backupDb.prepare(`SELECT * FROM ${quoteIdent(desc.table)}`).all() as Record<string, unknown>[]
      for (const row of rows) {
        const sourceBackupId = String(row[sourcePhys])
        const targetBackupId = String(row[targetPhys])
        const sourceCanonical = identityMap.sourceMap.get(desc.sourceEndpoint.table)?.get(sourceBackupId)
        if (sourceCanonical === undefined) continue // source not imported (skip/rename) → prune
        const targetCanonical = identityMap.targetMap.get(desc.targetEndpoint.table)?.get(targetBackupId)
        if (targetCanonical === undefined) continue // target unavailable (unselected / no local) → prune
        this.insertJunctionRow(workSqlite, desc.table, row, sourcePhys, sourceCanonical, targetPhys, targetCanonical)
      }
    }
  }

  /**
   * Insert a junction row with both FK columns rewritten to their canonical work PKs. Other
   * columns pass through (schema-drift guard drops columns not on the work table). ON CONFLICT
   * DO NOTHING = idempotent re-import (spec L470/489 `ON CONFLICT DO NOTHING`) — narrower than
   * `INSERT OR IGNORE`: it still throws on CHECK/NOT NULL failure, so a real constraint error
   * rolls the tx back instead of being silently swallowed.
   */
  private insertJunctionRow(
    workSqlite: Database.Database,
    table: DbTableName,
    row: Record<string, unknown>,
    sourcePhys: string,
    sourceCanonical: string,
    targetPhys: string,
    targetCanonical: string
  ): void {
    const workColumns = this.getWorkColumns(workSqlite, table)
    const cols = Object.keys(row).filter((c) => workColumns.has(c))
    if (cols.length === 0) return
    const values = cols.map((c) => (c === sourcePhys ? sourceCanonical : c === targetPhys ? targetCanonical : row[c]))
    const placeholders = cols.map(() => '?').join(', ')
    const sql = `INSERT INTO ${quoteIdent(table)} (${cols.map(quoteIdent).join(', ')}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`
    this.prepareCached(workSqlite, `junc:${table}:${cols.join(',')}`, sql).run(...values)
  }

  /**
   * Refuse to merge into a base snapshot that already has FK violations. The live DB is
   * FK-consistent by contract; a dirty snapshot means the repair pass could no longer
   * distinguish merge-inserted rows from local rows — fail closed instead.
   */
  private assertBaseFkClean(workSqlite: Database.Database): void {
    const violations = workSqlite.pragma('foreign_key_check') as unknown[]
    if (violations.length > 0) {
      throw new MergeConsistencyCheckError(
        `pre-merge foreign_key_check found ${violations.length} pre-existing violations in the base snapshot — refusing to merge`
      )
    }
  }

  /**
   * Repair dangling FKs left by the import (runs in-tx, after the junction phase, before
   * the FTS rebuild + final consistency check). Decision order (M1 + self-check #2):
   * 1. onDelete SET NULL / SET DEFAULT → SET NULL on nullable FK columns (prune if none).
   * 2. cascade / restrict / no action → DELETE, EXCEPT composite FKs with mixed nullability
   *    (some cols nullable): SET only those nullable cols NULL so SQLite's partial-NULL
   *    rule clears the violation while keeping the row (e.g. knowledge_item.group_id).
   *    A fully-nullable no-action FK (e.g. knowledge_base.embedding_model_id) still prunes —
   *    nullability alone must not override onDelete:'no action'.
   *
   * The base was asserted FK-clean before the merge (assertBaseFkClean), so violations can
   * only involve rows this merge inserted. Post-backfill these repairs are RARE — safety net
   * until identity propagation (B1) rewrites conflict refs to the local canonical PK.
   */
  private repairDanglingRefs(workSqlite: Database.Database, degradedToSkips: DegradedSkip[]): void {
    const MAX_PASSES = 10
    const counts = new Map<string, number>()
    for (let pass = 0; pass < MAX_PASSES; pass++) {
      const violations = workSqlite.pragma('foreign_key_check') as {
        table: string
        rowid: number | bigint | null
        parent: string
        fkid: number
      }[]
      if (violations.length === 0) break
      let repaired = false
      for (const v of violations) {
        // WITHOUT ROWID tables report rowid NULL — not addressable here; the final
        // consistency check throws and rolls the tx back (fail-closed).
        if (v.rowid === null) continue
        const fkList = workSqlite.pragma(`foreign_key_list("${v.table}")`) as {
          id: number
          from: string
          on_delete: string
        }[]
        const fkRows = fkList.filter((f) => f.id === v.fkid)
        const fkColumns = fkRows.map((f) => f.from)
        if (fkColumns.length === 0) continue
        const onDelete = (fkRows[0]?.on_delete ?? 'NO ACTION').toUpperCase()
        const colNullability = workSqlite.pragma(`table_info("${v.table}")`) as {
          name: string
          notnull: number
        }[]
        const nullableCols = fkColumns.filter((c) => colNullability.find((t) => t.name === c)?.notnull === 0)
        const setNullPolicy = onDelete === 'SET NULL' || onDelete === 'SET DEFAULT'
        let setCols: string[] | null = null
        if (setNullPolicy) {
          setCols = nullableCols.length > 0 ? nullableCols : null
        } else if (nullableCols.length > 0 && nullableCols.length < fkColumns.length) {
          // Mixed-nullability composite under cascade/restrict/no-action — partial NULL.
          setCols = nullableCols
        }
        if (setCols) {
          workSqlite
            .prepare(
              `UPDATE ${quoteIdent(v.table)} SET ${setCols.map((c) => `${quoteIdent(c)} = NULL`).join(', ')} WHERE rowid = ?`
            )
            .run(v.rowid)
          const key = `${v.table} ref to missing ${v.parent} cleared (SET NULL)`
          counts.set(key, (counts.get(key) ?? 0) + 1)
        } else {
          workSqlite.prepare(`DELETE FROM ${quoteIdent(v.table)} WHERE rowid = ?`).run(v.rowid)
          const key = `${v.table} row pruned (required ${v.parent} target missing)`
          counts.set(key, (counts.get(key) ?? 0) + 1)
        }
        repaired = true
      }
      // Nothing addressable this pass — stop; the final consistency check is the arbiter.
      if (!repaired) break
    }
    for (const [key, count] of counts) {
      const [table, reason] = key.split(' ')
      degradedToSkips.push({ table: table as DbTableName, count, reason })
    }
  }

  /** Read the app_state key-set (undefined when app_state is absent from work). */
  private snapshotAppStateKeys(work: Database.Database): Set<string> | undefined {
    const exists =
      work.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'app_state'").get() !== undefined
    if (!exists) return undefined
    const rows = work.prepare('SELECT key FROM app_state').all() as { key: string }[]
    return new Set(rows.map((r) => r.key))
  }

  /**
   * Offline consistency check — whole-graph FK integrity + structure + FTS index + app_state
   * key-set. Runs inside the tx (defer_foreign_keys pushes FK enforcement here). Any failure
   * means work.sqlite is inconsistent and MUST NOT promote.
   */
  private runConsistencyCheck(workSqlite: Database.Database, appStateSnapshot: Set<string> | undefined): void {
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
    // FTS5 external-content integrity — throws FtsIntegrityCheckError on a stale/orphaned index
    // (rebuild ran just before this, so a failure here means the rebuild missed an index).
    FtsCentralHelper.integrityCheck(workSqlite)
    // app_state key-set preservation — PREFERENCES may UPDATE values (forward-compat), but a
    // key added/dropped by the merge tx signals corruption (app_state is ALWAYS_STRIP, backup
    // contributes nothing here). undefined snapshot = app_state absent from work → skip.
    if (appStateSnapshot !== undefined) {
      const after = this.snapshotAppStateKeys(workSqlite)
      if (
        after === undefined ||
        after.size !== appStateSnapshot.size ||
        [...after].some((k) => !appStateSnapshot.has(k))
      ) {
        throw new MergeConsistencyCheckError(
          `app_state key-set changed: ${appStateSnapshot.size} → ${after?.size ?? 'absent'}`
        )
      }
    }
  }
}
