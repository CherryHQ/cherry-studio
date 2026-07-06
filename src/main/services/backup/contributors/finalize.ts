// ContributorManager.finalize() core — validates the 26 registry invariants
// (registry.md §"finalize 26 不变量") against the codegen facts (DB_TABLES /
// DB_COLUMNS_BY_TABLE / DB_FOREIGN_KEYS) and the contributor declarations,
// then builds the immutable registry data. Pure / in-memory — never touches
// SQLite (full-table coverage is the coverage test's job, registry.md §"finalize
// 不连 DB 与覆盖率守门").
//
// `finalize` takes the contributors as a parameter so it is unit-testable with
// synthetic contributors; the production ContributorManager wires the real 14
// in via the CONTRIBUTORS barrel (B track).
import type {
  AggregateBoundary,
  BackupContributor,
  EntityReference,
  ReadonlyBackupRegistry
} from '@main/data/db/backup/contributorTypes'
import {
  DB_COLUMNS_BY_TABLE,
  DB_FOREIGN_KEYS,
  DB_JSON_COLUMNS,
  DB_TABLES,
  DB_UNIQUE_KEYS,
  type DbColumnName,
  type DbTableName
} from '@main/data/db/backup/dbSchemaRefs'
import { BACKUP_DOMAINS, type BackupDomain } from '@main/data/db/backup/domains'
import { ALWAYS_STRIP_TABLES, INFRASTRUCTURE_TABLES, RUNTIME_EXCLUDED_FILE_REF_SOURCES } from '@main/data/db/backup/exclusions'
import { allSourceTypes, type FileRefSourceType } from '@shared/data/types/file'

import { ContributorFinalizeError, type ContributorFinalizePayload } from './ContributorFinalizeError'
import { type FinalizedRegistryData, ReadonlyBackupRegistryImpl } from './ReadonlyBackupRegistryImpl'

const DB_TABLES_SET: ReadonlySet<DbTableName> = new Set(DB_TABLES)

/** Throw an invariant violation carrying a locator payload. Declared as a function
 *  (returning never) so control-flow analysis narrows after `if (!x) fail(...)`. */
function fail(payload: ContributorFinalizePayload): never {
  throw new ContributorFinalizeError(payload)
}

/** True when two EntityReferences name the same column + kind (used by #7 / #20). */
const sameReference = (a: EntityReference, b: EntityReference): boolean =>
  a.table === b.table && a.column === b.column && a.kind === b.kind

/** True when two column lists hold the same members, order-insensitive (used by #13). */
const sameColumnSet = (a: readonly DbColumnName[], b: readonly DbColumnName[]): boolean =>
  a.length === b.length && a.every((col) => b.includes(col))

/** Runtime set of BACKUP_DOMAINS for polymorphicEntityMap value validation (#polymorphic). */
const BACKUP_DOMAINS_SET: ReadonlySet<string> = new Set<string>(BACKUP_DOMAINS)

/**
 * Lightweight glob legality check (architecture §6.1 platformSpecificKeys). A glob is
 * syntactically legal if it contains only glob-safe characters AND its bracket groups
 * are balanced. minimatch/picomatch are not dependencies, so we validate syntax only
 * (not semantics) — this catches typos like stray spaces or unbalanced `[` without
 * pulling in a glob engine.
 */
function isLegalGlob(glob: string): boolean {
  // Allowed characters: alphanumerics + glob metacharacters + path separators.
  if (!/^[A-Za-z0-9.*?\[\]\-_/]*$/.test(glob)) return false
  // Bracket groups must be balanced (each '[' has a matching ']').
  let depth = 0
  for (const ch of glob) {
    if (ch === '[') depth++
    else if (ch === ']') {
      depth--
      if (depth < 0) return false // ']' before any '[' — unbalanced.
    }
  }
  return depth === 0
}

/**
 * Map a generated FK's onDelete to the ReferenceKind it implies (registry.md #19).
 * cascade/restrict → owning; set null/no action → optional; set default → rejected.
 */
const expectedKindForOnDelete = (
  onDelete: 'cascade' | 'restrict' | 'set null' | 'no action' | 'set default',
  declaredKind: EntityReference['kind']
): 'owning' | 'optional' => {
  if (onDelete === 'set default') fail({ invariant: 19, schemaOnDelete: 'set default', declaredKind })
  return onDelete === 'cascade' || onDelete === 'restrict' ? 'owning' : 'optional'
}

/**
 * Validate the 26 registry invariants and produce an immutable registry. Throws
 * ContributorFinalizeError (invariant id + locator payload, #18) on the first
 * violation. Invariant #17 (deep-freeze) is the B track's responsibility — it
 * freezes each contributor constant at load via freeze.deepFreeze; finalize and
 * the registry only ever read.
 */
export function finalize(
  contributors: readonly BackupContributor[],
  meta: { finalizedAt: string; schemaCommit: string }
): ReadonlyBackupRegistry {
  // ── #1: exactly one contributor per domain; the set is the 14 BACKUP_DOMAINS ─
  const byDomain = new Map<BackupDomain, BackupContributor>()
  for (const c of contributors) {
    if (byDomain.has(c.domain)) fail({ invariant: 1, extraDomains: [c.domain] })
    byDomain.set(c.domain, c)
  }
  const missingDomains = BACKUP_DOMAINS.filter((d) => !byDomain.has(d))
  if (missingDomains.length > 0) fail({ invariant: 1, missingDomains })
  // Duplicate domains fail above (byDomain.has → extraDomains). A domain outside
  // BACKUP_DOMAINS is impossible by type (contributors.domain: BackupDomain), so no
  // separate extra-set check is needed.

  // ── #2/#3: owned tables ∈ DB_TABLES, no table multi-owned ────────────────────
  const tableOwner = new Map<DbTableName, BackupDomain>()
  for (const c of contributors) {
    for (const table of c.schema.tables) {
      if (!DB_TABLES_SET.has(table)) {
        fail({ invariant: 2, table, status: 'owned-not-in-DB_TABLES', owners: [c.domain] })
      }
      const prev = tableOwner.get(table)
      if (prev) fail({ invariant: 3, table, status: 'multi-owned', owners: [prev, c.domain] })
      tableOwner.set(table, c.domain)
    }
  }

  // ── #4/#5: ALWAYS_STRIP / INFRASTRUCTURE tables are never contributor-owned ──
  for (const c of contributors) {
    for (const table of c.schema.tables) {
      if (ALWAYS_STRIP_TABLES.has(table) || INFRASTRUCTURE_TABLES.has(table)) {
        fail({ invariant: 4, table, declaredBy: c.domain })
      }
    }
  }

  // ── #6: every declared reference's source table belongs to the declaring owner ─
  for (const c of contributors) {
    const owned = new Set<DbTableName>(c.schema.tables)
    for (const ref of c.schema.references) {
      if (!owned.has(ref.table)) fail({ invariant: 6, domain: c.domain, table: ref.table })
    }
  }

  // ── #7: omittedReferenceOverrides bind a declared ref + are non-redundant + reasoned
  for (const c of contributors) {
    for (const o of c.backupPolicy.omittedReferenceOverrides ?? []) {
      const declared = c.schema.references.find((r) => sameReference(r, o.reference))
      if (!declared) fail({ invariant: 7, domain: c.domain, reference: o.reference, reason: 'reference-not-declared' })
      // default action is ReferenceKind→action; an override equal to the default is redundant.
      const defaultAction =
        declared.kind === 'optional' ? 'SET_NULL' : declared.kind === 'owning' ? 'DELETE_ROW' : 'cascade-prune'
      if (defaultAction === o.action)
        fail({ invariant: 7, domain: c.domain, reference: o.reference, reason: 'redundant-override' })
      if (!o.reason) fail({ invariant: 7, domain: c.domain, reference: o.reference, reason: 'empty-reason' })
    }
  }

  // ── #8/#9/#22: every owned table has a PK fact; columns real; non-ambiguous; non-autoincrement ─
  for (const c of contributors) {
    for (const table of c.schema.tables) {
      const pk = c.schema.primaryKeys.find((fact) => fact.table === table)
      if (!pk) fail({ invariant: 8, table, expectedColumns: '<missing-pk-fact>' })
      if (pk.kind === 'autoincrement') fail({ invariant: 22, table, kind: 'autoincrement' })
      if (pk.ambiguous === true) fail({ invariant: 9, table })
      const codegenColumns = DB_COLUMNS_BY_TABLE[table]
      for (const col of pk.columns) {
        if (!codegenColumns.some((entry) => entry.name === col)) {
          fail({ invariant: 8, table, expectedColumns: String(col) })
        }
      }
    }
  }

  // ── #10: references-derived domain dependency graph is acyclic (Kahn) ─────────
  const domainDependencies = new Map<BackupDomain, Set<BackupDomain>>()
  for (const c of contributors) domainDependencies.set(c.domain, new Set())
  for (const c of contributors) {
    for (const ref of c.schema.references) domainDependencies.get(c.domain)!.add(ref.referencedDomain)
  }
  detectCycle(domainDependencies, BACKUP_DOMAINS)

  // ── #11: every FileRefSourceType is owned or runtime-only-excluded (set diff) ─
  // Runtime-only sourceTypes (in-memory, no owner) are pre-covered — architecture
  // L193/L283 "temp_session excluded（runtime）", contributor-spec §11 runtime-only-exclude.
  const coveredSources = new Set<FileRefSourceType>(RUNTIME_EXCLUDED_FILE_REF_SOURCES)
  for (const c of contributors) {
    for (const p of c.schema.fileRefSourcePolicies) {
      // 'include-with-owner' ⇒ the declaring domain IS the owner.
      if (p.resourcePolicy === 'include-with-owner' && p.ownerDomain !== c.domain) {
        fail({ invariant: 11, sourceType: p.sourceType, owner: p.ownerDomain })
      }
      coveredSources.add(p.sourceType)
    }
  }
  for (const st of allSourceTypes) {
    if (!coveredSources.has(st)) fail({ invariant: 11, unownedSourceType: st })
  }

  // ── #12: jsonSoftReferences bidirectional subset (declared ⊆ DB_JSON_COLUMNS and
  //         DB_JSON_COLUMNS ⊆ declared ∪ exempt) ─────────────────────────────────
  // (A) declared subset: every declared jsonSoftReference column MUST be a JSON column
  //     in DB_JSON_COLUMNS — declaring a non-JSON column as a jsonSoftReference is a
  //     bug (codegen is the only trusted source of json-ness; the contributor can no
  //     longer "trust" its own declaration). Closes the "json-ness trusted" hole.
  // (B) exhaustiveness subset: every JSON column on an owned table must be EITHER a
  //     declared jsonSoftReference OR listed in exemptJsonCols (with a reason). A JSON
  //     column carrying soft refs that is neither declared nor exempted would silently
  //     drop cross-entity links on restore. UNCONDITIONAL (no opt-in gate) — the loop
  //     below iterates every owned (non-excluded) table's every DB_JSON_COLUMNS column.
  for (const c of contributors) {
    const owned = new Set<DbTableName>(c.schema.tables)
    // (A) declared ⊆ DB_JSON_COLUMNS (columns exist + are genuinely JSON).
    for (const j of c.schema.jsonSoftReferences) {
      if (!owned.has(j.table)) fail({ invariant: 12, table: j.table, column: j.column, reason: 'owned-mismatch' })
      if (!DB_COLUMNS_BY_TABLE[j.table]?.some((entry) => entry.name === j.column)) {
        fail({ invariant: 12, table: j.table, column: j.column, reason: 'column-not-found' })
      }
      const jsonCols = DB_JSON_COLUMNS[j.table]
      if (!jsonCols?.some((col) => col === j.column)) {
        fail({ invariant: 12, table: j.table, column: j.column, reason: 'declared-not-json-column' })
      }
    }
    // (B) DB_JSON_COLUMNS ⊆ declared ∪ exempt — exhaustiveness is UNCONDITIONAL:
    //     every JSON column on an owned (non-excluded) table MUST be a declared
    //     jsonSoftReference OR explicitly exempt (exemptJsonCols, with reason).
    //     No opt-in gate: a future contributor owning a JSON table but declaring
    //     neither would fail loudly right here (the whole point of #12).
    const declaredJson = new Set(
      c.schema.jsonSoftReferences.map((j) => `${j.table}::${j.column}`)
    )
    const exemptJson = new Set((c.schema.exemptJsonCols ?? []).map((e) => `${e.table}::${e.column}`))
    for (const table of c.schema.tables) {
      if (ALWAYS_STRIP_TABLES.has(table) || INFRASTRUCTURE_TABLES.has(table)) continue
      for (const col of DB_JSON_COLUMNS[table]) {
        const key = `${table}::${col}`
        if (!declaredJson.has(key) && !exemptJson.has(key)) {
          fail({ invariant: 12, table, column: col, reason: 'json-column-not-covered' })
        }
      }
    }
  }

  // ── #13/#14/#15/#16: aggregate boundaries ───────────────────────────────────
  for (const c of contributors) {
    const owned = new Set<DbTableName>(c.schema.tables)
    for (const agg of c.schema.aggregates) {
      // #13: root owned by this domain; identityKey columns are real.
      if (!owned.has(agg.root)) fail({ invariant: 13, domain: c.domain, aggregate: agg.root })
      const rootPk = c.schema.primaryKeys.find((fact) => fact.table === agg.root)
      const identityKey = agg.identityKey ?? rootPk?.columns ?? []
      for (const col of identityKey) {
        if (!DB_COLUMNS_BY_TABLE[agg.root]?.some((entry) => entry.name === col)) {
          fail({ invariant: 13, domain: c.domain, aggregate: agg.root })
        }
      }
      // #13 (unique-backing): a natural-key/slot identityKey that is NOT the root
      // PK must be backed by a real UNIQUE constraint (codegen DB_UNIQUE_KEYS) —
      // otherwise a cross-device restore could merge two distinct rows that happen
      // to share an identityKey value. PK-backed identityKeys are exempt because a
      // PK is inherently unique; this lets preference (composite PK [scope,key]),
      // translate_language (natural PK [langCode]) and future natural-PK domains
      // pass without a separate unique index. uuid-entity identityKeys are always
      // PK-backed, so they never reach the unique lookup.
      if (rootPk && !sameColumnSet(identityKey, rootPk.columns)) {
        const identityClass =
          agg.identityClass ?? (rootPk.kind === 'uuid-v4' || rootPk.kind === 'uuid-v7' ? 'uuid-entity' : 'natural-key')
        if (identityClass !== 'uuid-entity') {
          const backed = DB_UNIQUE_KEYS[agg.root].some((u) => sameColumnSet(u.columns, identityKey))
          if (!backed) {
            fail({ invariant: 13, domain: c.domain, aggregate: agg.root, missingUnique: [...identityKey] })
          }
        }
      }
      // #14: each member derives from an in-domain OWNING reference on viaColumn
      //      (junction tables and cross-domain refs are explicitly excluded,
      //      registry.md #14); only `include`-cascade members are derived this way.
      //      The member→parent chain must also be acyclic.
      const members = agg.members ?? []
      for (const m of members) {
        if (m.cascade !== 'include') fail({ invariant: 14, domain: c.domain, aggregate: agg.root, member: m.table })
        const derives = c.schema.references.some(
          (r) => r.table === m.table && r.column === m.viaColumn && r.kind === 'owning'
        )
        if (!derives) fail({ invariant: 14, domain: c.domain, aggregate: agg.root, member: m.table })
      }
      detectMemberParentCycle(agg.root, members, c.domain, agg.root)
      // #15: member tables owned by this domain; viaColumn is a real FK bound to
      //      the root or the member's declared parent (registry.md #15).
      for (const m of members) {
        if (!owned.has(m.table)) fail({ invariant: 15, domain: c.domain, aggregate: agg.root, member: m.table })
        const parentTable = m.parent ?? agg.root
        const memberFks = DB_FOREIGN_KEYS[m.table]
        const bound = memberFks.some(
          (fk) => fk.columns.some((col) => col === m.viaColumn) && fk.targetTable === parentTable
        )
        if (!bound) fail({ invariant: 15, domain: c.domain, aggregate: agg.root, member: m.table })
      }
      // #16: renamable aggregates must supply cloneAggregate.
      if (agg.renamable && c.operations?.cloneAggregate === undefined) {
        fail({ invariant: 16, domain: c.domain, aggregate: agg.root })
      }
      // #26: renamable aggregates must have a single-column root PK — the importer's
      // newRootKey is a single value and cloneAggregate replaces exactly one PK
      // column (registry.getPrimaryKey(root).columns[0]). A composite-PK renamable
      // aggregate would silently corrupt identity on rename, so it is forbidden;
      // the remedy is to set renamable:false, not to change the schema.
      if (agg.renamable && rootPk && rootPk.columns.length !== 1) {
        fail({
          invariant: 26,
          domain: c.domain,
          aggregate: agg.root,
          pkColumns: [...rootPk.columns],
          reason: 'renamable-requires-single-column-pk'
        })
      }
    }
  }

  // ── #19/#20/#24: EntityReference.kind vs generated FK onDelete; NOT-NULL guard ─
  for (const c of contributors) {
    const overrides = c.backupPolicy.omittedReferenceOverrides ?? []
    for (const ref of c.schema.references) {
      const fks = DB_FOREIGN_KEYS[ref.table]
      // #24: the declared reference must correspond to a generated FK.
      const fk = fks.find((f) => f.columns.some((col) => col === ref.column))
      if (!fk) fail({ invariant: 24, domain: c.domain, reference: ref })
      // #6 (extended): the declared referencedDomain must be the owner of the FK
      // target table — a wrong referencedDomain corrupts the dependency graph and
      // omitted-reference logic. Skipped when the target is owned by no one (that
      // gap is the coverage test's concern, not finalize's).
      const targetOwner = tableOwner.get(fk.targetTable)
      if (targetOwner !== undefined && ref.referencedDomain !== targetOwner) {
        fail({ invariant: 6, domain: c.domain, table: ref.table, reference: ref, reason: 'referencedDomain-mismatch' })
      }
      // #19: declared kind must match the FK onDelete policy (junction tolerated as owning).
      const expected = expectedKindForOnDelete(fk.onDelete, ref.kind)
      if (ref.kind !== expected && !(ref.kind === 'junction' && expected === 'owning')) {
        fail({ invariant: 19, domain: c.domain, reference: ref, schemaOnDelete: fk.onDelete, declaredKind: ref.kind })
      }
      // #20: a junction reference's FK must cascade (co-owned at both ends); a
      //      declared junction whose FK is restrict/no-action is a mis-classification.
      if (ref.kind === 'junction' && fk.onDelete !== 'cascade') {
        fail({
          invariant: 20,
          domain: c.domain,
          reference: ref,
          column: ref.column,
          nullability: 'junction-non-cascade'
        })
      }
      // #20: an optional reference on a NOT NULL column is unsafe (SET_NULL impossible)
      //      unless an omittedReferenceOverride declares a leaf/junction-only semantics.
      if (ref.kind === 'optional') {
        const col = DB_COLUMNS_BY_TABLE[ref.table]?.find((entry) => entry.name === ref.column)
        const notNullAndNoOverride = col && !col.isNullable && !overrides.some((o) => sameReference(o.reference, ref))
        if (notNullAndNoOverride) {
          fail({ invariant: 20, domain: c.domain, reference: ref, column: ref.column, nullability: 'NOT NULL' })
        }
      }
    }
  }

  // ── #21: natural-key/slot aggregates must not default to SKIP (settings exempt) ─
  for (const c of contributors) {
    for (const agg of c.schema.aggregates) {
      const rootPk = c.schema.primaryKeys.find((fact) => fact.table === agg.root)
      const identityClass =
        agg.identityClass ?? (rootPk?.kind === 'uuid-v4' || rootPk?.kind === 'uuid-v7' ? 'uuid-entity' : 'natural-key')
      const isSettings = c.domain === 'PREFERENCES' // settings exception: preference (note TBD in B)
      if (
        (identityClass === 'natural-key' || identityClass === 'slot') &&
        agg.conflictDefault === 'SKIP' &&
        !isSettings
      ) {
        fail({ invariant: 21, domain: c.domain, aggregate: agg.root, identityClass, conflictDefault: 'SKIP' })
      }
    }
  }

  // ── platformSpecificKeys enforcement (architecture §6.1) ──────────────────────
  // (a) ONLY PREFERENCES may declare platformSpecificKeys — any other contributor with
  //     a non-empty list is a deviation (platform keys are a settings-only concept).
  // (b) each entry must be a syntactically legal glob (validated via isLegalGlob).
  for (const c of contributors) {
    const keys = c.backupPolicy.platformSpecificKeys ?? []
    if (keys.length > 0 && c.domain !== 'PREFERENCES') {
      fail({
        invariant: 21,
        domain: c.domain,
        deviation: 'platformSpecificKeys-on-non-preferences',
        keys: [...keys]
      })
    }
    for (const glob of keys) {
      if (!isLegalGlob(glob)) {
        fail({ invariant: 21, domain: c.domain, deviation: 'malformed-platformSpecificKey', glob })
      }
    }
  }

  // ── polymorphicEntityMap validation (architecture L201) ───────────────────────
  // Reuses invariant #21 as the payload id (an identity-routing deviation, shared with
  // the platformSpecificKeys check above) and disambiguates via the `deviation` subkey —
  // see contributor-spec.md §4.2. Record<EntityType, BackupDomain | 'excluded'> is
  // compile-time exhaustive over keys, so the runtime check is thin: every VALUE must
  // be a known BackupDomain or 'excluded'. A value that is neither (a typo or a stale
  // domain after a rename) would route rows to a non-existent owner and silently drop them.
  for (const c of contributors) {
    const map = c.schema.polymorphicEntityMap
    if (map === undefined) continue
    for (const [entityType, mappedTo] of Object.entries(map)) {
      if (mappedTo !== 'excluded' && !BACKUP_DOMAINS_SET.has(mappedTo as string)) {
        fail({ invariant: 21, domain: c.domain, entityType, mappedTo, deviation: 'polymorphic-unknown-target' })
      }
    }
  }

  // ── #23: shared-table rowScopes — structural check + typeCoverage consistency ─
  // The filter column must be real; if the contributor declares typeCoverage, every
  // JobType key maps to 'owned'|'excluded' (Record<JobType,...> is compile-time
  // exhaustive over keys, so runtime only validates value shape) AND every key the
  // filter matches as 'owned' must agree with the scope's ownership intent — a JobType
  // the filter selects but typeCoverage marks 'excluded' is an inconsistency that would
  // drop matched rows silently.
  for (const c of contributors) {
    for (const scope of c.schema.rowScopes ?? []) {
      if (!DB_COLUMNS_BY_TABLE[scope.table]?.some((entry) => entry.name === scope.filter.column)) {
        fail({ invariant: 23, table: scope.table, uncoveredTypes: `<bad-filter-column ${scope.filter.column}>` })
      }
      const coverage = scope.typeCoverage
      if (coverage === undefined) continue
      for (const [jobType, status] of Object.entries(coverage)) {
        if (status !== 'owned' && status !== 'excluded') {
          fail({
            invariant: 23,
            table: scope.table,
            jobType,
            deviation: 'typeCoverage-invalid-status',
            status
          })
        }
        // A type whose filter value equals this scope's filter.value MUST be 'owned' —
        // the filter selects those rows, so they belong to this domain by construction.
        if (status === 'excluded' && jobType === scope.filter.value) {
          fail({
            invariant: 23,
            table: scope.table,
            jobType,
            deviation: 'typeCoverage-excludes-filtered-type',
            filterValue: scope.filter.value
          })
        }
        // Conversely, a type marked 'owned' must be the one the filter selects —
        // marking an unmatched type 'owned' claims rows the filter never picks.
        if (status === 'owned' && jobType !== scope.filter.value) {
          fail({
            invariant: 23,
            table: scope.table,
            jobType,
            deviation: 'typeCoverage-owned-without-filter-match',
            filterValue: scope.filter.value
          })
        }
      }
    }
  }

  // ── #25: every DB FK on an owned (non-excluded) table is declared by its owner ─
  // Iterate DB_TABLES (not Object.entries(DB_FOREIGN_KEYS)) so `table` stays a
  // DbTableName and `fk.columns` elements stay DbColumnName — no casts needed.
  for (const table of DB_TABLES) {
    if (ALWAYS_STRIP_TABLES.has(table) || !tableOwner.has(table)) continue
    const fks = DB_FOREIGN_KEYS[table]
    const owner = tableOwner.get(table)!
    const ownerContributor = byDomain.get(owner)!
    const declaredColumns = new Set<DbColumnName>(
      ownerContributor.schema.references.filter((r) => r.table === table).map((r) => r.column)
    )
    for (const fk of fks) {
      // polymorphic soft-ref table (entity_tag) is exempt — its FKs are
      // domain-polymorphic, declared via fileRefSourcePolicies/jsonSoftReferences.
      // (file_ref was the other exempt table pre-#16532; it was split into
      // chat_message_file_ref + painting_file_ref, which have real single-column FKs
      // and are NOT polymorphic, so they are not exempt — their owners declare FKs.)
      if (table === 'entity_tag') continue
      // EntityReference is single-column, so a composite FK is treated as declared
      // when ANY of its columns is declared (its principal column carries the ref).
      // Requiring every column is impossible here: #24 demands each declared column
      // have its own FK, and a composite FK's secondary columns (e.g. the groupId in
      // knowledge_item's [baseId,groupId] self-link) have no standalone FK. Same-domain
      // self-FKs don't affect cross-domain topology anyway. Complete composite-FK
      // coverage is the importer/coverage test's job, not finalize's.
      if (!fk.columns.some((col) => declaredColumns.has(col))) {
        fail({ invariant: 25, table, columns: [...fk.columns], missingFromDomain: owner })
      }
    }
  }

  // ── Build finalized aggregates with derived defaults filled (registry.md #14) ─
  // The registry exposes finalized boundaries (identityKey/identityClass/
  // conflictDefault/members derived where the contributor omitted them), so
  // consumers never see a half-specified aggregate.
  const finalizedAggregatesByDomain = new Map<BackupDomain, readonly AggregateBoundary[]>()
  for (const c of contributors) {
    finalizedAggregatesByDomain.set(
      c.domain,
      c.schema.aggregates.map((agg) => finalizeAggregate(agg, c))
    )
  }

  // ── Build the immutable registry data and wrap it in the read-only view ──────
  const data: FinalizedRegistryData = {
    contributors: byDomain,
    tableOwner,
    domainDependencies: new Map([...domainDependencies.entries()].map(([d, deps]) => [d, [...deps]] as const)),
    finalizedAggregatesByDomain,
    finalizedAt: meta.finalizedAt,
    schemaCommit: meta.schemaCommit
  }
  return new ReadonlyBackupRegistryImpl(data)
}

/**
 * Fill an aggregate's derived defaults (registry.md #14): identityKey (root PK),
 * identityClass (PK kind), conflictDefault (identityClass→strategy), and members
 * (in-domain owning references whose FK targets the root). Explicit values win;
 * only omitted fields are derived — so the registry always exposes a complete
 * boundary even when a contributor relies on the documented defaults.
 */
function finalizeAggregate(agg: AggregateBoundary, c: BackupContributor): AggregateBoundary {
  const rootPk = c.schema.primaryKeys.find((fact) => fact.table === agg.root)
  const identityKey = agg.identityKey ?? rootPk?.columns ?? []
  const identityClass =
    agg.identityClass ?? (rootPk?.kind === 'uuid-v4' || rootPk?.kind === 'uuid-v7' ? 'uuid-entity' : 'natural-key')
  const conflictDefault = agg.conflictDefault ?? (identityClass === 'uuid-entity' ? 'SKIP' : 'FIELD_MERGE')
  // members: explicit if provided, else derived from in-domain OWNING references
  // whose generated FK targets the root (registry.md #14 derivation rule).
  const members =
    agg.members ??
    c.schema.references
      .filter((r) => r.kind === 'owning' && r.table !== agg.root)
      .filter((r) => {
        const fk = DB_FOREIGN_KEYS[r.table].find((f) => f.columns.some((col) => col === r.column))
        return fk?.targetTable === agg.root
      })
      .map((r) => ({ table: r.table, viaColumn: r.column, cascade: 'include' as const }))
  return { ...agg, identityKey, identityClass, conflictDefault, members }
}

/** Kahn's-algorithm cycle detection over the domain dependency graph (#10). */
function detectCycle(deps: Map<BackupDomain, Set<BackupDomain>>, domains: readonly BackupDomain[]): void {
  const adjacency = new Map<BackupDomain, BackupDomain[]>()
  const inDegree = new Map<BackupDomain, number>()
  for (const d of domains) {
    adjacency.set(d, [])
    inDegree.set(d, 0)
  }
  for (const d of domains) {
    for (const dep of deps.get(d) ?? []) {
      if (dep === d) continue // self-edges (self-FKs) do not form a domain cycle.
      // d depends on dep ⇒ edge dep → d ⇒ dep must precede d ⇒ raise d's in-degree.
      adjacency.get(dep)!.push(d)
      inDegree.set(d, (inDegree.get(d) ?? 0) + 1)
    }
  }
  const queue: BackupDomain[] = domains.filter((d) => (inDegree.get(d) ?? 0) === 0)
  let visited = 0
  while (queue.length > 0) {
    const d = queue.shift()!
    visited++
    for (const next of adjacency.get(d) ?? []) {
      inDegree.set(next, (inDegree.get(next) ?? 0) - 1)
      if (inDegree.get(next) === 0) queue.push(next)
    }
  }
  if (visited !== domains.length) {
    const cycle = domains.filter((d) => (inDegree.get(d) ?? 0) > 0)
    fail({ invariant: 10, cycle })
  }
}

/** Detect a cycle in an aggregate's member.parent chain (#14). */
function detectMemberParentCycle(
  root: DbTableName,
  members: readonly { readonly table: DbTableName; readonly parent?: DbTableName }[],
  domain: BackupDomain,
  aggregate: DbTableName
): void {
  // Treat the root as the implicit parent head; a member's parent (if set) must
  // resolve to the root or another member, and following parents must terminate.
  const memberTables = new Set(members.map((m) => m.table))
  for (const m of members) {
    const seen = new Set<DbTableName>([m.table])
    let cursor: DbTableName | undefined = m.parent ?? root
    while (cursor !== root && cursor !== undefined) {
      if (seen.has(cursor)) fail({ invariant: 14, domain, aggregate, member: m.table })
      seen.add(cursor)
      if (!memberTables.has(cursor)) break // parent resolved to a non-member (root-side) — stop.
      cursor = members.find((x) => x.table === cursor)?.parent ?? root
    }
  }
}
