// MergeEngine — detached restore import pipeline (plan (b)).
//
// Merges backup rows into a detached work.sqlite (VACUUM INTO copy of live) inside one
// synchronous better-sqlite3 transaction. UUID conflicts preserve local rows; natural-key
// conflicts field-merge onto a local canonical PK; identity propagation rewrites every FK
// or required JSON reference before its row reaches SQLite. The production restore spine
// remains fail-closed until its independent wiring task enables this engine.

import type { AggregateBoundary, ReadonlyBackupRegistry } from '@main/data/db/backup/contributorTypes'
import type { DbTableName } from '@main/data/db/backup/dbSchemaRefs'
import { DB_FTS_VIRTUAL_TABLES } from '@main/data/db/backup/dbSchemaRefs'
import type { BackupDomain } from '@main/data/db/backup/domains'
import type { DbType } from '@main/data/db/types'
import Database from 'better-sqlite3'

import { ConflictResolver } from './ConflictResolver'
import { MergeStrategyNotImplementedError } from './errors'
import { FtsCentralHelper } from './FtsCentralHelper'
import { propagateIdentityReferences } from './identityPropagation'
import { deriveJunctionDescriptors } from './junctionDeriver'
import { type FieldMergeColumnPolicy, FieldMergeStrategy } from './strategies/FieldMergeStrategy'
import type { AggregateDecision, DegradedSkip, IdentityMap, MergeContext, MergeResult } from './types'

export { MergeStrategyNotImplementedError } from './errors'

/** Convert a Drizzle logical column name to the physical SQLite column name. */
const physicalColumn = (logical: string): string => logical.replace(/[A-Z]/g, (match) => `_${match.toLowerCase()}`)

/** Quote a schema-owned SQLite identifier such as a table or physical column name. */
const quotedIdentifier = (identifier: string): string => `"${identifier.replaceAll('"', '""')}"`

/** Quote a schema-owned table identifier. */
const quotedTable = (table: DbTableName): string => quotedIdentifier(table)

/** External-content FTS source tables require SQLite to regenerate these derived columns. */
const FTS_SOURCE_TABLES: ReadonlySet<string> = new Set(Object.values(DB_FTS_VIRTUAL_TABLES))
const FTS_DERIVED_PHYSICAL_COLUMNS = new Set(['fts_rowid', 'searchable_text'])

/** Set one role-aware identity entry without mutating a pre-existing inner map. */
const setIdentityEntry = (
  map: Map<DbTableName, Map<string, string>>,
  table: DbTableName,
  backupId: string,
  canonicalId: string
): void => {
  const existing = map.get(table)
  const entries = new Map(existing)
  entries.set(backupId, canonicalId)
  map.set(table, entries)
}

/** Offline consistency check failed — work.sqlite must never promote. */
export class MergeConsistencyCheckError extends Error {
  constructor(detail: string) {
    super(`merge offline consistency check failed: ${detail}`)
    this.name = 'MergeConsistencyCheckError'
  }
}

/** Merge backup.sqlite rows into the detached work.sqlite copy. */
export class MergeEngine {
  private readonly conflictResolver = new ConflictResolver()
  private readonly fieldMergeStrategy = new FieldMergeStrategy()

  constructor(private readonly registry: ReadonlyBackupRegistry) {}

  /**
   * Open the migrated backup read-only, scan identities, then complete all writes in one
   * synchronous better-sqlite3 transaction. No Promise is created inside the transaction.
   */
  async mergeBackupIntoWork(workSqlite: Database.Database, _workDb: DbType, ctx: MergeContext): Promise<MergeResult> {
    const backupDb = new Database(ctx.backupDbPath, { readonly: true })
    try {
      const ordered = this.registry.topoSort(ctx.domains)
      const decisions = this.scanAggregates(workSqlite, ordered, backupDb, ctx)
      const identityMap: IdentityMap = { sourceMap: new Map(), targetMap: new Map() }
      this.primeTargetAvailability(decisions, identityMap)
      const degradedToSkips: DegradedSkip[] = []
      const appStateSnapshot = this.snapshotAppStateKeys(workSqlite)

      const run = workSqlite.transaction(() => {
        // Foreign keys stay deferred until the complete root/member/junction graph is present.
        workSqlite.pragma('defer_foreign_keys = ON')
        this.importRows(workSqlite, decisions, ctx, backupDb, identityMap, degradedToSkips)
        this.importTagReferences(workSqlite, ctx.domains, backupDb, identityMap)
        this.importAllJunctionRows(workSqlite, ctx.domains, backupDb, identityMap)
        FtsCentralHelper.rebuild(workSqlite)
        this.runConsistencyCheck(workSqlite, appStateSnapshot)
      })
      run()

      return { degradedToSkips }
    } finally {
      backupDb.close()
    }
  }

  /** Scan each backup aggregate by its business identity and find its local canonical PK. */
  private scanAggregates(
    workSqlite: Database.Database,
    ordered: readonly BackupDomain[],
    backupDb: Database.Database,
    ctx: MergeContext
  ): AggregateDecision[] {
    const decisions: AggregateDecision[] = []

    for (const domain of ordered) {
      for (const aggregate of this.registry.getAggregatesForDomain(domain)) {
        const primaryKeyColumns = this.registry.getPrimaryKey(aggregate.root).columns
        const identityColumns = aggregate.identityKey ?? primaryKeyColumns
        const backupRoots = backupDb.prepare(`SELECT * FROM ${quotedTable(aggregate.root)}`).all() as Record<
          string,
          unknown
        >[]

        for (const backupRow of backupRoots) {
          const backupPrimaryKey = this.readKeyTuple(backupRow, primaryKeyColumns, aggregate.root, 'primary key')
          const identity = this.readKeyTuple(backupRow, identityColumns, aggregate.root, 'identity key')
          const localCanonicalPrimaryKey = this.findLocalCanonicalPrimaryKey(
            workSqlite,
            aggregate,
            identityColumns,
            identity,
            primaryKeyColumns
          )
          const skippedByStaging =
            aggregate.root === 'file_entry' && ctx.skippedFileEntryIds.has(String(backupPrimaryKey[0]))
          const action = skippedByStaging
            ? 'skip'
            : localCanonicalPrimaryKey
              ? this.conflictResolver.resolve(aggregate, ctx.userStrategy)
              : 'insert'

          decisions.push({ aggregate, identity, backupPrimaryKey, localCanonicalPrimaryKey, action })
        }
      }
    }

    return decisions
  }

  /** Read an ordered identity or PK tuple and reject malformed nullable key values. */
  private readKeyTuple(
    row: Readonly<Record<string, unknown>>,
    columns: readonly string[],
    table: DbTableName,
    label: string
  ): readonly (string | number)[] {
    return columns.map((column) => {
      const value = row[physicalColumn(column)]
      if (typeof value === 'string' || typeof value === 'number') return value
      throw new Error(`backup ${label} '${table}.${column}' must be a string or number`)
    })
  }

  /** Locate the work row by identityKey and return the physical local primary-key tuple. */
  private findLocalCanonicalPrimaryKey(
    workSqlite: Database.Database,
    aggregate: AggregateBoundary,
    identityColumns: readonly string[],
    identity: readonly (string | number)[],
    primaryKeyColumns: readonly string[]
  ): readonly (string | number)[] | undefined {
    const where = identityColumns.map((column) => `${quotedIdentifier(physicalColumn(column))} = ?`).join(' AND ')
    const select = primaryKeyColumns.map((column) => quotedIdentifier(physicalColumn(column))).join(', ')
    const row = workSqlite
      .prepare(`SELECT ${select} FROM ${quotedTable(aggregate.root)} WHERE ${where} LIMIT 1`)
      .get(...identity) as Record<string, unknown> | undefined
    return row ? this.readKeyTuple(row, primaryKeyColumns, aggregate.root, 'local primary key') : undefined
  }

  /** Pre-register all target survivors so dependent aggregates can be written in any declaration order. */
  private primeTargetAvailability(decisions: readonly AggregateDecision[], identityMap: IdentityMap): void {
    for (const decision of decisions) {
      const canonical =
        decision.localCanonicalPrimaryKey ?? (decision.action === 'insert' ? decision.backupPrimaryKey : undefined)
      if (!canonical || decision.backupPrimaryKey.length !== 1 || canonical.length !== 1) continue
      setIdentityEntry(
        identityMap.targetMap,
        decision.aggregate.root,
        String(decision.backupPrimaryKey[0]),
        String(canonical[0])
      )
    }
  }

  /** Dispatch decisions without allowing strategy fall-through between aggregate actions. */
  private importRows(
    workSqlite: Database.Database,
    decisions: readonly AggregateDecision[],
    ctx: MergeContext,
    backupDb: Database.Database,
    identityMap: IdentityMap,
    degradedToSkips: DegradedSkip[]
  ): void {
    for (const decision of decisions) {
      switch (decision.action) {
        case 'skip':
          // targetMap was primed only when scan found a local survivor; source remains ineligible.
          continue
        case 'insert':
          this.insertAggregate(workSqlite, decision, backupDb, identityMap)
          continue
        case 'field-merge':
          this.fieldMergeAggregate(workSqlite, decision, backupDb, identityMap)
          continue
        case 'overwrite':
        case 'rename':
          throw new MergeStrategyNotImplementedError(decision.action)
      }
    }

    // Kept as a sidecar extension point for later RENAME degradation without widening this slice.
    void ctx
    void degradedToSkips
  }

  /** Insert a root plus include members, propagating every row immediately before its SQL write. */
  private insertAggregate(
    workSqlite: Database.Database,
    decision: AggregateDecision,
    backupDb: Database.Database,
    identityMap: IdentityMap
  ): void {
    const { aggregate, backupPrimaryKey } = decision
    const rootRow = this.getBackupRootRow(backupDb, aggregate, backupPrimaryKey)
    if (!rootRow) return

    const propagatedRoot = propagateIdentityReferences(this.registry, aggregate.root, rootRow, identityMap)
    this.insertRow(workSqlite, aggregate.root, propagatedRoot)
    this.recordImportedRow(identityMap, aggregate.root, backupPrimaryKey, backupPrimaryKey)
    this.importIncludeMembers(workSqlite, aggregate, backupPrimaryKey, backupDb, identityMap)
  }

  /** Merge remote policy-owned fields into a local canonical root without replacing its PK. */
  private fieldMergeAggregate(
    workSqlite: Database.Database,
    decision: AggregateDecision,
    backupDb: Database.Database,
    identityMap: IdentityMap
  ): void {
    const localCanonicalPrimaryKey = decision.localCanonicalPrimaryKey
    if (!localCanonicalPrimaryKey) {
      throw new Error(`FIELD_MERGE '${decision.aggregate.root}' has no local canonical primary key`)
    }

    const backupRoot = this.getBackupRootRow(backupDb, decision.aggregate, decision.backupPrimaryKey)
    const localRoot = this.getWorkRootRow(workSqlite, decision.aggregate, localCanonicalPrimaryKey)
    if (!backupRoot || !localRoot) {
      throw new Error(`FIELD_MERGE '${decision.aggregate.root}' could not load its root rows`)
    }

    // Rewrite remote FK/JSON references before fields are merged and written into the canonical row.
    const propagatedBackupRoot = propagateIdentityReferences(
      this.registry,
      decision.aggregate.root,
      backupRoot,
      identityMap
    )
    const policies = this.getFieldPolicies(decision.aggregate.root)
    const protectedColumns = new Set([
      ...this.registry.getPrimaryKey(decision.aggregate.root).columns.map(physicalColumn),
      ...(decision.aggregate.identityKey ?? []).map(physicalColumn)
    ])
    const merged = this.fieldMergeStrategy.merge({
      localRow: localRoot,
      remoteRow: propagatedBackupRoot,
      policies,
      protectedColumns
    })
    this.updatePolicyColumns(
      workSqlite,
      decision.aggregate.root,
      merged,
      localCanonicalPrimaryKey,
      policies,
      protectedColumns
    )
    this.recordImportedRow(identityMap, decision.aggregate.root, decision.backupPrimaryKey, localCanonicalPrimaryKey)
    // Existing member PKs are local survivors on a FIELD_MERGE rerun; skip only those
    // exact PK collisions while preserving fail-closed handling for other constraints.
    this.importIncludeMembers(workSqlite, decision.aggregate, decision.backupPrimaryKey, backupDb, identityMap, true)
  }

  /** Import include members in declaration order, optionally preserving local PK survivors. */
  private importIncludeMembers(
    workSqlite: Database.Database,
    aggregate: AggregateBoundary,
    backupPrimaryKey: readonly (string | number)[],
    backupDb: Database.Database,
    identityMap: IdentityMap,
    skipExistingPrimaryKeys = false
  ): void {
    const memberPksByTable = new Map<DbTableName, Set<string>>()
    for (const member of aggregate.members ?? []) {
      if (member.cascade !== 'include') continue
      const anchorIds = member.parent
        ? (memberPksByTable.get(member.parent) ?? new Set<string>())
        : new Set(backupPrimaryKey.map(String))
      if (anchorIds.size === 0) continue

      const placeholders = [...anchorIds].map(() => '?').join(', ')
      const memberRows = backupDb
        .prepare(
          `SELECT * FROM ${quotedTable(member.table)} WHERE ${quotedIdentifier(physicalColumn(member.viaColumn))} IN (${placeholders})`
        )
        .all(...anchorIds) as Record<string, unknown>[]
      const memberPrimaryKeyColumns = this.registry.getPrimaryKey(member.table).columns

      for (const memberRow of memberRows) {
        const memberPrimaryKey = this.readKeyTuple(memberRow, memberPrimaryKeyColumns, member.table, 'primary key')
        const memberPrimaryKeyValue = String(memberPrimaryKey[0])
        const previous = memberPksByTable.get(member.table) ?? new Set<string>()
        memberPksByTable.set(member.table, new Set([...previous, memberPrimaryKeyValue]))

        if (skipExistingPrimaryKeys && this.hasWorkPrimaryKey(workSqlite, member.table, memberPrimaryKey)) continue

        // Apply identity propagation immediately before the member reaches SQLite.
        const propagatedMember = propagateIdentityReferences(this.registry, member.table, memberRow, identityMap)
        this.insertRow(workSqlite, member.table, propagatedMember)
        this.recordImportedRow(identityMap, member.table, memberPrimaryKey, memberPrimaryKey)
      }
    }
  }

  /** Check exact primary-key existence without masking a different unique-constraint conflict. */
  private hasWorkPrimaryKey(
    workSqlite: Database.Database,
    table: DbTableName,
    primaryKey: readonly (string | number)[]
  ): boolean {
    const primaryKeyColumns = this.registry.getPrimaryKey(table).columns.map(physicalColumn)
    const where = primaryKeyColumns.map((column) => `${quotedIdentifier(column)} = ?`).join(' AND ')
    return (
      workSqlite.prepare(`SELECT 1 FROM ${quotedTable(table)} WHERE ${where} LIMIT 1`).get(...primaryKey) !== undefined
    )
  }

  /** Load a root row from backup.sqlite by its declared physical primary key. */
  private getBackupRootRow(
    backupDb: Database.Database,
    aggregate: AggregateBoundary,
    primaryKey: readonly (string | number)[]
  ): Record<string, unknown> | undefined {
    const where = this.registry
      .getPrimaryKey(aggregate.root)
      .columns.map((column) => `${quotedIdentifier(physicalColumn(column))} = ?`)
      .join(' AND ')
    return backupDb.prepare(`SELECT * FROM ${quotedTable(aggregate.root)} WHERE ${where}`).get(...primaryKey) as
      | Record<string, unknown>
      | undefined
  }

  /** Load the survivor row from work.sqlite by the canonical local primary key. */
  private getWorkRootRow(
    workSqlite: Database.Database,
    aggregate: AggregateBoundary,
    primaryKey: readonly (string | number)[]
  ): Record<string, unknown> | undefined {
    const where = this.registry
      .getPrimaryKey(aggregate.root)
      .columns.map((column) => `${quotedIdentifier(physicalColumn(column))} = ?`)
      .join(' AND ')
    return workSqlite.prepare(`SELECT * FROM ${quotedTable(aggregate.root)} WHERE ${where}`).get(...primaryKey) as
      | Record<string, unknown>
      | undefined
  }

  /** Translate a contributor's logical field policies into the physical raw-SQL column names. */
  private getFieldPolicies(table: DbTableName): readonly FieldMergeColumnPolicy[] {
    const owner = this.registry.getTableOwner(table)
    if (owner === 'excluded' || owner === 'infrastructure') return []
    return (this.registry.getPolicy(owner).fieldMergePolicies ?? [])
      .filter((policy) => policy.table === table)
      .map((policy) => ({ column: physicalColumn(policy.column), strategy: policy.strategy }))
  }

  /** Update only declared policy columns, keeping every unlisted local field untouched. */
  private updatePolicyColumns(
    workSqlite: Database.Database,
    table: DbTableName,
    merged: Readonly<Record<string, unknown>>,
    primaryKey: readonly (string | number)[],
    policies: readonly FieldMergeColumnPolicy[],
    protectedColumns: ReadonlySet<string>
  ): void {
    const workColumns = this.getWorkColumns(workSqlite, table)
    const columns = [...new Set(policies.map((policy) => policy.column))].filter(
      (column) => workColumns.has(column) && !protectedColumns.has(column) && merged[column] !== undefined
    )
    if (columns.length === 0) return

    const primaryKeyColumns = this.registry.getPrimaryKey(table).columns.map(physicalColumn)
    const where = primaryKeyColumns.map((column) => `${quotedIdentifier(column)} = ?`).join(' AND ')
    const set = columns.map((column) => `${quotedIdentifier(column)} = ?`).join(', ')
    workSqlite
      .prepare(`UPDATE ${quotedTable(table)} SET ${set} WHERE ${where}`)
      .run(...columns.map((column) => merged[column]), ...primaryKey)
  }

  /** Record a row imported this restore as both an eligible source and available target. */
  private recordImportedRow(
    identityMap: IdentityMap,
    table: DbTableName,
    backupPrimaryKey: readonly (string | number)[],
    canonicalPrimaryKey: readonly (string | number)[]
  ): void {
    if (backupPrimaryKey.length !== 1 || canonicalPrimaryKey.length !== 1) return
    const backupId = String(backupPrimaryKey[0])
    const canonicalId = String(canonicalPrimaryKey[0])
    setIdentityEntry(identityMap.sourceMap, table, backupId, canonicalId)
    setIdentityEntry(identityMap.targetMap, table, backupId, canonicalId)
  }

  /** Import entity_tag's single declared target FK after tag canonicalization. */
  private importTagReferences(
    workSqlite: Database.Database,
    selectedDomains: readonly BackupDomain[],
    backupDb: Database.Database,
    identityMap: IdentityMap
  ): void {
    if (!selectedDomains.includes('TAGS_GROUPS')) return
    const tagSourceMap = identityMap.sourceMap.get('tag')
    if (!tagSourceMap || tagSourceMap.size === 0) return

    const rows = backupDb.prepare('SELECT * FROM entity_tag').all() as Record<string, unknown>[]
    for (const row of rows) {
      const tagId = row.tag_id
      // A skipped tag is an available local target but is not an eligible backup source.
      if ((typeof tagId !== 'string' && typeof tagId !== 'number') || !tagSourceMap.has(String(tagId))) continue
      const propagated = propagateIdentityReferences(this.registry, 'entity_tag', row, identityMap)
      this.insertRow(workSqlite, 'entity_tag', propagated, { onConflictDoNothing: true })
    }
  }

  /** Import pure two-ended junctions only after all aggregate source/target maps are complete. */
  private importAllJunctionRows(
    workSqlite: Database.Database,
    selectedDomains: readonly BackupDomain[],
    backupDb: Database.Database,
    identityMap: IdentityMap
  ): void {
    for (const descriptor of deriveJunctionDescriptors(this.registry, selectedDomains)) {
      const sourceColumn = physicalColumn(descriptor.sourceEndpoint.fkColumn)
      const targetColumn = physicalColumn(descriptor.targetEndpoint.fkColumn)
      const rows = backupDb.prepare(`SELECT * FROM ${quotedTable(descriptor.table)}`).all() as Record<string, unknown>[]

      for (const row of rows) {
        const sourceId = row[sourceColumn]
        const targetId = row[targetColumn]
        if (
          (typeof sourceId !== 'string' && typeof sourceId !== 'number') ||
          (typeof targetId !== 'string' && typeof targetId !== 'number')
        ) {
          continue
        }
        const sourceCanonical = identityMap.sourceMap.get(descriptor.sourceEndpoint.table)?.get(String(sourceId))
        const targetCanonical = identityMap.targetMap.get(descriptor.targetEndpoint.table)?.get(String(targetId))
        if (sourceCanonical === undefined || targetCanonical === undefined) continue

        this.insertJunctionRow(
          workSqlite,
          descriptor.table,
          row,
          sourceColumn,
          sourceCanonical,
          targetColumn,
          targetCanonical
        )
      }
    }
  }

  /** Write a junction row with both endpoints canonicalized and preserve idempotency on its composite PK. */
  private insertJunctionRow(
    workSqlite: Database.Database,
    table: DbTableName,
    row: Readonly<Record<string, unknown>>,
    sourceColumn: string,
    sourceCanonical: string,
    targetColumn: string,
    targetCanonical: string
  ): void {
    const rewritten = { ...row, [sourceColumn]: sourceCanonical, [targetColumn]: targetCanonical }
    this.insertRow(workSqlite, table, rewritten, { onConflictDoNothing: true })
  }

  /** Insert one schema-compatible row, dropping backup-only and FTS-derived columns. */
  private insertRow(
    workSqlite: Database.Database,
    table: DbTableName,
    row: Readonly<Record<string, unknown>>,
    options: { readonly onConflictDoNothing?: boolean } = {}
  ): void {
    const workColumns = this.getWorkColumns(workSqlite, table)
    const isFtsSource = FTS_SOURCE_TABLES.has(table)
    const columns = Object.keys(row).filter(
      (column) => workColumns.has(column) && !(isFtsSource && FTS_DERIVED_PHYSICAL_COLUMNS.has(column))
    )
    if (columns.length === 0) return

    const placeholders = columns.map(() => '?').join(', ')
    const conflictClause = options.onConflictDoNothing ? ' ON CONFLICT DO NOTHING' : ''
    workSqlite
      .prepare(
        `INSERT INTO ${quotedTable(table)} (${columns.map(quotedIdentifier).join(', ')}) VALUES (${placeholders})${conflictClause}`
      )
      .run(...columns.map((column) => row[column]))
  }

  /** Read physical work columns once per write to preserve schema-drift containment. */
  private getWorkColumns(workSqlite: Database.Database, table: DbTableName): ReadonlySet<string> {
    return new Set(
      (workSqlite.prepare(`PRAGMA table_info(${quotedTable(table)})`).all() as { name: string }[]).map(
        (column) => column.name
      )
    )
  }

  /** Read the app_state key-set so the merge cannot accidentally alter boot/runtime state. */
  private snapshotAppStateKeys(workSqlite: Database.Database): ReadonlySet<string> | undefined {
    const exists = workSqlite.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'app_state'").get()
    if (!exists) return undefined
    const rows = workSqlite.prepare('SELECT key FROM app_state').all() as { key: string }[]
    return new Set(rows.map((row) => row.key))
  }

  /** Verify FK, SQLite integrity, FTS integrity, and app_state key preservation before commit. */
  private runConsistencyCheck(workSqlite: Database.Database, appStateBefore: ReadonlySet<string> | undefined): void {
    const fkViolations = workSqlite.pragma('foreign_key_check') as unknown[]
    if (fkViolations.length > 0) {
      throw new MergeConsistencyCheckError(`foreign_key_check returned ${fkViolations.length} violations`)
    }

    const integrity = workSqlite.pragma('integrity_check', { simple: true })
    if (integrity !== 'ok') {
      throw new MergeConsistencyCheckError(`integrity_check: ${JSON.stringify(integrity)}`)
    }

    FtsCentralHelper.integrityCheck(workSqlite)
    if (!appStateBefore) return
    const appStateAfter = this.snapshotAppStateKeys(workSqlite)
    if (
      !appStateAfter ||
      appStateAfter.size !== appStateBefore.size ||
      [...appStateAfter].some((key) => !appStateBefore.has(key))
    ) {
      throw new MergeConsistencyCheckError(
        `app_state key-set changed: ${appStateBefore.size} → ${appStateAfter?.size ?? 0}`
      )
    }
  }
}
