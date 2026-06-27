// ReadonlyBackupRegistryImpl — the immutable registry view produced by finalize.
//
// Holds the finalized contributor map + derived indexes and exposes the read-only
// query surface declared by ReadonlyBackupRegistry (contributor-types.ts). PK / FK
// facts come straight from the codegen product (DB_PRIMARY_KEYS / DB_FOREIGN_KEYS)
// — the single source of truth — while domain-scoped lookups (schema / policy /
// operations / references / aggregates) come from each domain's contributor.
//
// Immutability is enforced three ways: (1) the interface returns Readonly<T>;
// (2) no mutating method is exposed; (3) a Symbol.for brand marks a genuine
// finalized instance so callers cannot forge one with `as unknown as …`.

import type {
  AggregateBoundary,
  BackupContributor,
  BackupContributorOperations,
  BackupContributorPolicy,
  EntityGraphSchema,
  EntityReference,
  FileRefSourcePolicy,
  JsonSoftReferencePolicy,
  ReadonlyBackupRegistry
} from '@main/data/db/backup/contributor-types'
import {
  DB_FOREIGN_KEYS,
  DB_PRIMARY_KEYS,
  type DbColumnName,
  type DbTableName,
  type ForeignKeyFact,
  type PrimaryKeyFact
} from '@main/data/db/backup/dbSchemaRefs'
import { INFRASTRUCTURE_TABLES } from '@main/data/db/backup/exclusions'
import { BACKUP_DOMAINS, type BackupDomain } from '@main/data/db/backup/domains'
import type { FileRefSourceType } from '@shared/data/types/file/ref'

/** Brand marking a genuinely finalized registry instance. */
export const READONLY_REGISTRY = Symbol.for('@backup/readonly-registry')

/** Thrown by topoSort when the requested domain subset contains a cycle. */
export class CircularReferenceError extends Error {
  readonly cycle: readonly BackupDomain[]
  constructor(cycle: readonly BackupDomain[]) {
    super(`backup registry topoSort cycle: ${cycle.join(' → ')}`)
    this.name = 'CircularReferenceError'
    this.cycle = cycle
  }
}

/** The validated, immutable data finalize() hands to this impl. */
export interface FinalizedRegistryData {
  readonly contributors: ReadonlyMap<BackupDomain, BackupContributor>
  readonly tableOwner: ReadonlyMap<DbTableName, BackupDomain>
  readonly domainDependencies: ReadonlyMap<BackupDomain, readonly BackupDomain[]>
  /** Per-domain aggregates with derived defaults filled (registry.md #14). */
  readonly finalizedAggregatesByDomain: ReadonlyMap<BackupDomain, readonly AggregateBoundary[]>
  readonly finalizedAt: string
  readonly schemaCommit: string
}

/** Build the key for the (table, column) jsonSoftReference index. */
const jsonKey = (table: DbTableName, column: DbColumnName): string => `${table}.${column}`

export class ReadonlyBackupRegistryImpl implements ReadonlyBackupRegistry {
  /** Per-domain contributor map (the source of schema/policy/operations). */
  private readonly contributors: ReadonlyMap<BackupDomain, BackupContributor>
  /** Owned-table → owning domain (excludes excluded/infrastructure tables). */
  private readonly tableOwner: ReadonlyMap<DbTableName, BackupDomain>
  /** Domain → domains it references (for getDependencies / topoSort). */
  private readonly domainDependencies: ReadonlyMap<BackupDomain, readonly BackupDomain[]>
  /** Domain → aggregates with derived defaults filled (#14). */
  private readonly finalizedAggregatesByDomain: ReadonlyMap<BackupDomain, readonly AggregateBoundary[]>
  /** FileRefSourceType → policy (built once from all contributors). */
  private readonly sourceTypePolicy: ReadonlyMap<FileRefSourceType, FileRefSourcePolicy>
  /** `${table}.${column}` → json soft-ref policy (built once). */
  private readonly jsonSoftRefIndex: ReadonlyMap<string, JsonSoftReferencePolicy>
  readonly finalizedAt: string
  readonly schemaCommit: string
  readonly [READONLY_REGISTRY]: true = true

  constructor(data: FinalizedRegistryData) {
    this.contributors = data.contributors
    this.tableOwner = data.tableOwner
    this.domainDependencies = data.domainDependencies
    this.finalizedAggregatesByDomain = data.finalizedAggregatesByDomain
    this.finalizedAt = data.finalizedAt
    this.schemaCommit = data.schemaCommit

    // Aggregate the two cross-domain indexes in one pass.
    const sourceTypePolicy = new Map<FileRefSourceType, FileRefSourcePolicy>()
    const jsonSoftRefIndex = new Map<string, JsonSoftReferencePolicy>()
    for (const c of data.contributors.values()) {
      for (const p of c.schema.fileRefSourcePolicies) sourceTypePolicy.set(p.sourceType, p)
      for (const j of c.schema.jsonSoftReferences) jsonSoftRefIndex.set(jsonKey(j.table, j.column), j)
    }
    this.sourceTypePolicy = sourceTypePolicy
    this.jsonSoftRefIndex = jsonSoftRefIndex
  }

  get domains(): readonly BackupDomain[] {
    return BACKUP_DOMAINS
  }

  getSchema(domain: BackupDomain): Readonly<EntityGraphSchema> {
    return this.requireContributor(domain).schema
  }

  getPolicy(domain: BackupDomain): Readonly<BackupContributorPolicy> {
    return this.requireContributor(domain).backupPolicy
  }

  getOperations(domain: BackupDomain): Readonly<BackupContributorOperations> | undefined {
    return this.requireContributor(domain).operations
  }

  getTableOwner(table: DbTableName): BackupDomain | 'excluded' | 'infrastructure' {
    const owner = this.tableOwner.get(table)
    if (owner) return owner
    if (INFRASTRUCTURE_TABLES.has(table)) return 'infrastructure'
    // ALWAYS_STRIP tables and any uncovered table read as 'excluded' (not backed up).
    return 'excluded'
  }

  getPrimaryKey(table: DbTableName): Readonly<PrimaryKeyFact> {
    return DB_PRIMARY_KEYS[table]
  }

  getReferencesForDomain(domain: BackupDomain): readonly EntityReference[] {
    return this.requireContributor(domain).schema.references
  }

  getAggregatesForDomain(domain: BackupDomain): readonly AggregateBoundary[] {
    // Return the finalized boundaries (derived defaults filled, #14), not the raw
    // declarations — consumers depend on complete identityKey/members metadata.
    this.requireContributor(domain)
    return this.finalizedAggregatesByDomain.get(domain) ?? []
  }

  getFileRefPolicy(sourceType: FileRefSourceType): Readonly<FileRefSourcePolicy> {
    const policy = this.sourceTypePolicy.get(sourceType)
    if (!policy)
      throw new Error(`backup registry: no FileRefSourcePolicy for ${sourceType} (finalize #11 should prevent this)`)
    return policy
  }

  getJsonSoftReference(table: DbTableName, column: DbColumnName): Readonly<JsonSoftReferencePolicy> | undefined {
    return this.jsonSoftRefIndex.get(jsonKey(table, column))
  }

  getForeignKeys(table: DbTableName): readonly ForeignKeyFact[] {
    return DB_FOREIGN_KEYS[table]
  }

  getDependencies(domain: BackupDomain): readonly BackupDomain[] {
    return this.domainDependencies.get(domain) ?? []
  }

  /**
   * Topologically sort a domain subset by reference dependencies (dependencies
   * first). Self-edges are ignored. Throws CircularReferenceError on a cycle.
   */
  topoSort(domains: readonly BackupDomain[]): readonly BackupDomain[] {
    const subset = new Set(domains)
    const adjacency = new Map<BackupDomain, BackupDomain[]>()
    const inDegree = new Map<BackupDomain, number>()
    for (const d of domains) {
      adjacency.set(d, [])
      inDegree.set(d, 0)
    }
    for (const d of domains) {
      for (const dep of this.domainDependencies.get(d) ?? []) {
        if (dep === d || !subset.has(dep)) continue // ignore self + out-of-subset edges.
        adjacency.get(dep)!.push(d)
        inDegree.set(d, (inDegree.get(d) ?? 0) + 1)
      }
    }
    const queue: BackupDomain[] = domains.filter((d) => (inDegree.get(d) ?? 0) === 0)
    const sorted: BackupDomain[] = []
    while (queue.length > 0) {
      const d = queue.shift()!
      sorted.push(d)
      for (const next of adjacency.get(d) ?? []) {
        inDegree.set(next, (inDegree.get(next) ?? 0) - 1)
        if (inDegree.get(next) === 0) queue.push(next)
      }
    }
    if (sorted.length !== domains.length) {
      throw new CircularReferenceError(domains.filter((d) => (inDegree.get(d) ?? 0) > 0))
    }
    return sorted
  }

  /** Resolve a contributor or throw a clear error for an unregistered domain. */
  private requireContributor(domain: BackupDomain): BackupContributor {
    const c = this.contributors.get(domain)
    if (!c) throw new Error(`backup registry: domain ${domain} has no contributor (finalize #1 should prevent this)`)
    return c
  }
}
