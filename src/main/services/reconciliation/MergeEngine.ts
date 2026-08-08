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

import { createHash } from 'node:crypto'
import { posix } from 'node:path'

import { loggerService } from '@logger'
import type {
  AggregateBoundary,
  EntityReference,
  FieldMergePolicy,
  JsonSoftReferencePolicy,
  ReadonlyBackupRegistry
} from '@main/data/db/backup/contributorTypes'
import type { DbTableName } from '@main/data/db/backup/dbSchemaRefs'
import { DB_FOREIGN_KEYS, DB_FTS_VIRTUAL_TABLES, DB_UNIQUE_KEYS } from '@main/data/db/backup/dbSchemaRefs'
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
import type {
  AggregateDecision,
  DegradedSkip,
  IdentityMap,
  MergeContext,
  MergeResult,
  ReconcileDegradationKind
} from './types'

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
 * Separator for serializing a composite key tuple (identity / unique / PK values)
 * into a stable string used as a batch-lookup Map key (B17). Each value is
 * length-prefixed (`len + ':' + val`) before joining on TUPLE_KEY_SEP so a value
 * containing the separator itself cannot blur tuple boundaries — composite-key
 * user text legitimately may contain U+001F (preference scope/key, note path,
 * job_schedule name, …) and a bare join would collide distinct tuples. NULLs are
 * coerced via String() but callers exclude NULL-bearing tuples before lookup — a
 * NULL never matched under `= ?` semantics, so it must never reach the map.
 */
const TUPLE_KEY_SEP = '\x1f'
export const tupleKey = (values: readonly (string | number)[]): string =>
  values
    .map((v) => {
      const s = String(v)
      return `${s.length}:${s}`
    })
    .join(TUPLE_KEY_SEP)

/**
 * Append a short stable suffix to a rebased user-workspace placeholder path so two backup
 * user workspaces sharing a basename do not collide on agent_workspace.path (UNIQUE). The
 * suffix is the first 8 hex chars of sha256(backupId) — stable across re-imports (same backup
 * row → same suffix) so a repeated restore lands on the same host path, and distinct for
 * distinct backup ids. e.g. {root}/proj → {root}/proj-a1b2c3d4.
 */
const disambiguateWorkspacePath = (placeholderPath: string, backupId: string): string => {
  const suffix = createHash('sha256').update(backupId).digest('hex').slice(0, 8)
  return `${placeholderPath}-${suffix}`
}

/**
 * Max bound variables per anchor-id `IN (...)` lookup. Stays far below the bundled
 * SQLite `SQLITE_MAX_VARIABLE_NUMBER` (32766) so a large aggregate — e.g. a Topic with
 * more messages than the limit, whose nested `chat_message_file_ref` member anchors on
 * every message id — cannot fail at prepare() with "too many SQL variables".
 */
const ANCHOR_ID_CHUNK = 500

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

/**
 * Resolve the target table of a declared `EntityReference` from the codegen
 * `DB_FOREIGN_KEYS[ref.table]` fact — the contributor schema's `EntityReference`
 * carries `column` + `referencedDomain` but not `targetTable`. We need the
 * `targetTable` for identity-map keying (and for the intra-domain topo sort).
 */
const resolveReferenceTargetTable = (ref: EntityReference): DbTableName | undefined => {
  const fks = DB_FOREIGN_KEYS[ref.table]
  if (!fks) return undefined
  for (const fk of fks) {
    if (fk.columns.length === 1 && fk.columns[0] === ref.column) return fk.targetTable as DbTableName
  }
  return undefined
}

/**
 * Intra-domain Kahn topological sort of aggregates. Edges are:
 *   (a) `kind:'owning'` cross-aggregate refs whose target is another aggregate root in the
 *       SAME domain — the referenced root must be processed first so its identityMap entry
 *       is available when the referrer's pre-pass writes its own entry.
 *   (b) `required` JSON entity-id soft refs whose targetTable is another aggregate root in
 *       the SAME domain — the target's identityMap must be seeded before the source imports,
 *       or a required entity-id rewrite reports missing and the source row is mis-pruned
 *       (mirrors finalize #10's cross-domain entity-id DAG edge at the intra-domain level).
 *
 * Does NOT sort across domains — `registry.topoSort` already handles that.
 * The implementation is independent of the contributor `aggregates` declaration
 * order (it does not assume any), so contributors may declare aggregates in
 * any order without breaking identity propagation — for BOTH owning FKs and required
 * JSON entity-ids.
 */
const topoSortAggregates = (
  aggregates: readonly AggregateBoundary[],
  intraDomainRefs: ReadonlyMap<DbTableName, readonly EntityReference[]>,
  intraDomainEntityIdEdges: ReadonlyArray<readonly [sourceRoot: DbTableName, targetRoot: DbTableName]> = []
): readonly AggregateBoundary[] => {
  const rootsByTable = new Map<DbTableName, AggregateBoundary>()
  for (const agg of aggregates) rootsByTable.set(agg.root, agg)

  const adj = new Map<DbTableName, DbTableName[]>()
  const inDegree = new Map<DbTableName, number>()
  for (const agg of aggregates) {
    adj.set(agg.root, [])
    inDegree.set(agg.root, 0)
  }
  // Add an edge target → source (target must precede source) iff both are aggregate roots in
  // this domain and distinct. Deduped so an aggregate that both owns a FK to AND carries a
  // required entity-id pointing at the same target adds the edge once (Kahn inDegree must stay
  // balanced with the queue's decrement-per-push).
  const seenEdge = new Set<string>()
  const addEdge = (target: DbTableName, source: DbTableName): void => {
    if (!rootsByTable.has(target) || !rootsByTable.has(source) || target === source) return
    const key = `${target}\0${source}`
    if (seenEdge.has(key)) return
    seenEdge.add(key)
    adj.get(target)!.push(source)
    inDegree.set(source, (inDegree.get(source) ?? 0) + 1)
  }
  for (const agg of aggregates) {
    const refs = intraDomainRefs.get(agg.root) ?? []
    for (const ref of refs) {
      if (ref.kind !== 'owning') continue
      const targetTable = resolveReferenceTargetTable(ref)
      if (targetTable === undefined) continue
      // Edge only between two aggregates in the SAME domain (intra-domain cross-aggregate).
      addEdge(targetTable, agg.root)
    }
  }
  for (const [sourceRoot, targetRoot] of intraDomainEntityIdEdges) {
    addEdge(targetRoot, sourceRoot)
  }
  const queue: DbTableName[] = aggregates.map((a) => a.root).filter((t) => (inDegree.get(t) ?? 0) === 0)
  const sorted: AggregateBoundary[] = []
  const visited = new Set<DbTableName>()
  while (queue.length > 0) {
    const t = queue.shift()!
    if (visited.has(t)) continue
    visited.add(t)
    const agg = rootsByTable.get(t)
    if (agg) sorted.push(agg)
    for (const next of adj.get(t) ?? []) {
      inDegree.set(next, (inDegree.get(next) ?? 0) - 1)
      if (inDegree.get(next) === 0) queue.push(next)
    }
  }
  // Defensive fallback — if a cycle slipped through, append any leftovers in
  // declaration order. (Topo itself was verified at registry finalize; this
  // is a safety net so we never throw inside a merge tx.)
  for (const agg of aggregates) {
    if (!visited.has(agg.root)) sorted.push(agg)
  }
  return sorted
}

/**
 * Group declared cross-aggregate owning refs by source root table, scoped to a
 * single domain. Used to drive the intra-domain topological sort. The current
 * `EntityReference` shape carries a single `column` (not an array) — composite
 * refs are filtered at the schema/FK-fact layer via the
 * `resolveReferenceTargetTable` helper which only matches single-column FKs.
 * Refs whose target is not in `aggregates` are skipped — the topo only orders
 * aggregates that actually reference each other.
 */
const groupIntraDomainOwningRefs = (
  aggregates: readonly AggregateBoundary[],
  domainRefs: readonly EntityReference[]
): ReadonlyMap<DbTableName, readonly EntityReference[]> => {
  const aggRoots = new Set(aggregates.map((a) => a.root))
  const out = new Map<DbTableName, EntityReference[]>()
  for (const ref of domainRefs) {
    if (ref.kind !== 'owning') continue
    const targetTable = resolveReferenceTargetTable(ref)
    if (targetTable === undefined || !aggRoots.has(targetTable)) continue
    let bucket = out.get(ref.table)
    if (!bucket) {
      bucket = []
      out.set(ref.table, bucket)
    }
    bucket.push(ref)
  }
  return out
}

/**
 * In-memory rewrite of a JSON entity-id soft reference through the identityMap.
 *
 * `policy.target === 'entity-id'` rows declare a JSON column whose embedded
 * primary-key must be rewritten to the local canonical PK when the target
 * natural-key aggregate merges under a different PK. Today this covers
 * `agent_channel.workspace` and `job_schedule.jobInputTemplate` — both embed an
 * `AgentSessionWorkspaceSource` discriminated union (`type:'user' | 'system'`)
 * whose `workspaceId` points at `agent_workspace`.
 *
 * The walker is column-specific (per `policy`) — column shapes diverge and a
 * generic recurse would silently mis-rewrite non-id fields. The current
 * `agent_channel.workspace` and `job_schedule.jobInputTemplate` both hold
 * `AgentSessionWorkspaceSource` at the top level; rewrite only the
 * `type==='user'` branch's `workspaceId`. `type==='system'` has no
 * `workspaceId` and is left intact.
 *
 * Returns the rewritten JSON text plus the list of `workspaceId`s that could
 * not be resolved (so the caller can discard the row when `policy.kind === 'required'`).
 */
/**
 * Rewrite embedded entity-ids in a JSON cell via the policy's selectors (B4 generalized).
 * Replaces the prior column-switch helper: each selector declares where the id carrier lives
 * (containerPath, [] = cell root), the id field, and an optional discriminator (only rewrite
 * when carrier[field] === equals, e.g. AgentSessionWorkspaceSource type==='user'). Returns
 * the rewritten text (unchanged if no selector matched) + any ids that could not resolve
 * against the target table's identityMap (required callers discard + disclose on missing).
 */
const rewriteJsonEntityIds = (
  jsonText: string,
  identityMap: IdentityMap,
  policy: JsonSoftReferencePolicy
): { text: string; missing: readonly string[] } => {
  if (policy.targetTable === undefined || policy.selectors === undefined) {
    return { text: jsonText, missing: [] }
  }
  const map = identityMap.targetMap.get(policy.targetTable)
  let parsed: unknown
  try {
    parsed = JSON.parse(jsonText)
  } catch {
    return { text: jsonText, missing: [] }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { text: jsonText, missing: [] }
  }
  let root = parsed as Record<string, unknown>
  const missing: string[] = []
  let changed = false
  for (const selector of policy.selectors) {
    // Walk the container path (mutating copy-on-write so nested carriers preserve siblings).
    const path = selector.containerPath ?? []
    let node: Record<string, unknown> = root
    const lineage: { parent: Record<string, unknown>; key: string }[] = []
    let escaped = false
    for (const seg of path) {
      const child = node[seg]
      if (!child || typeof child !== 'object' || Array.isArray(child)) {
        escaped = true
        break
      }
      lineage.push({ parent: node, key: seg })
      node = child as Record<string, unknown>
    }
    if (escaped) continue
    const container = node
    // Discriminator gate — e.g. only the type='user' branch carries a workspaceId.
    const d = selector.discriminator
    if (d !== undefined && container[d.field] !== d.equals) continue
    const id = container[selector.idField]
    if (typeof id !== 'string' || id.length === 0) continue
    if (map === undefined || map.size === 0) {
      missing.push(id)
      continue
    }
    const canonical = map.get(id)
    if (canonical === undefined) {
      missing.push(id)
      continue
    }
    if (canonical === id) continue
    // Copy-on-write: rewrite the carrier, then rebuild each ancestor so siblings survive.
    let next: Record<string, unknown> = { ...container, [selector.idField]: canonical }
    for (let i = lineage.length - 1; i >= 0; i--) {
      const { parent, key } = lineage[i]
      next = { ...parent, [key]: next }
    }
    root = next
    changed = true
  }
  return changed ? { text: JSON.stringify(root), missing } : { text: jsonText, missing }
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
   * Per-merge flag: whether any FTS source table (message / agent_session_message)
   * received an INSERT / UPDATE / repair DELETE this merge. When false the final
   * whole-index rebuildFts is a no-op (the FTS index content is unchanged), so it is
   * skipped (B18). assertFtsIntegrity in runConsistencyCheck still ALWAYS runs, so a
   * stale index never promotes — only the redundant rebuild is elided.
   */
  private ftsSourceChanged = false
  /**
   * B12: per-merge FIELD_MERGE telemetry. Aggregates table → {columns changed, strategies}
   * so a single internal log line summarizes merge activity. Records ONLY counts and
   * strategy names — NEVER cell values, credentials, or authConfig content. User-visible
   * disclosure (which loss/conflict to surface, whether to name merged columns) is a
   * separate contract owned upstream (owner TBD @0xfullex); this is internal observability only.
   */
  private fieldMergeStats = new Map<string, { columns: number; strategies: Set<string> }>()

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
      this.ftsSourceChanged = false
      this.fieldMergeStats.clear()
      const ordered = this.registry.topoSort(ctx.domains)
      const degradedToSkips: DegradedSkip[] = []
      // scanAggregates stays pure read-only (no identityMap side effects) so existing
      // tests/audit-scripts that diff `degradedToSkips` against an injected empty
      // identityMap keep working — the B1 identityMap is built by the pre-pass below.
      const decisions = this.scanAggregates(workSqlite, ordered, backupDb, ctx)
      const identityMap: IdentityMap = { sourceMap: new Map(), targetMap: new Map() }
      // B1: pre-pass — seed `identityMap.targetMap[rootTable]` for every natural-key
      // FIELD_MERGE decision so cross-aggregate root FK rewrites (R1 P0-1) + JSON
      // entity-id walkers (R1 P0-4) can resolve the target identity before any
      // row is written. Intra-domain topological order is enforced inside the
      // pre-pass so referenced roots are written before referrers, regardless of
      // the contributor `aggregates` declaration order.
      this.buildRootIdentityMap(workSqlite, ordered, decisions, identityMap)
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
        this.importAllJunctionRows(workSqlite, ctx.domains, backupDb, identityMap, degradedToSkips)
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
        // Soft-ref disclosure: message.data fileEntryId blobs not in stagedFileEntryIds,
        // over the messages this restore imported (DB-only restore → empty staged set →
        // every imported attachment disclosed).
        this.discloseFileIdSoftRefs(workSqlite, ctx, identityMap, degradedToSkips)
        // FTS rebuild backstop — whole-index resync only when this merge touched an FTS
        // source table (message / agent_session_message). When no FTS-source row was
        // inserted/updated/repaired the index content is unchanged, so the rebuild is a
        // no-op and is skipped (B18). assertFtsIntegrity in runConsistencyCheck still
        // always runs, so a stale index never promotes — only the redundant rebuild is elided.
        if (this.ftsSourceChanged) rebuildFts(workSqlite)
        this.runConsistencyCheck(workSqlite, appStateSnapshot)
      })
      run()
      // B12: emit aggregated FIELD_MERGE telemetry after a successful commit (never for a
      // rolled-back merge). Counts + strategy names only.
      this.logFieldMergeStats()

      return { degradedToSkips }
    } finally {
      backupDb.close()
    }
  }

  /**
   * Resolve a backup `note` overlay row to its target host identity.
   *
   * The note table stores ABSOLUTE paths in production: `rootPath` = the notes root
   * (OS-raw), `path` = `normalizePathValue(node.externalPath)` — the file-tree builder
   * stores absPath verbatim, the renderer only forward-slash normalizes it. But the
   * restore pipeline's note identity (collectNotesMarkdown → stageNotes → manifest →
   * ResourcePlan.noteAdditions) is keyed by the notesRoot-RELATIVE POSIX path. So a
   * lookup with the absolute `row.path` always misses noteAdditions, and an imported
   * row whose `path` keeps the backup machine's absolute value cannot be joined by
   * the host renderer (which queries with the host's absolute externalPath).
   *
   * This derives the relative key from the backup row's own (rootPath, path) — the
   * tree builder guarantees `path` sits under `rootPath` — looks up noteAdditions,
   * and returns the host-form identity. Both columns are forward-slash normalized so
   * the restored row matches what the renderer writes on Windows.
   *
   * Returns undefined when the body was not staged (noteAdditions miss) → caller SKIPs.
   */
  private resolveNoteOverlayTarget(
    backupRow: Record<string, unknown>,
    noteAdditions: ReadonlyMap<string, string> | undefined
  ): { hostRoot: string; hostPath: string } | undefined {
    if (noteAdditions === undefined || noteAdditions.size === 0) return undefined
    // Forward-slash normalize both columns before deriving the relative key — the
    // backup machine may be Windows (backslash separators) while noteAdditions keys
    // are POSIX. normalizePathValue mirrors the renderer's boundary normalization.
    const normalizePathValue = (p: string): string => p.replace(/\\/g, '/')
    const backupRoot = normalizePathValue(String(backupRow[physicalColumn('rootPath')] ?? ''))
    const backupPath = normalizePathValue(String(backupRow[physicalColumn('path')] ?? ''))
    // Derive the notesRoot-relative key the body was staged under. `path` is the
    // absolute externalPath under `rootPath`; posix.relative yields 'note.md' /
    // 'sub/note.md' (matching collectNotesMarkdown's output).
    const relPath = posix.relative(backupRoot, backupPath)
    if (relPath === '' || relPath.startsWith('../')) return undefined
    const hostRoot = noteAdditions.get(relPath)
    if (hostRoot === undefined) return undefined
    // Rebuild the host absolute externalPath (renderer-joinable) + normalize the
    // host root so both columns come out POSIX regardless of host OS path separators.
    const normalizedHostRoot = normalizePathValue(hostRoot)
    const hostPath = posix.join(normalizedHostRoot, relPath)
    return { hostRoot: normalizedHostRoot, hostPath }
  }

  /**
   * Resolve a backup `agent_workspace` row's path to this host's form (cross-machine rebase).
   *
   * agent_workspace is a natural-key aggregate whose identityKey is `path` (UNIQUE non-PK).
   * `path` stores a MACHINE-SPECIFIC absolute dir:
   *   - system (type='system'): managed, {userData}/Data/Agents/system/{YYYY-MM-DD}/{sessionId}
   *   - user (type='user'): an arbitrary absolute dir the user picked
   *
   * On a cross-machine restore the backup path never byte-matches the host path → identity
   * lookup misses → the backup workspace INSERTs as a DUPLICATE and t4's workspaceId rewrite
   * has no anchor. Rebase the path to the host's managed system-workspaces root BEFORE identity
   * lookup so the portable tail matches:
   *   - system: the /system/{YYYY-MM-DD}/{sessionId} tail → joined under the host root (faithful).
   *   - user: basename → {hostRoot}/{basename} (placeholder; the archive does not carry the
   *     custom dir) + `rebased: true` so the caller discloses content missing on the host.
   *
   * Returns undefined when no rebase applies (no host root / non-absolute path) — the caller
   * leaves the path untouched.
   */
  private resolveWorkspacePathTarget(
    backupRow: Record<string, unknown>,
    hostSystemWorkspacesRoot: string | undefined,
    localUserPaths?: ReadonlySet<string>
  ): { path: string; rebased: boolean } | undefined {
    if (hostSystemWorkspacesRoot === undefined) return undefined
    const normalizePathValue = (p: string): string => p.replace(/\\/g, '/')
    const rawPath = String(backupRow[physicalColumn('path')] ?? '')
    if (!rawPath) return undefined
    const normalized = normalizePathValue(rawPath)
    // normalizeWorkspacePath rejects non-absolute in production; guard defensively so a
    // malformed/legacy relative path is not silently rewritten to a wrong host location.
    // Accept both POSIX absolute (/...) and Windows drive-absolute (C:\... → C:/...).
    const isAbsolute = normalized.startsWith('/') || /^[A-Za-z]:\//.test(normalized)
    if (!isAbsolute) return undefined
    const type = String(backupRow[physicalColumn('type')] ?? 'user')
    const hostRoot = normalizePathValue(hostSystemWorkspacesRoot)
    if (type === 'system') {
      // Extract the portable tail after the managed /system/ segment. The full path is
      // {agentsDataDir}/Agents/system/{YYYY-MM-DD}/{sessionId}; everything after /system/
      // is machine-independent.
      const marker = '/system/'
      const idx = normalized.lastIndexOf(marker)
      if (idx >= 0) {
        const tail = normalized.slice(idx + marker.length)
        if (tail && !tail.startsWith('../')) {
          return { path: posix.join(hostRoot, tail), rebased: false }
        }
      }
      // Malformed system path (no /system/ segment) — preserve the full tail after the
      // managed /Agents/ root so the date+sessionId bucketing survives (basename alone drops
      // the date dir and lets two sibling sessions collide on UNIQUE(path)). Falling back to
      // the whole trailing path keeps the rebase faithful to buildSystemWorkspacePath's
      // {date}/{sessionId} shape without relying on the /system/ marker.
      const agentsMarker = '/Agents/'
      const agentsIdx = normalized.lastIndexOf(agentsMarker)
      const tail = agentsIdx >= 0 ? normalized.slice(agentsIdx + agentsMarker.length) : posix.basename(normalized)
      if (tail && !tail.startsWith('../')) {
        return { path: posix.join(hostRoot, tail), rebased: false }
      }
      return { path: posix.join(hostRoot, posix.basename(normalized)), rebased: false }
    }
    // user workspace: the custom dir isn't carried by the archive. Rebase to a placeholder
    // ONLY when no local workspace already has this path — a same-machine restore keeps the
    // original path so identity lookup still matches (FIELD_MERGE, no duplicate).
    if (localUserPaths !== undefined && localUserPaths.has(normalized)) return undefined
    const base = posix.basename(normalized)
    return { path: posix.join(hostRoot, base), rebased: true }
  }

  /**
   * Rebase every agent_workspace backup row's path to the host form, in place. Used by
   * scanAggregates as a pre-pass over backupRoots so the subsequent identity lookup sees
   * the rebased (host-form) paths. Rows whose path cannot be rebased (no host root /
   * non-absolute) are left untouched.
   *
   * system ws always rebases (managed dir). user ws rebases only when its path is ABSENT
   * from local work.sqlite — a same-machine restore (backup path == a local path) must keep
   * the original path so the identity lookup still matches and FIELD_MERGEs instead of
   * duplicating.
   */
  private rebaseWorkspacePaths(
    backupRoots: Record<string, unknown>[],
    ctx: MergeContext,
    workSqlite: Database.Database,
    rebasedWorkspaceRows: WeakSet<Record<string, unknown>>
  ): void {
    // Collect local user workspace paths once (byte-exact + forward-slash normalized) so a
    // user ws that already exists locally is NOT rebased away from its matching local row.
    const localUserPaths = new Set<string>()
    try {
      const rows = workSqlite.prepare(`SELECT path FROM agent_workspace WHERE type = 'user'`).all() as {
        path: string
      }[]
      const norm = (p: string): string => p.replace(/\\/g, '/')
      for (const r of rows) localUserPaths.add(norm(r.path))
    } catch {
      // table empty / missing — nothing to protect
    }
    // Track rebased user-ws placeholder paths so two backup user workspaces that share a
    // basename (e.g. /home/alice/work/proj + /home/bob/work/proj) do not collapse onto the
    // same {hostRoot}/{basename} — agent_workspace.path is UNIQUE, so a collision would make
    // the second INSERT throw and roll back the ENTIRE merge. On collision, append a short
    // stable suffix derived from the backup row's uuid id (system ws keeps its faithful tail
    // and is never deduped — its /system/{date}/{sessionId} tail is already unique).
    const assignedUserPaths = new Set<string>(localUserPaths)
    for (const row of backupRoots) {
      const target = this.resolveWorkspacePathTarget(row, ctx.hostSystemWorkspacesRoot, localUserPaths)
      if (target !== undefined) {
        let finalPath = target.path
        if (target.rebased) {
          // Disambiguate only user-ws placeholders (system tails are unique by construction).
          if (assignedUserPaths.has(finalPath)) {
            finalPath = disambiguateWorkspacePath(finalPath, String(row[physicalColumn('id')] ?? ''))
          }
          assignedUserPaths.add(finalPath)
          row[physicalColumn('path')] = finalPath
          rebasedWorkspaceRows.add(row)
        } else {
          assignedUserPaths.add(finalPath)
          row[physicalColumn('path')] = finalPath
        }
      }
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
    // t2: tracks agent_workspace backup rows whose path was rebased to a managed placeholder
    // (user ws whose custom dir isn't archived) — set per-domain by rebaseWorkspacePaths,
    // read in the per-row loop to flag disclosure.
    const rebasedWorkspaceRows = new WeakSet<Record<string, unknown>>()
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
        //
        // P1: apply contributor rowScopes at the restore boundary (symmetric with export's
        // applyRowScopes). A shared table (job_schedule) is partitioned across domains by
        // rowScope; backup rows OUTSIDE the owned partition (e.g. non-agent.task
        // job_schedule) are runtime state this restore must not import — otherwise a
        // hand-crafted/legacy archive could inject rows JobScheduleService.listEnabled()
        // would later arm. Reuse the registry's rowScopes so future shared tables are
        // covered automatically.
        const rootScope = this.registry
          .getSchema(domain)
          .rowScopes?.find((rs) => rs.table === agg.root && rs.filter.op === 'eq')
        const backupRoots = rootScope
          ? (backupDb
              .prepare(
                `SELECT * FROM ${quoteIdent(agg.root)} WHERE ${quoteIdent(physicalColumn(rootScope.filter.column))} = ?`
              )
              .all(rootScope.filter.value) as Record<string, unknown>[])
          : (backupDb.prepare(`SELECT * FROM ${quoteIdent(agg.root)}`).all() as Record<string, unknown>[])
        // t2: cross-machine path rebase for agent_workspace. Must run BEFORE identity
        // lookup — path is the natural-key identityKey, so the rebased value is what the
        // prefetched identity tuple + per-row lookup must see. rebases backupRoots in place;
        // per-row disclosure (user ws = placeholder) is set on the decision below and pushed
        // by the write path (scanAggregates stays pure read-only). system ws always rebases
        // (managed, faithful); user ws rebases only when its path is ABSENT from local (same-
        // machine restore keeps the original path so identity still matches).
        if (agg.root === 'agent_workspace') {
          this.rebaseWorkspacePaths(backupRoots, ctx, workSqlite, rebasedWorkspaceRows)
        }
        // pin is polymorphic (no FK) — skip rows whose entityType maps to a domain
        // outside this restore (e.g. lite archive with knowledge pins but KNOWLEDGE stripped).
        const pinEntityMap =
          agg.root === 'pin' ? this.registry.getSchema('TAGS_GROUPS').polymorphicEntityMap : undefined
        // B17: batch-prefetch local identity lookups (was one SELECT per backup root —
        // N+1 on large libraries like a TOPICS restore with many natural-key roots).
        // finalize #13 guarantees every identityKey / UNIQUE / PK matches ≤1 local row,
        // so these batch IN(...) structures are bit-identical to the prior per-row
        // LIMIT 1 lookups (NULL-bearing identity tuples are excluded — they never
        // matched under `= ?`). file_entry's lower(external_path) fold has NO physical
        // UNIQUE constraint (DB_UNIQUE_KEYS.file_entry = []), so it stays per-row to
        // avoid any ambiguity — see findLocalByExternalPath below.
        const identityKeyCols = naturalKey ? (agg.identityKey ?? pkColumns) : pkColumns
        const identityTuples: (string | number)[][] = []
        const pkTuples: (string | number)[][] = []
        for (const row of backupRoots) {
          // note identity is [rootPath, path]; the loop rewrites rootPath to the
          // planned target before lookup — mirror it via a transient view so the
          // prefetched tuple matches the lookup view without mutating the backup row.
          let identityView = row
          if (agg.root === 'note') {
            // Rewrite BOTH identity columns to the host form: the backup row stores
            // machine-specific absolute paths, but local renderer-written rows (and
            // thus the identity lookup) use the host's absolute form. See
            // resolveNoteOverlayTarget for why both columns must be rewritten.
            const target = this.resolveNoteOverlayTarget(row, ctx.resourcePlan?.noteAdditions)
            if (target !== undefined) {
              identityView = {
                ...row,
                [physicalColumn('rootPath')]: target.hostRoot,
                [physicalColumn('path')]: target.hostPath
              }
            }
          }
          if (naturalKey) {
            const vals: (string | number)[] = []
            let nullKey = false
            for (const c of identityKeyCols) {
              const v = identityView[physicalColumn(c)]
              if (v === null || v === undefined) {
                nullKey = true
                break
              }
              vals.push(v as string | number)
            }
            if (!nullKey) identityTuples.push(vals)
          }
          pkTuples.push(pkColumns.map((c) => row[physicalColumn(c)] as string | number))
        }
        const identityPkMap = naturalKey
          ? this.bulkSelectLocalPkMap(workSqlite, agg.root, pkColumns, identityKeyCols, identityTuples)
          : undefined
        const pkExistsSet = this.bulkPkExistsSet(workSqlite, agg.root, pkColumns, pkTuples)
        const lookupSecondary = naturalKey
          ? undefined
          : this.prefetchSecondaryUniqueMaps(workSqlite, agg.root, pkColumns, backupRoots)
        for (const backupRow of backupRoots) {
          const backupPrimaryKey = pkColumns.map((c) => backupRow[physicalColumn(c)] as string | number)
          // Full restores import an overlay only when planning staged its markdown body.
          // The backup row stores machine-specific absolute paths; resolve the host form
          // (host root + host externalPath) so conflict lookup, the write, and the host
          // renderer all see the same identity. SKIP when the body was not staged.
          let noteRootPath: string | undefined
          let noteHostPath: string | undefined
          if (agg.root === 'note') {
            const target = this.resolveNoteOverlayTarget(backupRow, ctx.resourcePlan?.noteAdditions)
            if (target === undefined) {
              decisions.push({
                aggregate: agg,
                identity: backupPrimaryKey,
                backupPrimaryKey,
                localCanonicalPrimaryKey: undefined,
                action: 'skip'
              })
              continue
            }
            noteRootPath = target.hostRoot
            noteHostPath = target.hostPath
            // Rewrite both identity columns in place so the identity lookup below
            // (which reads backupRow) matches a local renderer-written row.
            backupRow[physicalColumn('rootPath')] = target.hostRoot
            backupRow[physicalColumn('path')] = target.hostPath
          }
          if (pinEntityMap) {
            const entityType = String(backupRow[physicalColumn('entityType')] ?? '') as EntityType
            const target = pinEntityMap[entityType]
            if (target === undefined || target === 'excluded' || !ctx.domains.includes(target)) {
              decisions.push({
                aggregate: agg,
                identity: backupPrimaryKey,
                backupPrimaryKey,
                localCanonicalPrimaryKey: undefined,
                action: 'skip',
                skipReason: `pin entity type '${entityType}' maps to a domain not in this restore`
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
            // findLocalByIdentityKey (batched): a NULL-bearing identity tuple never
            // matches (`= ?` semantics) → undefined; else consult the prefetched
            // identity→PK map. rootPath was already rewritten above for note, so the
            // tuple view matches the prefetched one.
            const idVals: (string | number)[] = []
            let nullIdKey = false
            for (const c of identityKeyCols) {
              const v = backupRow[physicalColumn(c)]
              if (v === null || v === undefined) {
                nullIdKey = true
                break
              }
              idVals.push(v as string | number)
            }
            localCanonicalPrimaryKey = nullIdKey ? undefined : identityPkMap!.get(tupleKey(idVals))
            if (localCanonicalPrimaryKey === undefined && pkExistsSet.has(tupleKey(backupPrimaryKey))) {
              localCanonicalPrimaryKey = backupPrimaryKey
            }
          } else if (pkExistsSet.has(tupleKey(backupPrimaryKey))) {
            localCanonicalPrimaryKey = backupPrimaryKey
          } else {
            localCanonicalPrimaryKey = lookupSecondary!(backupRow)
            // file_entry expression UNIQUE lower(external_path) — not in DB_UNIQUE_KEYS.
            if (localCanonicalPrimaryKey === undefined && agg.root === 'file_entry') {
              localCanonicalPrimaryKey = this.findLocalByExternalPath(workSqlite, backupRow)
            }
          }
          const exists = localCanonicalPrimaryKey !== undefined
          // Planning skips (conflict: local row OR disk exists) must match merge SKIP so
          // we never INSERT a root whose blob/dir was not staged. Skills match folder_name
          // (identity), not the uuid primary key.
          const skippedBlob =
            (agg.root === 'file_entry' && ctx.skippedFileEntryIds.has(String(backupPrimaryKey[0]))) ||
            (agg.root === 'knowledge_base' && ctx.skippedKnowledgeBaseIds?.has(String(backupPrimaryKey[0]))) ||
            (agg.root === 'agent_global_skill' && ctx.skippedSkillFolderNames?.has(String(backupRow['folder_name'])))
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
          // t2: a user workspace whose path was rebased to a managed placeholder (custom
          // dir isn't archived) → disclose content missing on the host. Tracked by
          // rebaseWorkspacePaths (resolveWorkspacePathTarget sets rebased=true only for a
          // user ws whose path is absent from local — same-machine keeps the original path).
          const workspaceRebased = agg.root === 'agent_workspace' && rebasedWorkspaceRows.has(backupRow)
          // Carry the rebased host-form path so the write path (which re-selects from
          // backup.sqlite) overwrites the machine-specific value on insert/merge.
          const workspaceRebasedPath =
            agg.root === 'agent_workspace' && ctx.hostSystemWorkspacesRoot !== undefined
              ? String(backupRow[physicalColumn('path')])
              : undefined
          decisions.push({
            aggregate: agg,
            identity: backupPrimaryKey,
            backupPrimaryKey,
            localCanonicalPrimaryKey,
            action,
            noteRootPath,
            noteHostPath,
            workspaceRebased: workspaceRebased || undefined,
            workspaceRebasedPath
          })
        }
      }
    }
    return decisions
  }

  /**
   * B1 pre-pass — seed `identityMap.targetMap[rootTable]` for every natural-key
   * FIELD_MERGE decision. Runs AFTER `scanAggregates` (which stays pure read-only)
   * and BEFORE `importRows` (which needs the map to rewrite cross-aggregate
   * owning FKs + JSON entity-ids).
   *
   * Topological order is enforced per-domain via `topoSortAggregates` so that an
   * intra-domain cross-aggregate owning ref (e.g. `agent_session.workspaceId →
   * agent_workspace`) sees the workspace identity in the map by the time the
   * session's targetMap entry is computed. The sort key is `kind:'owning'` +
   * same-domain + target is an aggregate root; cross-domain edges remain the
   * registry-level `topoSort`'s job.
   *
   * `scanAggregates` already resolved `localCanonicalPrimaryKey` via
   * `findLocalByIdentityKey`; we just record the backup→local mapping so the
   * later root FK rewrite (R1 P0-1) and JSON entity-id walker (R1 P0-4) can
   * consume it. `sourceMap` is NOT seeded here — that is per-row "imported this
   * restore" data set by `importRows` when the row is actually written.
   */
  private buildRootIdentityMap(
    _workSqlite: Database.Database,
    ordered: readonly BackupDomain[],
    decisions: readonly AggregateDecision[],
    identityMap: IdentityMap
  ): void {
    // Bucket decisions by domain (for per-domain topo) — keep a parallel index
    // for fast decision lookup by (domain, rootTable, backupPrimaryKey).
    const decisionsByDomain = new Map<BackupDomain, AggregateDecision[]>()
    for (const d of decisions) {
      const domain = this.registry.getTableOwner(d.aggregate.root)
      if (domain === 'excluded' || domain === 'infrastructure') continue
      let bucket = decisionsByDomain.get(domain)
      if (!bucket) {
        bucket = []
        decisionsByDomain.set(domain, bucket)
      }
      bucket.push(d)
    }
    for (const domain of ordered) {
      const domainDecisions = decisionsByDomain.get(domain) ?? []
      if (domainDecisions.length === 0) continue
      const aggregates = this.registry.getAggregatesForDomain(domain)
      const intraDomainRefs = groupIntraDomainOwningRefs(aggregates, this.registry.getReferencesForDomain(domain))
      // Intra-domain required JSON entity-id edges (mirror of finalize #10's cross-domain edge):
      // a required entity-id whose targetTable is an aggregate root in THIS domain makes that
      // target a prerequisite, so its targetMap is seeded before the source imports.
      const domainRoots = new Set(aggregates.map((a) => a.root))
      const intraDomainEntityIdEdges: readonly (readonly [DbTableName, DbTableName])[] = this.registry
        .getSchema(domain)
        .jsonSoftReferences.filter(
          (j) =>
            j.target === 'entity-id' &&
            j.kind === 'required' &&
            j.targetTable !== undefined &&
            domainRoots.has(j.table) &&
            domainRoots.has(j.targetTable)
        )
        .map((j) => [j.table, j.targetTable as DbTableName] as const)
      const sorted = topoSortAggregates(aggregates, intraDomainRefs, intraDomainEntityIdEdges)
      // Decision write order: each aggregate's decisions land in topo order so
      // the referenced root identity is in the map before any referrer that
      // needs it. The sort is a total order over aggregates; decisions per
      // aggregate are still emitted in their original scan order.
      for (const agg of sorted) {
        for (const decision of domainDecisions) {
          if (decision.aggregate.root !== agg.root) continue
          // Pre-fill targetMap for both field-merge AND skip decisions. A skip still carries
          // a local canonical PK (local-wins: the local row exists), and referrers (e.g.
          // agent_session.workspaceId → agent_workspace) need that mapping before THEY import.
          // Under explicit userStrategy:'SKIP', workspace is scanned skip (canonical = local PK);
          // if we skip pre-filling it here, the map is delayed until importRows processes workspace,
          // but agent_session is declared earlier and imports first → its owning FK misses the map,
          // falls through to repair, and the row is pruned — silent loss of a session that should
          // have been rewritten to the local canonical. Only targetMap is filled (not sourceMap:
          // skip means the row was NOT imported by this restore). (B1 review R3 P0-1)
          if (decision.action !== 'field-merge' && decision.action !== 'skip') continue
          if (decision.localCanonicalPrimaryKey === undefined) continue
          setIdentityEntry(
            identityMap.targetMap,
            agg.root,
            String(decision.backupPrimaryKey[0]),
            String(decision.localCanonicalPrimaryKey[0])
          )
        }
      }
    }
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
   * Batch-resolve local canonical PKs for many key tuples at once (B17: replaces the
   * per-row `SELECT pk FROM t WHERE keyCols = ? LIMIT 1` N+1 on large libraries).
   * Returns a map keyed by `tupleKey(keyValues)` → local PK tuple; tuples with no
   * local row are simply absent.
   *
   * Bit-identical to the prior per-row lookup: finalize #13 guarantees every
   * identityKey / DB_UNIQUE_KEYS / uniqueMergeRules column set is backed by a real
   * UNIQUE constraint (or IS the PK itself), so each key tuple matches AT MOST one
   * local row — the original `LIMIT 1` was always defensive, and the batch
   * `WHERE keyCols IN (...)` returns the exact same (≤1) row per tuple. Callers
   * exclude NULL-bearing tuples beforehand (NULL never matched under `= ?`).
   *
   * Chunked so a table whose backup holds more roots than SQLITE_MAX_VARIABLE_NUMBER
   * cannot fail at prepare() with "too many SQL variables" (placeholder budget split
   * across the tuple's columns). Single-column keys use scalar `IN` (index-friendly);
   * composite keys use SQLite row-value `IN ((?,?),(?,?))`. One cached statement per
   * distinct chunk size (full + tail) — the hot path reuses the full-size statement.
   */
  private bulkSelectLocalPkMap(
    workSqlite: Database.Database,
    table: DbTableName,
    pkColumns: readonly string[],
    keyColumns: readonly string[],
    keyTuples: readonly (readonly (string | number)[])[]
  ): Map<string, readonly (string | number)[]> {
    const out = new Map<string, readonly (string | number)[]>()
    if (keyTuples.length === 0) return out
    const pkSelect = pkColumns.map((c) => quoteIdent(physicalColumn(c))).join(', ')
    const keyPhys = keyColumns.map((c) => quoteIdent(physicalColumn(c)))
    const keyPhysCsv = keyPhys.join(', ')
    const isScalar = keyColumns.length === 1
    const tuplesPerChunk = Math.max(1, Math.floor(ANCHOR_ID_CHUNK / keyColumns.length))
    const stmtForSize = (size: number): Database.Statement => {
      const placeholders = isScalar
        ? new Array(size).fill('?').join(',')
        : new Array(size).fill(`(${new Array(keyColumns.length).fill('?').join(',')})`).join(',')
      const where = isScalar ? `${keyPhys[0]} IN (${placeholders})` : `(${keyPhysCsv}) IN (${placeholders})`
      return this.prepareCached(
        workSqlite,
        `bulk:${table}:${keyColumns.join(',')}:${size}`,
        `SELECT ${pkSelect}, ${keyPhysCsv} FROM ${quoteIdent(table)} WHERE ${where}`
      )
    }
    for (let i = 0; i < keyTuples.length; i += tuplesPerChunk) {
      const batch = keyTuples.slice(i, i + tuplesPerChunk)
      const rows = stmtForSize(batch.length).all(...batch.flat()) as Record<string, unknown>[]
      for (const row of rows) {
        const pk = pkColumns.map((c) => row[physicalColumn(c)] as string | number)
        const kv = keyColumns.map((c) => row[physicalColumn(c)] as string | number)
        out.set(tupleKey(kv), pk)
      }
    }
    return out
  }

  /**
   * Batch existence check (B17: replaces per-row `SELECT 1 FROM t WHERE pk = ? LIMIT 1`
   * N+1). Returns the serialized PK tuples already present locally. Bit-identical to
   * the prior per-row check because the PK is UNIQUE (≤1 row), so a tuple is present
   * iff the batch `WHERE pk IN (...)` returns a row for it. Same chunking as
   * bulkSelectLocalPkMap.
   */
  private bulkPkExistsSet(
    workSqlite: Database.Database,
    table: DbTableName,
    pkColumns: readonly string[],
    pkTuples: readonly (readonly (string | number)[])[]
  ): Set<string> {
    const out = new Set<string>()
    if (pkTuples.length === 0) return out
    const pkPhys = pkColumns.map((c) => quoteIdent(physicalColumn(c)))
    const pkPhysCsv = pkPhys.join(', ')
    const isScalar = pkColumns.length === 1
    const tuplesPerChunk = Math.max(1, Math.floor(ANCHOR_ID_CHUNK / pkColumns.length))
    const stmtForSize = (size: number): Database.Statement => {
      const placeholders = isScalar
        ? new Array(size).fill('?').join(',')
        : new Array(size).fill(`(${new Array(pkColumns.length).fill('?').join(',')})`).join(',')
      const where = isScalar ? `${pkPhys[0]} IN (${placeholders})` : `(${pkPhysCsv}) IN (${placeholders})`
      return this.prepareCached(
        workSqlite,
        `bulkexists:${table}:${pkColumns.join(',')}:${size}`,
        `SELECT ${pkPhysCsv} FROM ${quoteIdent(table)} WHERE ${where}`
      )
    }
    for (let i = 0; i < pkTuples.length; i += tuplesPerChunk) {
      const batch = pkTuples.slice(i, i + tuplesPerChunk)
      const rows = stmtForSize(batch.length).all(...batch.flat()) as Record<string, unknown>[]
      for (const row of rows) {
        out.add(tupleKey(pkColumns.map((c) => row[physicalColumn(c)] as string | number)))
      }
    }
    return out
  }

  /**
   * Batch-prefetch local PKs for every non-PK, non-ftsRowid UNIQUE key of `table`
   * (B17: replaces per-row findLocalBySecondaryUnique N+1). Returns a `lookup`
   * closure that reproduces findLocalBySecondaryUnique's exact semantics:
   * iterate DB_UNIQUE_KEYS[table] in declared order, skip PK-equivalent and
   * ftsRowid-only keys, skip NULL-bearing tuples, and return the first key whose
   * prefetched map hits. Bit-identical to the prior per-row behaviour.
   */
  private prefetchSecondaryUniqueMaps(
    workSqlite: Database.Database,
    table: DbTableName,
    pkColumns: readonly string[],
    backupRows: readonly Record<string, unknown>[]
  ): (backupRow: Record<string, unknown>) => readonly (string | number)[] | undefined {
    const uniques = DB_UNIQUE_KEYS[table] ?? []
    const pkSet = new Set(pkColumns)
    const maps: Array<{ columns: readonly string[]; map: Map<string, readonly (string | number)[]> }> = []
    for (const uk of uniques) {
      if (uk.columns.length === pkColumns.length && uk.columns.every((c) => pkSet.has(c))) continue
      if (uk.columns.every((c) => c === 'ftsRowid')) continue
      const tuples: (string | number)[][] = []
      for (const row of backupRows) {
        const vals: (string | number)[] = []
        let missing = false
        for (const c of uk.columns) {
          const v = row[physicalColumn(c)]
          if (v === null || v === undefined) {
            missing = true
            break
          }
          vals.push(v as string | number)
        }
        if (missing) continue
        tuples.push(vals)
      }
      const map = this.bulkSelectLocalPkMap(workSqlite, table, pkColumns, uk.columns, tuples)
      maps.push({ columns: uk.columns, map })
    }
    return (backupRow: Record<string, unknown>): readonly (string | number)[] | undefined => {
      for (const { columns, map } of maps) {
        const vals: (string | number)[] = []
        let missing = false
        for (const c of columns) {
          const v = backupRow[physicalColumn(c)]
          if (v === null || v === undefined) {
            missing = true
            break
          }
          vals.push(v as string | number)
        }
        if (missing) continue
        const found = map.get(tupleKey(vals))
        if (found !== undefined) return found
      }
      return undefined
    }
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
    // Aggregate skipReason disclosures (e.g. pin rows dropped by a selected-domain filter) by
    // table+reason — mirrors importAllJunctionRows / importPolymorphicAssociationRows so a LITE
    // restore carrying many same-reason skips emits one {count:N} record, not N {count:1}.
    const skipCounts = new Map<string, number>()
    const bumpSkip = (table: DbTableName, reason: string): void => {
      const key = `${table}${DEGRADE_KEY_SEP}${reason}`
      skipCounts.set(key, (skipCounts.get(key) ?? 0) + 1)
    }
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
          // t3: disclose a skipped row whose reason is user-visible (e.g. a pin whose entity
          // domain is not in this restore). Aggregated per table+reason (not one-per-row) so a
          // large set of same-reason skips does not bloat the journal/UI. Mirrors entity_tag's
          // association_dropped disclosure.
          if (decision.skipReason !== undefined) {
            bumpSkip(decision.aggregate.root, decision.skipReason)
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
    for (const [key, count] of skipCounts) {
      const [table, reason] = key.split(DEGRADE_KEY_SEP)
      degradedToSkips.push({ kind: 'association_dropped', table: table as DbTableName, count, reason })
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
    // Rewrite the note overlay identity to the host form (both columns) — the row was
    // re-selected from backup.sqlite (machine-specific absolute paths) so the scan-time
    // rewrite does not carry over. See resolveNoteOverlayTarget.
    if (decision.noteRootPath !== undefined) {
      backupRoot[physicalColumn('rootPath')] = decision.noteRootPath
    }
    if (decision.noteHostPath !== undefined) {
      backupRoot[physicalColumn('path')] = decision.noteHostPath
    }
    // t2: overwrite agent_workspace.path with the rebased host-form value (the row was
    // re-selected from backup.sqlite with the machine-specific path).
    if (decision.workspaceRebasedPath !== undefined) {
      backupRoot[physicalColumn('path')] = decision.workspaceRebasedPath
    }
    if (decision.workspaceRebased) {
      degradedToSkips.push({
        kind: 'resource_content_missing',
        table: agg.root,
        count: 1,
        reason: 'user workspace path rebased to managed placeholder; dir contents not carried by archive (t2)'
      })
    }

    const domain = this.registry.getTableOwner(agg.root)
    const policies =
      domain === 'excluded' || domain === 'infrastructure'
        ? []
        : (this.registry.getPolicy(domain).fieldMergePolicies ?? []).filter((p) => p.table === agg.root)
    const exclude = new Set<string>([...pkColumns, ...(agg.identityKey ?? [])])
    // B1 R1 P0-1: ownable root FKs (e.g. agent_workspace has no cross-aggregate
    // owning FK so this is a no-op for today's natural-key FIELD_MERGE roots,
    // but the call is cheap and keeps the contract symmetric with insertAggregate).
    // The rewrite MUST run before fieldMergeRow so a later deep-merge on a JSON
    // column sees the rewritten FK (though today no natural-key root carries
    // both an owning FK and a deep-merge policy).
    this.rewriteRootOwningFks(agg.root, backupRoot, identityMap)
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
    // B1 R1 P0-4: required JSON entity-id walker must run AFTER fieldMergeRow's
    // deep-merge (which may rewrite the JSON column's discriminated-union type)
    // so the entity-id rewrite sees the post-merge shape. The walker operates
    // on the work.sqlite row now (not the backup row) so any deep-merged
    // changes survive.
    if (
      !this.rewriteRowEntityIdsForLocal(agg.root, workSqlite, localCanonicalPrimaryKey, identityMap, degradedToSkips)
    ) {
      return
    }

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
    // Rewrite the note overlay identity to the host form (both columns) — the row was
    // re-selected from backup.sqlite (machine-specific absolute paths). See
    // resolveNoteOverlayTarget.
    if (decision.noteRootPath !== undefined) {
      rootRow[physicalColumn('rootPath')] = decision.noteRootPath
    }
    if (decision.noteHostPath !== undefined) {
      rootRow[physicalColumn('path')] = decision.noteHostPath
    }
    // t2: overwrite agent_workspace.path with the rebased host-form value (the row was
    // re-selected from backup.sqlite with the machine-specific path).
    if (decision.workspaceRebasedPath !== undefined) {
      rootRow[physicalColumn('path')] = decision.workspaceRebasedPath
    }
    if (decision.workspaceRebased) {
      degradedToSkips.push({
        kind: 'resource_content_missing',
        table: agg.root,
        count: 1,
        reason: 'user workspace path rebased to managed placeholder; dir contents not carried by archive (t2)'
      })
    }
    // B1 R1 P0-1: rewrite the root row's cross-aggregate owning FKs through the
    // identityMap BEFORE insert. The only owning FK in B1's owning set is
    // `agent_session.workspaceId → agent_workspace` (intra-domain cross-aggregate,
    // uuid PK); the deterministic-PK model FKs (agent.model*, KB.embeddingModelId,
    // assistant.modelId) are NOT in the set because user_model PKs are
    // cross-device deterministic and never conflict. Unresolvable owning → row
    // is discarded + disclosed (R1 P1-1 kind semantics).
    if (this.shouldDiscardRootForOwning(agg.root, rootRow, identityMap, degradedToSkips)) return
    this.rewriteRootOwningFks(agg.root, rootRow, identityMap)
    // B1 R1 P0-4: required JSON entity-id columns (`agent_channel.workspace`,
    // `job_schedule.jobInputTemplate`) must have their embedded workspaceId
    // rewritten through the identityMap BEFORE the row is inserted. The walker
    // handles the AgentSessionWorkspaceSource discriminated union
    // (type='user' carries the id, type='system' is pass-through). Unresolvable
    // required entity-id → row is discarded + disclosed.
    if (!this.rewriteRowEntityIds(agg.root, rootRow, identityMap, degradedToSkips)) return
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
            degradedToSkips.push({ kind: 'rows_skipped', table: member.table, count: skipped.c, reason })
          }
        }
        continue
      }
      // Chunk the anchor IN(...) list: a Topic with tens of thousands of messages would
      // otherwise bind more variables than SQLITE_MAX_VARIABLE_NUMBER (32766 in the
      // bundled build) and fail at prepare() with "too many SQL variables". Row count is
      // bounded by the archive's row count, not by its byte limits.
      const anchorList = [...anchorIds]
      const memberRows: Record<string, unknown>[] = []
      for (let i = 0; i < anchorList.length; i += ANCHOR_ID_CHUNK) {
        const batch = anchorList.slice(i, i + ANCHOR_ID_CHUNK)
        const placeholders = batch.map(() => '?').join(',')
        memberRows.push(
          ...(backupDb
            .prepare(
              `SELECT * FROM ${quoteIdent(member.table)} WHERE ${quoteIdent(physicalColumn(member.viaColumn))} IN (${placeholders})`
            )
            .all(...batch) as Record<string, unknown>[])
        )
      }
      const memberPkCols = this.registry.getPrimaryKey(member.table).columns
      const memberPkColPhys = physicalColumn(memberPkCols[0])
      const rule = uniqueRules.find((r) => r.table === member.table)
      const memberPolicies = allFieldPolicies.filter((p) => p.table === member.table)

      // B17: batch-prefetch member identity lookups (was one SELECT per member row —
      // N+1 on a Topic with many messages/attachments). Member FKs are rewritten
      // up-front (batched) so the post-rewrite key values can feed a batched lookup.
      //
      // Equivalence to the prior per-row rewrite+lookup interleaving rests on two
      // verifiable facts about the current contributor set: (1) member tables never
      // FK-reference a SIBLING row of the same table — message.parentId and
      // knowledge_item.[baseId,groupId] self-ref, but both are uuid-entity
      // (identity-stable), so their rewrite is a no-op regardless of targetMap state;
      // (2) every other member table's FKs target a different table whose targetMap
      // is already populated before this member def runs (nested members sort after
      // their parent). So the identityMap each row's rewrite consults is identical
      // whether rewritten up-front or interleaved with same-table inserts. finalize
      // #13 + DB UNIQUE ⇒ each key matches ≤1 local row ⇒ bit-identical to LIMIT 1.
      //
      // (3) Injectivity: under finalize #13's physical UNIQUE constraint the
      // backup-member-key → canonical-tuple mapping is injective — two distinct
      // backup member keys never collapse onto the same local canonical tuple (a
      // UNIQUE column set cannot hold two local rows for one key, and the batch map
      // keys by the backup tuple itself). This is what makes the batched prefetch
      // deterministic: each backup row resolves to exactly one local row, the same
      // one the per-row `LIMIT 1` would have returned. If a future change broke
      // injectivity (two backup keys mapping to one canonical tuple) the batched
      // prefetch and the per-row interleaving could diverge on which row wins the
      // identityMap entry; the current contributor set + physical UNIQUE keep this
      // impossible, and this comment pins the assumption — break it and a runtime
      // guard becomes required.
      //
      // Future-risk: premise (1) holds for the CURRENT contributor set only. If a future
      // contributor adds a natural-key (non-uuid) self-referencing member FK, the up-front
      // rewrite would consult a targetMap that only populates after same-table inserts —
      // such a member must fall back to per-row interleaving or add a runtime guard. The
      // finalize #13 codegen constraint enforces uniqueness, not this self-ref shape.
      const rewrittenRows = memberRows.map((r) => this.rewriteMemberFks(member.table, r, identityMap))
      // B17 perf: memberPkExistsSet is consumed only in the no-rule branch below (rule
      // members resolve via memberRuleMap). Skip the PK-existence bulk when the member has
      // a uniqueMergeRule (e.g. user_model) — saves one O(chunks) query; the `?.` at the
      // consumer is safe because that branch only runs when rule is absent.
      const memberPkExistsSet = rule
        ? undefined
        : this.bulkPkExistsSet(
            workSqlite,
            member.table,
            memberPkCols,
            rewrittenRows.map((r) => memberPkCols.map((c) => r[physicalColumn(c)] as string | number))
          )
      const memberRuleMap = rule
        ? this.bulkSelectLocalPkMap(
            workSqlite,
            member.table,
            memberPkCols,
            rule.uniqueColumns,
            rewrittenRows.reduce((tuples: (string | number)[][], r) => {
              const vals: (string | number)[] = []
              let missing = false
              for (const c of rule.uniqueColumns) {
                const v = r[physicalColumn(c)]
                if (v === null || v === undefined) {
                  missing = true
                  break
                }
                vals.push(v as string | number)
              }
              if (!missing) tuples.push(vals)
              return tuples
            }, [])
          )
        : undefined
      const memberSecondaryLookup = rule
        ? undefined
        : this.prefetchSecondaryUniqueMaps(workSqlite, member.table, memberPkCols, rewrittenRows)

      for (const memberRow of rewrittenRows) {
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
          localPk = missing ? undefined : memberRuleMap!.get(tupleKey(values))
        } else {
          const backupMemberPk = memberPkCols.map((c) => memberRow[physicalColumn(c)] as string | number)
          if (memberPkExistsSet?.has(tupleKey(backupMemberPk))) {
            localPk = backupMemberPk
          } else {
            localPk = memberSecondaryLookup!(memberRow)
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
            kind: 'field_conflict',
            table,
            count: 1,
            reason: `deep-merge type conflict kept local ('${typeConflict.localType}' vs backup '${typeConflict.backupType}')`
          })
        }
        const serialized = serializeMergedCell(merged, localVal, backupVal)
        if (!cellEqualForMerge(serialized, localVal)) nextVal = serialized
      } else if (policy.strategy === 'local-priority') {
        // local non-empty wins; local empty (null/''/[]/{}) fills from backup
        if (isEmptyForRemoteFill(localVal) && !isEmptyForRemoteFill(backupVal)) nextVal = backupVal
      } else if (policy.strategy === 'remote-overwrites-local') {
        // backup-wins: a non-empty backup value overwrites local (even non-empty). Backup
        // null/empty never overwrites (an empty backup would wipe local config). Overwriting
        // a local NON-EMPTY value is destructive → disclose with a DISTINCT kind
        // (remote_overwrote_local, NOT field_conflict) so the summary tells the user the local
        // value was REPLACED, not kept (field_conflict's i18n says "will keep the local value").
        if (!isEmptyForRemoteFill(backupVal)) {
          if (!isEmptyForRemoteFill(localVal) && !cellEqualForMerge(backupVal, localVal)) {
            degradedToSkips.push({
              kind: 'remote_overwrote_local',
              table,
              count: 1,
              reason: `backup-wins overwrote local non-empty ('${policy.column}')`
            })
          }
          if (!cellEqualForMerge(backupVal, localVal)) nextVal = backupVal
        }
      }
      if (nextVal === undefined) continue
      // B12: record FIELD_MERGE telemetry — column count + strategy name ONLY (no values,
      // credentials, or authConfig content). The strategy defaults to remote-fills-local-null
      // when no explicit policy applies.
      const strategy = policy?.strategy ?? 'remote-fills-local-null'
      let statEntry = this.fieldMergeStats.get(table)
      if (!statEntry) {
        statEntry = { columns: 0, strategies: new Set<string>() }
        this.fieldMergeStats.set(table, statEntry)
      }
      statEntry.columns++
      statEntry.strategies.add(strategy)
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
    // B18: an FTS source table update changes the index content → the final rebuild must run.
    if (FTS_SOURCE_TABLES.has(table)) this.ftsSourceChanged = true
  }

  /**
   * Disclose every declared file-ref JSON soft reference whose blob was not staged.
   *
   * Driven by the contributor registry (`jsonSoftReferences` with `target: 'file-ref'`), not
   * by a hard-coded table list: `message.data` and `agent_session_message.data` both carry
   * attachment refs today, and a domain that declares one tomorrow is covered without
   * touching the engine. Kind is not filtered — all declared file-ref policies are `tolerant`
   * today, and a future `required` one must surface here rather than pass unreported (its
   * stricter fail-closed handling would be a separate decision).
   *
   * DB-only restore passes empty stagedFileEntryIds → every attachment disclosed.
   */
  private discloseFileIdSoftRefs(
    workSqlite: Database.Database,
    ctx: MergeContext,
    identityMap: IdentityMap,
    degradedToSkips: DegradedSkip[]
  ): void {
    for (const domain of this.registry.domains) {
      for (const policy of this.registry.getSchema(domain).jsonSoftReferences) {
        if (policy.target !== 'file-ref') continue
        this.discloseTableFileIdSoftRefs(workSqlite, ctx, identityMap, degradedToSkips, policy.table, policy.column)
      }
    }
  }

  /**
   * Disclose one (table, JSON column) pair's unstaged file refs.
   *
   * Scoped to the rows THIS restore imported (identityMap.sourceMap): `stagedFileEntryIds`
   * describes only this archive, so an attachment on an untouched local row would be counted
   * "not staged" even though its local blob is perfectly valid. Per-id lookups also keep a
   * large local history out of memory — only imported rows are read + JSON-parsed.
   */
  private discloseTableFileIdSoftRefs(
    workSqlite: Database.Database,
    ctx: MergeContext,
    identityMap: IdentityMap,
    degradedToSkips: DegradedSkip[],
    table: DbTableName,
    column: string
  ): void {
    const importedIds = identityMap.sourceMap.get(table)
    if (!importedIds || importedIds.size === 0) return
    const hasTable =
      workSqlite.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table) !== undefined
    if (!hasTable) return
    const staged = ctx.stagedFileEntryIds
    let missing = 0
    const pkPhys = physicalColumn(this.registry.getPrimaryKey(table).columns[0])
    const colPhys = physicalColumn(column)
    const selectData = this.prepareCached(
      workSqlite,
      `sel:${table}:softref:${colPhys}:${pkPhys}`,
      `SELECT ${quoteIdent(colPhys)} AS data FROM ${quoteIdent(table)} WHERE ${quoteIdent(pkPhys)} = ?`
    )
    for (const workRowId of new Set(importedIds.values())) {
      const row = selectData.get(workRowId) as { data: string | null } | undefined
      if (!row?.data) continue
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
        kind: 'attachment_unavailable',
        table,
        count: missing,
        reason: `imported ${table}.${column} attachment blob not staged (fileEntryId missing from stagedFileEntryIds — DB-only restore discloses all)`
      })
    }
  }

  /**
   * Rewrite member FK columns to canonical IDs from the identity map (P2 / B1 partial).
   * A root whose identity was deduped (e.g. file_entry by lower(external_path)) carries
   * backupPk → localPk in targetMap, but its member tables (chat_message_file_ref /
   * painting_file_ref / provider_logo_file_ref / mini_app_logo_file_ref) still reference
   * the backup PK — without rewriting, those FKs dangle and repairDanglingRefs prunes the
   * member rows (attachment/logo loss). Generic over DB_FOREIGN_KEYS + targetMap, so any
   * future dedup root is covered. Single-column FKs only; composite-FK identity
   * propagation is B1's full scope. Returns the same reference when nothing needs
   * rewriting; otherwise a shallow copy so the backup query result stays intact.
   */
  private rewriteMemberFks(
    table: DbTableName,
    row: Record<string, unknown>,
    identityMap: IdentityMap
  ): Record<string, unknown> {
    const fks = DB_FOREIGN_KEYS[table]
    if (!fks || fks.length === 0) return row
    let rewritten = row
    for (const fk of fks) {
      const map = identityMap.targetMap.get(fk.targetTable as DbTableName)
      if (!map || map.size === 0) continue
      if (fk.columns.length !== 1) continue
      const physCol = physicalColumn(fk.columns[0])
      const backupVal = rewritten[physCol]
      if (backupVal === null || backupVal === undefined) continue
      const canonical = map.get(String(backupVal))
      if (canonical !== undefined && canonical !== String(backupVal)) {
        if (rewritten === row) rewritten = { ...row }
        rewritten[physCol] = canonical
      }
    }
    return rewritten
  }

  /**
   * B1 R1 P0-1: determine whether the root row should be discarded because
   * one of its owning FKs is unresolvable. An owning FK is unresolvable when
   * the backup value has NO entry in the identityMap's target table — meaning
   * the referenced natural-key row was neither imported nor pre-existing
   * locally. In that case the row cannot satisfy `kind:'owning'` semantics
   * (the target does not exist) and the spec dictates discard+disclose.
   *
   * `optional` FKs do NOT trigger discard — they go through `rewriteRootOwningFks`
   * which clears them to NULL in the in-memory row. Only `kind:'owning'` refs
   * are checked here. Deterministic-PK targets (e.g. `user_model`) are excluded
   * by virtue of the contributor's `kind:'optional'` declaration.
   */
  private shouldDiscardRootForOwning(
    table: DbTableName,
    row: Record<string, unknown>,
    identityMap: IdentityMap,
    degradedToSkips: DegradedSkip[]
  ): boolean {
    const domain = this.registry.getTableOwner(table)
    if (domain === 'excluded' || domain === 'infrastructure') return false
    const refs = this.registry.getReferencesForDomain(domain)
    let discard = false
    for (const ref of refs) {
      if (ref.table !== table) continue
      if (ref.kind !== 'owning') continue
      const physCol = physicalColumn(ref.column)
      const backupVal = row[physCol]
      if (backupVal === null || backupVal === undefined) continue
      const targetTable = resolveReferenceTargetTable(ref)
      if (targetTable === undefined) continue
      const map = identityMap.targetMap.get(targetTable)
      if (map === undefined) continue
      // Map populated but no entry for this backup value → unresolvable.
      if (!map.has(String(backupVal))) {
        discard = true
        const reason = `owning ref to ${targetTable}.${ref.column} could not be resolved (no local survivor); row discarded (B1)`
        const existing = degradedToSkips.find((d) => d.table === table && d.reason === reason)
        if (!existing) {
          degradedToSkips.push({
            kind: 'row_pruned',
            table,
            count: 1,
            reason: `owning ref to ${targetTable}.${ref.column} could not be resolved (no local survivor); row discarded (B1)`
          })
        }
      }
    }
    return discard
  }

  /**
   * B1 R1 P0-1: rewrite the root row's cross-aggregate FKs through the
   * identityMap. For each declared `kind:'owning' | 'optional'` ref of this
   * root, if the backup FK value has an entry in the target's identityMap,
   * rewrite the value in the in-memory row to the local canonical PK.
   *
   * - `owning` (cross-aggregate + non-deterministic PK): unresolvable cases
   *   are caught by `shouldDiscardRootForOwning` before this call; here we
   *   only resolve present entries.
   * - `optional` (deterministic-PK targets like `user_model`): target
   *   identity is identity-stable across devices, so a present map entry
   *   means "this exact PK collided and was remapped" — rewrite. A missing
   *   map entry is NOT touched here: it is a true dangling reference (a
   *   removed model), which the existing `repairDanglingRefs` pass handles
   *   with the correct semantics for that table's business invariants
   *   (e.g. knowledge_base status/dimension check constraints).
   *
   * The call is idempotent: passing the same map twice is a no-op.
   */
  private rewriteRootOwningFks(table: DbTableName, row: Record<string, unknown>, identityMap: IdentityMap): void {
    const domain = this.registry.getTableOwner(table)
    if (domain === 'excluded' || domain === 'infrastructure') return
    const refs = this.registry.getReferencesForDomain(domain)
    for (const ref of refs) {
      if (ref.table !== table) continue
      if (ref.kind !== 'owning' && ref.kind !== 'optional') continue
      const physCol = physicalColumn(ref.column)
      const backupVal = row[physCol]
      if (backupVal === null || backupVal === undefined) continue
      const targetTable = resolveReferenceTargetTable(ref)
      if (targetTable === undefined) continue
      const map = identityMap.targetMap.get(targetTable)
      if (map === undefined) continue
      // Only rewrite when the target identity has an entry for this backup
      // value. Missing entries (true dangling refs) fall through to the
      // existing repair pass — which understands per-table business invariants
      // (e.g. knowledge_base status/dimension CHECK) better than this generic
      // rewrite can.
      const canonical = map.get(String(backupVal))
      if (canonical !== undefined && canonical !== String(backupVal)) {
        row[physCol] = canonical
      }
    }
  }

  /**
   * B1 R1 P0-4: in-memory rewrite of `target:'entity-id'` JSON soft references
   * for an INSERT-path root row. Operates on the in-memory `row` BEFORE insert.
   * Today the only declared policies are:
   *   - agent_channel.workspace  (AgentSessionWorkspaceSource, type='user' branch)
   *   - job_schedule.jobInputTemplate (same shape, jobSchedule jobInputTemplate)
   * Both target `agent_workspace`. The walker is column-specific by design —
   * see `rewriteWorkspaceEntityId`.
   *
   * `required` policy + unresolvable entity-id → discard the row + disclose.
   * `tolerant` policy + unresolvable → leave the cell untouched (existing
   * `discloseFileIdSoftRefs` handles the disclosure for file-ref tolerant;
   * entity-id tolerant is a future work).
   *
   * Returns `true` when the row should proceed to insert, `false` when the
   * caller must drop the row (required entity-id unresolvable).
   */
  private rewriteRowEntityIds(
    table: DbTableName,
    row: Record<string, unknown>,
    identityMap: IdentityMap,
    degradedToSkips: DegradedSkip[]
  ): boolean {
    const domain = this.registry.getTableOwner(table)
    if (domain === 'excluded' || domain === 'infrastructure') return true
    const policies = this.registry.getSchema(domain).jsonSoftReferences
    for (const policy of policies) {
      if (policy.table !== table) continue
      if (policy.target !== 'entity-id') continue
      const colPhys = physicalColumn(policy.column)
      const cell = row[colPhys]
      if (cell === null || cell === undefined) continue
      const text = typeof cell === 'string' ? cell : JSON.stringify(cell)
      // B4: the walker is now policy-driven (selectors declare container depth + id field +
      // discriminator; targetTable declares the identity-map table). See rewriteJsonEntityIds.
      const result = rewriteJsonEntityIds(text, identityMap, policy)
      if (result.missing.length > 0) {
        if (policy.kind === 'required') {
          degradedToSkips.push({
            kind: 'row_pruned',
            table,
            count: 1,
            reason: `required JSON entity-id (${policy.column}) could not be resolved; row discarded (B1)`
          })
          return false
        }
        // tolerant: leave the cell as-is; the row may still be useful (the
        // embedded id is informational in tolerant mode). Disclosure pass is
        // out of B1's scope for entity-ids (no file-ref equivalent yet).
        continue
      }
      if (result.text !== text) {
        row[colPhys] = result.text
      }
    }
    return true
  }

  /**
   * B1 R1 P0-4 FIELD_MERGE variant: rewrite the JSON entity-id column on the
   * LOCAL row AFTER `fieldMergeRow` (which may have run deep-merge). The
   * deep-merge preserves the local `type` discriminator on a discriminated
   * union, so a subsequent entity-id rewrite that runs on the work.sqlite
   * row (not the in-memory backup row) sees the post-merge shape and rewrites
   * the surviving `type='user'` branch's workspaceId.
   *
   * Returns `true` to keep the FIELD_MERGE outcome, `false` to signal the
   * caller must abort the aggregate (required entity-id unresolvable).
   */
  private rewriteRowEntityIdsForLocal(
    table: DbTableName,
    workSqlite: Database.Database,
    localPk: readonly (string | number)[],
    identityMap: IdentityMap,
    degradedToSkips: DegradedSkip[]
  ): boolean {
    const domain = this.registry.getTableOwner(table)
    if (domain === 'excluded' || domain === 'infrastructure') return true
    const policies = this.registry.getSchema(domain).jsonSoftReferences
    if (policies.length === 0) return true
    const pkPhys = physicalColumn(this.registry.getPrimaryKey(table).columns[0])
    const wherePk = `${quoteIdent(pkPhys)} = ?`
    for (const policy of policies) {
      if (policy.table !== table) continue
      if (policy.target !== 'entity-id') continue
      const colPhys = physicalColumn(policy.column)
      const selectSql = `SELECT ${quoteIdent(colPhys)} AS data FROM ${quoteIdent(table)} WHERE ${wherePk}`
      const current = this.prepareCached(workSqlite, `sel:${table}:entityid:${colPhys}:${pkPhys}`, selectSql).get(
        ...localPk
      ) as { data: string | null } | undefined
      if (!current?.data) continue
      // B4: policy-driven walker (see rewriteJsonEntityIds).
      const result = rewriteJsonEntityIds(current.data, identityMap, policy)
      if (result.missing.length > 0) {
        if (policy.kind === 'required') {
          degradedToSkips.push({
            kind: 'row_pruned',
            table,
            count: 1,
            reason: `required JSON entity-id (${policy.column}) could not be resolved on local row; row discarded (B1)`
          })
          return false
        }
        continue
      }
      if (result.text !== current.data) {
        workSqlite
          .prepare(`UPDATE ${quoteIdent(table)} SET ${quoteIdent(colPhys)} = ? WHERE ${wherePk}`)
          .run(result.text, ...localPk)
      }
    }
    return true
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
    // B18: an FTS source table insert changes the index content → the final rebuild must run.
    if (isFtsSource) this.ftsSourceChanged = true
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
    identityMap: IdentityMap,
    degradedToSkips: DegradedSkip[]
  ): void {
    const descriptors = deriveJunctionDescriptors(this.registry, selectedDomains)
    // Cascade-pruned junction rows are association loss like the polymorphic phase's —
    // aggregate + disclose them instead of dropping silently.
    const counts = new Map<string, number>()
    const bump = (table: DbTableName, reason: string): void => {
      const key = `${table}${DEGRADE_KEY_SEP}${reason}`
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
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
        // B1 R1 P2-2 (A8): a junction source whose endpoint SKIPs (uuid-entity
        // local-wins) never enters `sourceMap` (sourceMap = "imported THIS restore").
        // Without a fallback, the whole junction row would be pruned even when
        // the local source row is still present and usable. Resolve the source
        // canonical by checking the work.sqlite FK column directly when
        // sourceMap lookup misses — this preserves the row for pre-existing
        // local sources. Distinct from identityMap.targetMap fallback for the
        // TARGET endpoint, which remains the canonical target-availability path.
        let sourceCanonical = identityMap.sourceMap.get(desc.sourceEndpoint.table)?.get(sourceBackupId)
        if (sourceCanonical === undefined) {
          // The source table's PK is the value the junction row references via
          // its FK column — look up the source table by its PK column directly.
          const workSource = this.lookupWorkRowByPk(workSqlite, desc.sourceEndpoint.table, sourceBackupId)
          if (workSource !== undefined) {
            sourceCanonical = workSource
          } else {
            bump(desc.table, `junction source '${desc.sourceEndpoint.table}' not imported`) // → prune
            continue
          }
        }
        const targetCanonical = identityMap.targetMap.get(desc.targetEndpoint.table)?.get(targetBackupId)
        if (targetCanonical === undefined) {
          bump(desc.table, `junction target '${desc.targetEndpoint.table}' unavailable`) // → prune
          continue
        }
        this.insertJunctionRow(workSqlite, desc.table, row, sourcePhys, sourceCanonical, targetPhys, targetCanonical)
      }
    }
    for (const [key, count] of counts) {
      const [table, reason] = key.split(DEGRADE_KEY_SEP)
      degradedToSkips.push({ kind: 'association_dropped', table: table as DbTableName, count, reason })
    }
  }

  /**
   * B1 R1 P2-2 (A8) helper: look up the local row's PK in work.sqlite for a
   * given (table, PK value). Used by the junction phase to resolve the source
   * endpoint when the source SKIPped (no sourceMap entry) but the local source
   * row is still present and usable. The junction row's FK column holds the
   * source's PK value (e.g. `agent_skill.agent_id = agent.id`), so the lookup
   * is by PK. Returns the work-side PK or `undefined`.
   *
   * Single-column PK assumed — the same constraint `rewriteMemberFks` already
   * relies on, and which holds for every AGENTS junction source today: agent,
   * agent_session, agent_channel all use single-column uuid PKs.
   */
  private lookupWorkRowByPk(workSqlite: Database.Database, table: DbTableName, pkValue: string): string | undefined {
    const pkColumns = this.registry.getPrimaryKey(table).columns
    if (pkColumns.length !== 1) return undefined
    const pkPhys = physicalColumn(pkColumns[0])
    const hasTable =
      workSqlite.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table) !== undefined
    if (!hasTable) return undefined
    const row = this.prepareCached(
      workSqlite,
      `sel:${table}:pklkp:${pkPhys}`,
      `SELECT ${quoteIdent(pkPhys)} AS pk FROM ${quoteIdent(table)} WHERE ${quoteIdent(pkPhys)} = ? LIMIT 1`
    ).get(pkValue) as { pk: string } | undefined
    return row?.pk
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
      degradedToSkips.push({ kind: 'association_dropped', table: table as DbTableName, count, reason })
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
        // SET DEFAULT is deliberately NOT treated as SET NULL: SQLite would assign the column's
        // DEFAULT clause value, not NULL, and nullifying it silently violates the FK's declared
        // repair semantics (blueprint §429 "set default → reject", finalize #19). finalize #19
        // already rejects any contributor declaring a SET DEFAULT FK, so this branch is a latent
        // safety net — a future migration adding one falls through to the no-action path (prune /
        // partial-NULL) rather than mis-nullifying. Only SET NULL clears columns to NULL.
        const setNullPolicy = onDelete === 'SET NULL'
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
          // B18: a repair on an FTS source table changes index content → rebuild must run.
          if (FTS_SOURCE_TABLES.has(v.table)) this.ftsSourceChanged = true
          const key = `${v.table}${DEGRADE_KEY_SEP}ref_cleared${DEGRADE_KEY_SEP}ref to missing ${v.parent} cleared (SET NULL)`
          counts.set(key, (counts.get(key) ?? 0) + 1)
        } else {
          workSqlite.prepare(`DELETE FROM ${quoteIdent(v.table)} WHERE rowid = ?`).run(v.rowid)
          // B18: a repair on an FTS source table changes index content → rebuild must run.
          if (FTS_SOURCE_TABLES.has(v.table)) this.ftsSourceChanged = true
          const key = `${v.table}${DEGRADE_KEY_SEP}row_pruned${DEGRADE_KEY_SEP}row pruned (required ${v.parent} target missing)`
          counts.set(key, (counts.get(key) ?? 0) + 1)
        }
        repaired = true
      }
      // Nothing addressable this pass — stop; the final consistency check is the arbiter.
      if (!repaired) break
    }
    for (const [key, count] of counts) {
      const [table, kind, reason] = key.split(DEGRADE_KEY_SEP)
      degradedToSkips.push({ kind: kind as ReconcileDegradationKind, table: table as DbTableName, count, reason })
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
   * B12: emit the aggregated FIELD_MERGE telemetry as one internal log line after a
   * successful merge commit. Records ONLY table name, column count, and strategy names —
   * never cell values, credentials, or authConfig content. This is internal observability
   * for merge activity; the user-visible disclosure contract (which loss/conflict to
   * surface in the restore summary, and whether to name merged columns) is a separate
   * decision owned upstream (owner TBD @0xfullex).
   */
  private logFieldMergeStats(): void {
    if (this.fieldMergeStats.size === 0) return
    const tables = [...this.fieldMergeStats.entries()].map(
      ([table, { columns, strategies }]) => `${table}: ${columns} column(s) [${[...strategies].join(',')}]`
    )
    logger.info('FIELD_MERGE telemetry', { tables })
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
