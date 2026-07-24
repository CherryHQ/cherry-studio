// Merge engine core types — detached restore import pipeline (plan (b)).
//
// The merge engine merges backup rows into a detached work.sqlite (VACUUM INTO copy
// of live) inside one synchronous better-sqlite3 transaction. Conflict resolution
// follows identity-class defaults (uuid-entity → SKIP, natural-key/slot → FIELD_MERGE);
// identity propagation rewrites FKs to local canonical PKs; junction rows are
// resolved in a global phase after all root/member writes. See spec
// `backup-restore-safety/import-orchestrator.md` + plan `cryptic-inventing-toucan.md`.

import type { AggregateBoundary } from '@main/data/db/backup/contributorTypes'
import type { DbColumnName, DbTableName } from '@main/data/db/backup/dbSchemaRefs'
import type { BackupDomain, ConflictStrategy } from '@main/data/db/backup/domains'
import type { DbType } from '@main/data/db/types'
import type Database from 'better-sqlite3'

/** Effective action for an aggregate during merge — exhaustive switch in importRows (B3). */
export type MergeAction = 'insert' | 'skip' | 'overwrite' | 'rename' | 'field-merge'

/** Per-aggregate decision produced by scanAggregates (work.sqlite is the merge base). */
export interface AggregateDecision {
  readonly aggregate: AggregateBoundary
  /** Composite identity tuple (ordered, NOT delimiter-joined) —忠实表达 [scope,key]/[type,name]/.... */
  readonly identity: readonly (string | number)[]
  /** Backup-side physical PK tuple (ordered) — importRows queries backupDb members by this. */
  readonly backupPrimaryKey: readonly (string | number)[]
  /**
   * Local canonical PK (FIELD_MERGE local wins / RENAME new PK); undefined when the
   * aggregate is not yet imported or has no local survivor. Drives identity propagation.
   */
  readonly localCanonicalPrimaryKey?: readonly (string | number)[]
  readonly action: MergeAction
  /** New root uuid for RENAME (renamable uuid-entity, single-column PK only). */
  readonly newRootKey?: string
}

/** Endpoint of a junction reference (root or member table + the FK column into it). */
export interface JunctionEndpoint {
  readonly table: DbTableName
  readonly fkColumn: DbColumnName
  /** 'root' or a member table name (e.g. chat_message_file_ref.sourceId → message member). */
  readonly aggregatePath: 'root' | DbTableName
}

/**
 * Registry-derived descriptor for a junction table (B4). Derived from
 * schema.references filter kind='junction' — NOT aggregate.members. Excludes
 * include-member dual-cascade tables (assistant_mcp_server etc.) which are handled
 * by root/member processing.
 */
export interface JunctionDescriptor {
  readonly table: DbTableName
  readonly ownerDomain: BackupDomain
  readonly sourceEndpoint: JunctionEndpoint
  readonly targetEndpoint: JunctionEndpoint
}

/** Owning (same-domain) endpoint of a polymorphic association — e.g. entity_tag.tagId → tag. */
export interface PolymorphicTagEndpoint {
  readonly table: DbTableName
  readonly fkColumn: DbColumnName
  readonly referencedDomain: BackupDomain
}

/**
 * Polymorphic soft-ref endpoint — entityId rewritten via entityType → domain → root table
 * (see `POLYMORPHIC_ENTITY_TYPE_ROOT_TABLE` in polymorphicAssociationDeriver).
 */
export interface PolymorphicEntityEndpoint {
  readonly fkColumn: DbColumnName
  readonly entityTypeColumn: DbColumnName
  readonly routeBy: Readonly<Record<string, BackupDomain | 'excluded'>>
}

/**
 * Registry-derived descriptor for a polymorphic association table (A1). Tables with
 * ≥1 kind:'owning' same-domain ref + a non-empty polymorphicEntityMap on the owner
 * domain, that are neither aggregate roots nor include-members. Stage-A1: entity_tag only.
 */
export interface PolymorphicAssociationDescriptor {
  readonly table: DbTableName
  readonly ownerDomain: BackupDomain
  readonly tagEndpoint: PolymorphicTagEndpoint
  readonly entityEndpoint: PolymorphicEntityEndpoint
}

/**
 * identityMap is role-aware (R8): source eligibility vs target availability.
 * The asymmetry is critical — a skipped target survives locally (available),
 * while a skipped source was not imported (ineligible).
 *
 * The maps are scoped per endpoint TABLE (not flat by id) so that the same textual id
 * in two different entity tables cannot overwrite each other. Once FIELD_MERGE/OVERWRITE
 * maps an id to a different canonical id, a flat map would let junction resolution
 * rewrite a FK to the wrong entity; the per-table scope keeps endpoints disjoint.
 *
 * TODO(junction-phase): the spec's `sourceMap.get(sourceEndpoint, id)` keys on a full
 * `JunctionEndpoint` (table + fkColumn + aggregatePath). Per-table keying is sufficient
 * for the SKIP-only MVP (no junction consumer; no registry junction reuses one table
 * across two distinct endpoint shapes) — re-evaluate keying granularity when
 * `importAllJunctionRows` lands; widen to `JunctionEndpoint` if a dual-endpoint-same-table
 * junction is introduced.
 */
export interface IdentityMap {
  /**
   * Source eligibility: per endpoint table, backup-id → imported work-id. Only rows
   * imported THIS restore (insert/FIELD_MERGE/OVERWRITE). skip → absent (not imported,
   * ineligible). rename → backup old id absent (work is the new clone).
   */
  readonly sourceMap: Map<DbTableName, Map<string, string>>
  /**
   * Target availability: per endpoint table, backup-id → canonical work-id. Imported OR
   * pre-existing local (skip = local survives = available → local canonical). rename
   * (old not imported) / domain-unselected → absent.
   */
  readonly targetMap: Map<DbTableName, Map<string, string>>
}

/** A degraded-to-SKIP record (renamable:false RENAME fallback, etc.) — for the restore sidecar. */
export interface DegradedSkip {
  readonly table: DbTableName
  readonly count: number
  readonly reason: string
}

/** Merge engine result (degraded-to-SKIP records go to the BackupService-owned sidecar, NOT journal). */
export interface MergeResult {
  readonly degradedToSkips: readonly DegradedSkip[]
}

/**
 * Context the MergeEngine consumes. Carries the selected domains, the user's optional
 * strategy override, and the file_entry IDs whose blobs were not staged (skipped during
 * import). The role-aware identityMap + write-quiesce lease are engine-internal — built in
 * `mergeBackupIntoWork`, not passed by the caller (see plan (b) Stage 3 wiring for the
 * ArchiveContext that does cross the spine boundary).
 */
export interface MergeContext {
  /**
   * Absolute path to the migrated backup.sqlite (admission unpacked + migrate-forwarded it);
   * the engine opens it read-only. Cross-spine ArchiveContext field — set by importBackup
   * from ArchiveContext.backupDbPath, NOT engine-internal.
   */
  readonly backupDbPath: string
  /** Selected domains for this restore (drives topo sort + which aggregates are scanned). */
  readonly domains: readonly BackupDomain[]
  /**
   * User strategy override. undefined (omit) → use each aggregate's conflictDefault
   * (防 UI 默认 SKIP 覆盖 PROVIDERS FIELD_MERGE 丢凭证). Only set when the user explicitly
   * chooses a strategy.
   */
  readonly userStrategy?: ConflictStrategy
  /** file_entry IDs whose blobs were not staged — skip these rows during import. */
  readonly skippedFileEntryIds: ReadonlySet<string>
  /**
   * file_entry IDs whose blobs WERE staged into the archive / restore staging tree.
   * Used after merge to disclose `message.data` soft refs whose blobs are missing
   * (DB-only restore passes an empty set → every fileEntryId is disclosed).
   */
  readonly stagedFileEntryIds: ReadonlySet<string>
  /**
   * From the admitted manifest (`includeFiles`). Lite archives stage zero Notes
   * bodies — when false, MergeEngine skips every `note` overlay row so restore
   * does not leave starred/expanded state pointing at missing files (§3.5).
   * undefined = legacy callers / unit stubs (do not strip notes).
   */
  readonly includeFiles?: boolean
}

/** Merge engine entry signature — invoked by ImportOrchestrator inside the staging spine. */
export type MergeBackupIntoWork = (
  workSqlite: Database.Database,
  workDb: DbType,
  ctx: MergeContext
) => Promise<MergeResult>
