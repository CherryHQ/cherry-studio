// MergeEngine — detached restore import pipeline (plan (b)).
//
// Merges backup rows into a detached work.sqlite (VACUUM INTO copy of live) inside one
// synchronous better-sqlite3 transaction. Scope: backfill-when-absent + FIELD_MERGE on
// natural-key conflict (column merge keeping local row+PK) / SKIP on uuid-entity conflict,
// member cascade (uniqueMergeRules for per-member conflict), the global junction phase,
// dangling-ref repair (onDelete set-null → SET NULL; cascade/restrict/no-action → prune,
// with composite partial-NULL), FTS5 rebuild backstop, message.data fileEntryId blob
// disclosure, and offline FK/integrity/FTS/app_state consistency checks.
//
// Conflict semantics (§3): uuid-entity → SKIP (local wins). Natural-key/slot → FIELD_MERGE
// (local API keys kept; backup fills SQL NULL / policy-empty columns; members merged by
// uniqueMergeRules). Settings-class preference/note keep conflictDefault SKIP.
// OVERWRITE / RENAME still throw NotImplemented (fail-loud).
//
// Phase order in mergeBackupIntoWork: importRows → importAllJunctionRows →
// importPolymorphicAssociationRows (entity_tag; not a junction — see polymorphicAssociationDeriver)
// → repairDanglingRefs → discloseFileIdSoftRefs → FTS rebuild → consistency check.
//
// See `docs/references/backup/backup-architecture.md` §3/§9.

import { loggerService } from '@logger'
import type { AggregateBoundary, FieldMergePolicy, ReadonlyBackupRegistry } from '@main/data/db/backup/contributorTypes'
import type { DbTableName } from '@main/data/db/backup/dbSchemaRefs'
import { DB_FTS_VIRTUAL_TABLES, DB_UNIQUE_KEYS } from '@main/data/db/backup/dbSchemaRefs'
import type { BackupDomain } from '@main/data/db/backup/domains'
import type { DbType } from '@main/data/db/types'
import type { EntityType } from '@shared/data/types/entityType'
import Database from 'better-sqlite3'

import { assertFtsIntegrity, rebuildFts } from './ftsCentral'
import { deriveJunctionDescriptors } from './junctionDeriver'
import { isPlatformSpecificPreferenceKey } from './platformSpecificKeyMatch'
import {
  derivePolymorphicAssociationDescriptors,
  POLYMORPHIC_ENTITY_TYPE_ROOT_TABLE
} from './polymorphicAssociationDeriver'
import type { AggregateDecision, DegradedSkip, IdentityMap, MergeContext, MergeResult } from './types'

const logger = loggerService.withContext('MergeEngine')

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

/** Record-separator for degradedToSkips aggregation keys (must not appear in table names). */
const DEGRADE_KEY_SEP = '\x1e'

/**
 * Parse a SQLite cell that may already be a JS value (drizzle) or a JSON text string
 * (raw better-sqlite3 SELECT *). Returns the logical value for emptiness checks.
 */
const parseMaybeJson = (value: unknown): unknown => {
  if (typeof value !== 'string') return value
  const trimmed = value.trim()
  if (!trimmed) return value
  if (trimmed[0] !== '{' && trimmed[0] !== '[') return value
  try {
    return JSON.parse(trimmed) as unknown
  } catch {
    return value
  }
}

/**
 * Default "empty" for FIELD_MERGE fill: SQL NULL only. '' / '{}' / '[]' are explicit
 * empty values and keep local unless a fieldMergePolicy widens the rule.
 */
const isSqlNull = (value: unknown): boolean => value === null || value === undefined

/**
 * remote-fills-local-empty: NULL, '', [], {}. Objects with any non-empty leaf
 * (e.g. seeded authConfig `{type:'iam-gcp',project:''}`) are NOT empty — use
 * deep-merge for those columns instead of whole-cell remote-fills-local-empty.
 */
const isEmptyForRemoteFill = (value: unknown): boolean => {
  if (isSqlNull(value)) return true
  if (value === '') return true
  const parsed = parseMaybeJson(value)
  if (parsed === '') return true
  if (Array.isArray(parsed)) return parsed.length === 0
  if (parsed && typeof parsed === 'object') {
    const entries = Object.entries(parsed as Record<string, unknown>)
    if (entries.length === 0) return true
    return entries.every(([, v]) => v === null || v === undefined || v === '')
  }
  return false
}

/**
 * Leaf emptiness for deep-merge sub-fields (null / '' / [] / {}).
 * Nested objects recurse: `{privateKey:'',clientEmail:''}` is empty (all leaves empty).
 * Arrays stay length===0 (no element-wise emptiness). Cycle / depth-cap safe.
 */
const isEmptyMergeLeaf = (value: unknown, visited: Set<object> = new Set(), depth = 0): boolean => {
  if (isSqlNull(value) || value === '') return true
  if (Array.isArray(value)) return value.length === 0
  if (value && typeof value === 'object') {
    // Depth cap: treat as non-empty so we never falsely classify as seeder skeleton.
    if (depth > 32) return false
    const obj = value
    if (visited.has(obj)) return true // cycle already walked — do not block all-empty
    visited.add(obj)
    const entries = Object.entries(value as Record<string, unknown>)
    if (entries.length === 0) return true
    return entries.every(([, v]) => isEmptyMergeLeaf(v, visited, depth + 1))
  }
  return false
}

/**
 * Seeder / placeholder authConfig: non-empty `type` discriminator + all other fields empty
 * (including nested credential shells like `{privateKey:'',clientEmail:''}`).
 * Used to decide whether a type-mismatched deep-merge may take the backup whole-cell.
 */
const isDiscriminatorSkeleton = (obj: Record<string, unknown>): boolean => {
  const type = obj.type
  if (typeof type !== 'string' || type.length === 0) return false
  for (const [k, v] of Object.entries(obj)) {
    if (k === 'type') continue
    if (!isEmptyMergeLeaf(v)) return false
  }
  return true
}

type DeepMergeResult = {
  value: unknown
  /** Local kept because authConfig-like `type` conflicted and local was not a skeleton. */
  typeConflict?: { localType: string; backupType: string }
}

/**
 * Recursive deep-merge for FIELD_MERGE `deep-merge` strategy.
 * Local non-empty leaves win; local null/''/empty sub-fields take backup.
 * Arrays are treated as leaves (no element-wise merge).
 *
 * Discriminated unions (authConfig `type`): never hybrid-merge across different types.
 * - same type → recursive field merge
 * - different type + local is seeder skeleton → backup whole-cell (restore auth mode)
 * - different type + local has credentials → keep local + typeConflict disclosure
 * Nested typeConflict (e.g. credentials.type) propagates to the parent result.
 */
const deepMergeJson = (local: unknown, backup: unknown): DeepMergeResult => {
  const localP = parseMaybeJson(local)
  const backupP = parseMaybeJson(backup)
  if (isEmptyForRemoteFill(localP) || isSqlNull(localP)) return { value: backupP }
  if (
    localP &&
    typeof localP === 'object' &&
    !Array.isArray(localP) &&
    backupP &&
    typeof backupP === 'object' &&
    !Array.isArray(backupP)
  ) {
    const localObj = localP as Record<string, unknown>
    const backupObj = backupP as Record<string, unknown>
    const localType = localObj.type
    const backupType = backupObj.type
    if (typeof localType === 'string' && typeof backupType === 'string' && localType !== backupType) {
      if (isDiscriminatorSkeleton(localObj)) {
        return { value: backupP }
      }
      return { value: localP, typeConflict: { localType, backupType } }
    }
    const result: Record<string, unknown> = { ...localObj }
    let nestedConflict: DeepMergeResult['typeConflict']
    for (const [k, bv] of Object.entries(backupObj)) {
      const lv = result[k]
      if (lv && typeof lv === 'object' && !Array.isArray(lv) && bv && typeof bv === 'object' && !Array.isArray(bv)) {
        const nested = deepMergeJson(lv, bv)
        result[k] = nested.value
        if (nested.typeConflict && !nestedConflict) {
          nestedConflict = nested.typeConflict
        }
      } else if (isEmptyMergeLeaf(lv)) {
        result[k] = bv
      }
      // else keep local non-empty leaf
    }
    return { value: result, typeConflict: nestedConflict }
  }
  return { value: localP }
}

/** Persist merged JSON matching how the column was stored (text vs object). */
const serializeMergedCell = (merged: unknown, localVal: unknown, backupVal: unknown): unknown => {
  if (typeof localVal === 'string' || typeof backupVal === 'string') {
    return typeof merged === 'string' ? merged : JSON.stringify(merged ?? null)
  }
  return merged
}

const cellEqualForMerge = (a: unknown, b: unknown): boolean => {
  if (Object.is(a, b)) return true
  try {
    return JSON.stringify(parseMaybeJson(a)) === JSON.stringify(parseMaybeJson(b))
  } catch {
    return false
  }
}

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
      const decisions = this.scanAggregates(workSqlite, ordered, backupDb, ctx)
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
        // Polymorphic association phase (A1) — entity_tag (1 owning FK + soft polymorphic
        // entityId). Runs AFTER junctions so tag + entity-root identityMap.targetMap entries
        // are populated; BEFORE repair so rewritten rows are not misread as dangling.
        // Not folded into junctionDeriver (junctions require ≥2 kind:'junction' refs).
        this.importPolymorphicAssociationRows(workSqlite, ctx.domains, backupDb, identityMap, degradedToSkips)
        // Dangling-ref repair — imported rows may reference targets that exist in neither
        // work nor this import (e.g. a conflicted natural-key row surviving locally under a
        // DIFFERENT PK — the identity-propagation milestone rewrites those FKs; until then:
        // nullable FK → SET NULL, NOT NULL FK → prune the row, both disclosed). The base was
        // asserted FK-clean pre-merge, so every repair touches merge-inserted rows only.
        this.repairDanglingRefs(workSqlite, degradedToSkips)
        // Soft-ref disclosure: message.data fileEntryId blobs not in stagedFileEntryIds
        // (DB-only restore → empty set → every attachment disclosed).
        this.discloseFileIdSoftRefs(workSqlite, ctx, degradedToSkips)
        // FTS rebuild backstop — whole-index resync after the bulk import (single-row triggers
        // can't backstop it; skipped rows / fts_rowid collisions leave stale indexes otherwise).
        rebuildFts(workSqlite)
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
   * uuid-entity: conflict → SKIP. natural-key/slot: absent → INSERT (backfill); present →
   * FIELD_MERGE (default) or SKIP (settings-class preference/note conflictDefault).
   */
  private scanAggregates(
    workSqlite: Database.Database,
    ordered: readonly BackupDomain[],
    backupDb: Database.Database,
    ctx: MergeContext
  ): AggregateDecision[] {
    // Explicit OVERWRITE/RENAME still unsupported — fail loud. FIELD_MERGE (and omit /
    // SKIP) are implemented.
    if (ctx.userStrategy === 'OVERWRITE' || ctx.userStrategy === 'RENAME') {
      throw new MergeStrategyNotImplementedError(`userStrategy ${ctx.userStrategy}`)
    }
    const forceSkip = ctx.userStrategy === 'SKIP'
    // PREFERENCES platformSpecificKeys — exclude cross-platform keys on backfill (§6.1).
    const platformSpecificKeys =
      this.registry.getPolicy('PREFERENCES').platformSpecificKeys ?? ([] as readonly string[])
    // Lite archives stage zero Notes bodies — skip every note overlay (§3.5).
    const skipAllNotes = ctx.includeFiles === false
    const decisions: AggregateDecision[] = []
    for (const domain of ordered) {
      for (const agg of this.registry.getAggregatesForDomain(domain)) {
        const pkColumns = this.registry.getPrimaryKey(agg.root).columns
        const naturalKey = (agg.identityClass ?? 'uuid-entity') !== 'uuid-entity'
        const conflictDefault = agg.conflictDefault ?? (naturalKey ? 'FIELD_MERGE' : 'SKIP')
        // TODO(Stage3): stream via prepare().iterate() instead of .all() to avoid OOM on
        // unbounded roots (TOPICS chat history / translate_history) — spec MAJOR 2.
        const backupRoots = backupDb.prepare(`SELECT * FROM ${quoteIdent(agg.root)}`).all() as Record<string, unknown>[]
        // pin is polymorphic (no FK) — skip rows whose entityType maps to a domain
        // outside this restore (e.g. lite archive with knowledge pins but KNOWLEDGE stripped).
        const pinEntityMap =
          agg.root === 'pin' ? this.registry.getSchema('TAGS_GROUPS').polymorphicEntityMap : undefined
        for (const backupRow of backupRoots) {
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
          // Lite: no Notes bodies in the archive — never import note overlays (§3.5).
          if (skipAllNotes && agg.root === 'note') {
            decisions.push({
              aggregate: agg,
              identity: backupPrimaryKey,
              backupPrimaryKey,
              localCanonicalPrimaryKey: undefined,
              action: 'skip'
            })
            continue
          }
          // Cross-platform preference keys must not backfill onto a fresh target (§6.1).
          if (agg.root === 'preference' && platformSpecificKeys.length > 0) {
            const prefKey = String(backupRow[physicalColumn('key')] ?? '')
            if (isPlatformSpecificPreferenceKey(prefKey, platformSpecificKeys)) {
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
            // file_entry expression UNIQUE lower(external_path) — not in DB_UNIQUE_KEYS.
            if (localCanonicalPrimaryKey === undefined && agg.root === 'file_entry') {
              localCanonicalPrimaryKey = this.findLocalByExternalPath(workSqlite, backupRow)
            }
          }
          const exists = localCanonicalPrimaryKey !== undefined
          const skippedBlob = agg.root === 'file_entry' && ctx.skippedFileEntryIds.has(String(backupPrimaryKey[0]))
          let action: AggregateDecision['action'] = 'insert'
          if (skippedBlob) {
            action = 'skip'
          } else if (exists) {
            if (forceSkip || !naturalKey || conflictDefault === 'SKIP') {
              action = 'skip'
            } else {
              action = 'field-merge'
            }
          }
          decisions.push({
            aggregate: agg,
            identity: backupPrimaryKey,
            backupPrimaryKey,
            localCanonicalPrimaryKey,
            action
          })
        }
      }
    }
    return decisions
  }

  /** file_entry lower(external_path) conflict fold (expression UNIQUE not in DB_UNIQUE_KEYS). */
  private findLocalByExternalPath(
    workSqlite: Database.Database,
    backupRow: Record<string, unknown>
  ): readonly (string | number)[] | undefined {
    const ext = backupRow['external_path']
    if (ext === null || ext === undefined || ext === '') return undefined
    const row = this.prepareCached(
      workSqlite,
      'sel:file_entry:lower_ext',
      `SELECT id FROM ${quoteIdent('file_entry')} WHERE lower(external_path) = lower(?) LIMIT 1`
    ).get(ext) as { id: string } | undefined
    return row ? [row.id] : undefined
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
   * member processing; no fall-through. insert writes root + include members; field-merge
   * column-merges the local root + runs the member loop; skip is identityMap-only;
   * overwrite/rename throw NotImplemented.
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
          this.insertAggregate(workSqlite, decision, ctx, backupDb, identityMap, degradedToSkips)
          break
        }
        case 'field-merge': {
          this.fieldMergeAggregate(workSqlite, decision, backupDb, identityMap, degradedToSkips)
          break
        }
        case 'overwrite':
        case 'rename':
          throw new MergeStrategyNotImplementedError(decision.action)
      }
    }
    void ordered
  }

  /**
   * FIELD_MERGE an aggregate root into its local survivor, then run the member loop
   * (uniqueMergeRules / PK / secondary UNIQUE → merge or INSERT).
   */
  private fieldMergeAggregate(
    workSqlite: Database.Database,
    decision: AggregateDecision,
    backupDb: Database.Database,
    identityMap: IdentityMap,
    degradedToSkips: DegradedSkip[]
  ): void {
    const { aggregate: agg, backupPrimaryKey, localCanonicalPrimaryKey } = decision
    if (localCanonicalPrimaryKey === undefined) return
    const pkColumns = this.registry.getPrimaryKey(agg.root).columns
    const whereBackup = pkColumns.map((c) => `${quoteIdent(physicalColumn(c))} = ?`).join(' AND ')
    const backupRoot = backupDb
      .prepare(`SELECT * FROM ${quoteIdent(agg.root)} WHERE ${whereBackup}`)
      .get(...backupPrimaryKey) as Record<string, unknown> | undefined
    if (!backupRoot) return

    const domain = this.registry.getTableOwner(agg.root)
    const policies =
      domain === 'excluded' || domain === 'infrastructure'
        ? []
        : (this.registry.getPolicy(domain).fieldMergePolicies ?? []).filter((p) => p.table === agg.root)
    const exclude = new Set<string>([...pkColumns, ...(agg.identityKey ?? [])])
    this.fieldMergeRow(
      workSqlite,
      agg.root,
      pkColumns,
      localCanonicalPrimaryKey,
      backupRoot,
      exclude,
      policies,
      degradedToSkips
    )

    const localPk = String(localCanonicalPrimaryKey[0])
    const backupPk = String(backupPrimaryKey[0])
    setIdentityEntry(identityMap.sourceMap, agg.root, backupPk, localPk)
    setIdentityEntry(identityMap.targetMap, agg.root, backupPk, localPk)

    this.mergeIncludeMembers(workSqlite, decision, backupDb, identityMap, /*fieldMergeRoot*/ true, degradedToSkips)
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
    identityMap: IdentityMap,
    degradedToSkips: DegradedSkip[]
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

    this.mergeIncludeMembers(workSqlite, decision, backupDb, identityMap, /*fieldMergeRoot*/ false, degradedToSkips)
  }

  /**
   * Include-member cascade for insert + field-merge. Absent members INSERT (keep backup PK);
   * conflicting members FIELD_MERGE by uniqueMergeRules / PK / secondary UNIQUE.
   */
  private mergeIncludeMembers(
    workSqlite: Database.Database,
    decision: AggregateDecision,
    backupDb: Database.Database,
    identityMap: IdentityMap,
    fieldMergeRoot: boolean,
    degradedToSkips: DegradedSkip[]
  ): void {
    const { aggregate: agg, backupPrimaryKey } = decision
    const domain = this.registry.getTableOwner(agg.root)
    const policy = domain === 'excluded' || domain === 'infrastructure' ? undefined : this.registry.getPolicy(domain)
    const uniqueRules = policy?.uniqueMergeRules ?? []
    const allFieldPolicies = policy?.fieldMergePolicies ?? []

    const members = agg.members ?? []
    const memberPksByTable = new Map<DbTableName, Set<string>>()
    for (const member of members) {
      if (member.cascade !== 'include') continue
      const anchorIds = member.parent
        ? (memberPksByTable.get(member.parent) ?? new Set<string>())
        : new Set(backupPrimaryKey.map(String))
      if (anchorIds.size === 0) {
        // Nested member whose parent member produced no anchors (parent skipped / empty /
        // not yet inserted) — previously a silent continue. Disclose orphan nested rows
        // in backup that point at a missing parent (count = actual skipped rows, not 1).
        if (member.parent) {
          const viaPhys = physicalColumn(member.viaColumn)
          const parentPkPhys = physicalColumn(this.registry.getPrimaryKey(member.parent).columns[0])
          const skipped = backupDb
            .prepare(
              `SELECT COUNT(*) AS c FROM ${quoteIdent(member.table)} nested
               WHERE nested.${quoteIdent(viaPhys)} IS NOT NULL
                 AND NOT EXISTS (
                   SELECT 1 FROM ${quoteIdent(member.parent)} parent
                   WHERE parent.${quoteIdent(parentPkPhys)} = nested.${quoteIdent(viaPhys)}
                 )`
            )
            .get() as { c: number }
          const reason = `nested member skipped: parent member '${member.parent}' produced no anchor ids (parent not imported or empty)`
          // Dedupe: orphan count is global to the backup nested table.
          const already = degradedToSkips.some((d) => d.table === member.table && d.reason === reason)
          if (!already && skipped.c > 0) {
            degradedToSkips.push({ table: member.table, count: skipped.c, reason })
          }
        }
        continue
      }
      const placeholders = [...anchorIds].map(() => '?').join(',')
      const memberRows = backupDb
        .prepare(
          `SELECT * FROM ${quoteIdent(member.table)} WHERE ${quoteIdent(physicalColumn(member.viaColumn))} IN (${placeholders})`
        )
        .all(...anchorIds) as Record<string, unknown>[]
      const memberPkCols = this.registry.getPrimaryKey(member.table).columns
      const memberPkColPhys = physicalColumn(memberPkCols[0])
      const rule = uniqueRules.find((r) => r.table === member.table)
      const memberPolicies = allFieldPolicies.filter((p) => p.table === member.table)

      for (const memberRow of memberRows) {
        let localPk: readonly (string | number)[] | undefined
        if (rule) {
          const values: (string | number)[] = []
          let missing = false
          for (const c of rule.uniqueColumns) {
            const v = memberRow[physicalColumn(c)]
            if (v === null || v === undefined) {
              missing = true
              break
            }
            values.push(v as string | number)
          }
          localPk = missing
            ? undefined
            : this.selectLocalPkByColumns(workSqlite, member.table, memberPkCols, rule.uniqueColumns, values)
        } else {
          const backupMemberPk = memberPkCols.map((c) => memberRow[physicalColumn(c)] as string | number)
          const wherePk = memberPkCols.map((c) => `${quoteIdent(physicalColumn(c))} = ?`).join(' AND ')
          const hit = this.prepareCached(
            workSqlite,
            `has:${member.table}:${wherePk}`,
            `SELECT 1 FROM ${quoteIdent(member.table)} WHERE ${wherePk} LIMIT 1`
          ).get(...backupMemberPk)
          if (hit) {
            localPk = backupMemberPk
          } else {
            localPk = this.findLocalBySecondaryUnique(workSqlite, member.table, memberPkCols, memberRow)
          }
        }

        if (localPk !== undefined && (fieldMergeRoot || rule)) {
          const exclude = new Set<string>([...memberPkCols, ...(rule?.uniqueColumns ?? [])])
          this.fieldMergeRow(
            workSqlite,
            member.table,
            memberPkCols,
            localPk,
            memberRow,
            exclude,
            memberPolicies,
            degradedToSkips
          )
          setIdentityEntry(identityMap.sourceMap, member.table, String(memberRow[memberPkColPhys]), String(localPk[0]))
          setIdentityEntry(identityMap.targetMap, member.table, String(memberRow[memberPkColPhys]), String(localPk[0]))
        } else if (localPk !== undefined) {
          // PK/secondary collide on insert path without field-merge root — keep local (skip insert).
          setIdentityEntry(identityMap.targetMap, member.table, String(memberRow[memberPkColPhys]), String(localPk[0]))
        } else {
          this.insertRow(workSqlite, member.table, memberRow)
          const id = String(memberRow[memberPkColPhys])
          setIdentityEntry(identityMap.sourceMap, member.table, id, id)
          setIdentityEntry(identityMap.targetMap, member.table, id, id)
        }

        let bucket = memberPksByTable.get(member.table)
        if (!bucket) {
          bucket = new Set()
          memberPksByTable.set(member.table, bucket)
        }
        // Nested members still resolve against BACKUP parent ids (backup SELECT anchors).
        bucket.add(String(memberRow[memberPkColPhys]))
      }
    }
  }

  /**
   * Column-level FIELD_MERGE into an existing local row. Excludes PK/identity columns.
   * Default fill = SQL NULL only; per-column fieldMergePolicies may widen
   * (remote-fills-local-empty / deep-merge).
   */
  private fieldMergeRow(
    workSqlite: Database.Database,
    table: DbTableName,
    pkColumns: readonly string[],
    localPk: readonly (string | number)[],
    backupRow: Record<string, unknown>,
    excludeLogical: ReadonlySet<string>,
    policies: readonly FieldMergePolicy[],
    degradedToSkips: DegradedSkip[]
  ): void {
    const workColumns = this.getWorkColumns(workSqlite, table)
    const where = pkColumns.map((c) => `${quoteIdent(physicalColumn(c))} = ?`).join(' AND ')
    const localRow = this.prepareCached(
      workSqlite,
      `sel:${table}:fm:${where}`,
      `SELECT * FROM ${quoteIdent(table)} WHERE ${where}`
    ).get(...localPk) as Record<string, unknown> | undefined
    if (!localRow) return

    const policyByPhys = new Map<string, FieldMergePolicy>()
    for (const p of policies) policyByPhys.set(physicalColumn(p.column), p)

    const sets: string[] = []
    const values: unknown[] = []
    for (const phys of Object.keys(backupRow)) {
      if (!workColumns.has(phys)) continue
      if (FTS_SOURCE_TABLES.has(table) && FTS_DERIVED_PHYSICAL_COLUMNS.has(phys)) continue
      // Reverse physical→logical for exclude set (identityKey/PK are logical).
      const logicalGuess = phys.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())
      if (excludeLogical.has(logicalGuess) || [...excludeLogical].some((l) => physicalColumn(l) === phys)) {
        continue
      }
      const localVal = localRow[phys]
      const backupVal = backupRow[phys]
      const policy = policyByPhys.get(phys)
      let nextVal: unknown | undefined
      if (!policy || policy.strategy === 'remote-fills-local-null') {
        if (isSqlNull(localVal) && !isSqlNull(backupVal)) nextVal = backupVal
      } else if (policy.strategy === 'remote-fills-local-empty') {
        if (isEmptyForRemoteFill(localVal) && !isEmptyForRemoteFill(backupVal)) nextVal = backupVal
      } else if (policy.strategy === 'deep-merge') {
        const { value: merged, typeConflict } = deepMergeJson(localVal, backupVal)
        if (typeConflict) {
          degradedToSkips.push({
            table,
            count: 1,
            reason: `deep-merge type conflict kept local ('${typeConflict.localType}' vs backup '${typeConflict.backupType}')`
          })
        }
        const serialized = serializeMergedCell(merged, localVal, backupVal)
        if (!cellEqualForMerge(serialized, localVal)) nextVal = serialized
      } else if (policy.strategy === 'local-priority') {
        // Not implemented: keep null-only so we never silently overwrite non-null local.
        logger.warn('fieldMergePolicy local-priority not implemented; falling back to remote-fills-local-null', {
          table,
          column: phys
        })
        if (isSqlNull(localVal) && !isSqlNull(backupVal)) nextVal = backupVal
      }
      if (nextVal === undefined) continue
      sets.push(`${quoteIdent(phys)} = ?`)
      values.push(nextVal)
    }
    if (sets.length === 0) return
    values.push(...localPk)
    this.prepareCached(
      workSqlite,
      `upd:${table}:${sets.join(',')}:${where}`,
      `UPDATE ${quoteIdent(table)} SET ${sets.join(', ')} WHERE ${where}`
    ).run(...values)
  }

  /**
   * Disclose message.data soft refs whose fileEntryId blob was not staged.
   * DB-only restore passes empty stagedFileEntryIds → every attachment disclosed.
   */
  private discloseFileIdSoftRefs(
    workSqlite: Database.Database,
    ctx: MergeContext,
    degradedToSkips: DegradedSkip[]
  ): void {
    const hasMessage =
      workSqlite.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='message'").get() !== undefined
    if (!hasMessage) return
    const staged = ctx.stagedFileEntryIds
    let missing = 0
    const rows = workSqlite.prepare(`SELECT data FROM ${quoteIdent('message')}`).all() as { data: string | null }[]
    for (const row of rows) {
      if (!row.data) continue
      let parsed: unknown
      try {
        parsed = typeof row.data === 'string' ? JSON.parse(row.data) : row.data
      } catch {
        continue
      }
      const ids = new Set<string>()
      const walk = (node: unknown): void => {
        if (!node || typeof node !== 'object') return
        if (Array.isArray(node)) {
          for (const item of node) walk(item)
          return
        }
        const obj = node as Record<string, unknown>
        for (const [k, v] of Object.entries(obj)) {
          if ((k === 'fileEntryId' || k === 'fileId') && typeof v === 'string' && v.length > 0) {
            ids.add(v)
          } else {
            walk(v)
          }
        }
      }
      walk(parsed)
      for (const id of ids) {
        if (!staged.has(id)) missing++
      }
    }
    if (missing > 0) {
      degradedToSkips.push({
        table: 'message',
        count: missing,
        reason:
          'message attachment blob not staged (fileEntryId missing from stagedFileEntryIds — DB-only restore discloses all)'
      })
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
   * (idempotent re-import). Per-row identity propagation is a no-op for uuid-entity
   * (keeps the backup PK); natural-key FIELD_MERGE already maps backup→local canonical
   * via identityMap — conflict identity propagation for non-deterministic PK FKs remains B1.
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
   * importPolymorphicAssociationRows — polymorphic association phase (A1). Imports
   * entity_tag (registry-derived via derivePolymorphicAssociationDescriptors). For each
   * backup row: route entityType through polymorphicEntityMap → drop when target domain
   * unselected / unmapped; rewrite tagId + entityId via identityMap.targetMap; INSERT
   * ON CONFLICT DO NOTHING (same idempotent semantics as the junction phase). entityType
   * is preserved. Disclosed drops accumulate into degradedToSkips.
   */
  private importPolymorphicAssociationRows(
    workSqlite: Database.Database,
    selectedDomains: readonly BackupDomain[],
    backupDb: Database.Database,
    identityMap: IdentityMap,
    degradedToSkips: DegradedSkip[]
  ): void {
    const selected = new Set(selectedDomains)
    const descriptors = derivePolymorphicAssociationDescriptors(this.registry, selectedDomains)
    const counts = new Map<string, number>()
    const bump = (table: DbTableName, reason: string): void => {
      const key = `${table}${DEGRADE_KEY_SEP}${reason}`
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }

    for (const desc of descriptors) {
      const tagPhys = physicalColumn(desc.tagEndpoint.fkColumn)
      const entityIdPhys = physicalColumn(desc.entityEndpoint.fkColumn)
      const entityTypePhys = physicalColumn(desc.entityEndpoint.entityTypeColumn)
      // TODO(Stage3): stream via prepare().iterate() — same deferral as junction/scanAggregates.
      const rows = backupDb.prepare(`SELECT * FROM ${quoteIdent(desc.table)}`).all() as Record<string, unknown>[]
      for (const row of rows) {
        const entityTypeRaw = String(row[entityTypePhys] ?? '')
        const routeDomain = desc.entityEndpoint.routeBy[entityTypeRaw]
        if (routeDomain === undefined || routeDomain === 'excluded') {
          bump(desc.table, 'polymorphic-entityType-unmapped')
          continue
        }
        if (!selected.has(routeDomain)) {
          bump(desc.table, 'polymorphic-target-domain-not-selected')
          continue
        }
        const rootTable = POLYMORPHIC_ENTITY_TYPE_ROOT_TABLE[entityTypeRaw as EntityType]
        if (rootTable === undefined) {
          bump(desc.table, 'polymorphic-entityType-unmapped')
          continue
        }

        const tagBackupId = String(row[tagPhys])
        const tagCanonical = identityMap.targetMap.get(desc.tagEndpoint.table)?.get(tagBackupId)
        if (tagCanonical === undefined) {
          bump(desc.table, 'polymorphic-tag-target-missing')
          continue
        }

        const entityBackupId = String(row[entityIdPhys])
        const entityCanonical = identityMap.targetMap.get(rootTable)?.get(entityBackupId)
        if (entityCanonical === undefined) {
          bump(desc.table, 'polymorphic-entity-target-missing')
          continue
        }

        // Reuse junction INSERT helper: rewrite tagId + entityId; entityType passes through.
        this.insertJunctionRow(workSqlite, desc.table, row, tagPhys, tagCanonical, entityIdPhys, entityCanonical)
      }
    }

    for (const [key, count] of counts) {
      const [table, reason] = key.split(DEGRADE_KEY_SEP)
      degradedToSkips.push({ table: table as DbTableName, count, reason })
    }
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
   * Repair dangling FKs left by the import (runs in-tx, after the junction + polymorphic
   * association phases, before the FTS rebuild + final consistency check). Decision order
   * (M1 + self-check #2):
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
          const key = `${v.table}${DEGRADE_KEY_SEP}ref to missing ${v.parent} cleared (SET NULL)`
          counts.set(key, (counts.get(key) ?? 0) + 1)
        } else {
          workSqlite.prepare(`DELETE FROM ${quoteIdent(v.table)} WHERE rowid = ?`).run(v.rowid)
          const key = `${v.table}${DEGRADE_KEY_SEP}row pruned (required ${v.parent} target missing)`
          counts.set(key, (counts.get(key) ?? 0) + 1)
        }
        repaired = true
      }
      // Nothing addressable this pass — stop; the final consistency check is the arbiter.
      if (!repaired) break
    }
    for (const [key, count] of counts) {
      const [table, reason] = key.split(DEGRADE_KEY_SEP)
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
    assertFtsIntegrity(workSqlite)
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
