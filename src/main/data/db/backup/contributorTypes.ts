// Backup neutral layer — contributor type contracts (Track A1b).
//
// Pure types describing a BackupContributor's static facts (schema graph, conflict
// policy, operation hooks) plus the ReadonlyBackupRegistry interface consumed by
// contexts and (later) ContributorManager.finalize(). All identifiers (DbTableName /
// DbColumnName / PrimaryKeyFact) come from the codegen product dbSchemaRefs.ts;
// BackupDomain / ConflictStrategy from domains.ts. Main-only neutral layer.

// type-only imports keep this module side-effect-free (no runtime cycle): the
// BackupScopedDb/BackupReadonlyDb classes live in contexts.ts and are referenced
// here only as types (erased at compile time).
import type { JobType } from '@main/core/job/jobRegistry'
import type { EntityType } from '@shared/data/types/entityType'
import type { FileRefSourceType } from '@shared/data/types/file'

import type { BackupReadonlyDb, BackupScopedDb } from './contexts'
import type { DbColumnName, DbTableName, ForeignKeyFact, PrimaryKeyFact } from './dbSchemaRefs'
import type { BackupDomain, ConflictStrategy } from './domains'

// ─── Reference + identity classification ───────────────────────────────────────

/**
 * How a foreign-key reference is consumed by the owning domain.
 * - optional: source row still meaningful when target is missing (default SET_NULL).
 * - owning:   source row meaningless without target (default DELETE_ROW).
 * - junction: co-owned many-to-many (dual cascade FK, NOT NULL composite PK) —
 *             losing either endpoint cascades a prune.
 */
export type ReferenceKind = 'optional' | 'owning' | 'junction'

/**
 * Cross-device identity class of an aggregate root. Drives the
 * default conflict strategy: uuid-entity → SKIP (safe); natural-key/slot →
 * FIELD_MERGE (collision likely). codegen-derived unless the root has a UNIQUE
 * non-PK key (→ natural-key) or is a preset slot (→ slot, contributor-declared).
 */
export type IdentityClass = 'uuid-entity' | 'natural-key' | 'slot'

/**
 * JSON soft-reference propagation strength.
 * - tolerant: missing/merged target only degrades (toast + orphan check); no rewrite.
 * - required: target missing breaks functionality; target merge must rewrite the ref.
 */
export type JsonSoftRefKind = 'tolerant' | 'required'

/** A foreign-key reference this domain's table makes into another domain. */
export interface EntityReference {
  /** Source table — MUST be owned by this contributor (finalize #3). */
  readonly table: DbTableName
  /** FK column (camelCase JS key, validated against DB_COLUMNS_BY_TABLE). */
  readonly column: DbColumnName
  /** Domain the FK target belongs to. */
  readonly referencedDomain: BackupDomain
  /** How the reference is consumed — drives topo sort + omitted-action derivation. */
  readonly kind: ReferenceKind
}

/** A member table of an aggregate, joined to the root via viaColumn. */
export interface AggregateMember {
  readonly table: DbTableName
  /** Column pointing at the root identityKey. finalize #14 asserts it is a real FK. */
  readonly viaColumn: DbColumnName
  readonly cascade: 'include' | 'optional'
  /**
   * Override the owning-reference target when multiple owning refs point at
   * member/root ambiguously (default: derived from owning-reference target, §6.2).
   */
  readonly parent?: DbTableName
}

/**
 * Aggregate boundary — the "real new information" a contributor hand-authors
 * (root + renamable) plus derivable fields (identityKey/identityClass/
 * conflictDefault/members) that finalize fills from references + primaryKeys.
 */
export interface AggregateBoundary {
  /** Aggregate root table (the semantic "object" root). */
  readonly root: DbTableName
  /** Supports RENAME clone on conflict (drives RENAME propagation). */
  readonly renamable: boolean
  /** Default = root PK; must include a UNIQUE non-PK key when the root has one (§6.2). */
  readonly identityKey?: readonly DbColumnName[]
  /** Default derived from primaryKeys[root].kind; UNIQUE non-PK → natural-key; slot explicit. */
  readonly identityClass?: IdentityClass
  /** Default = identityClass mapping (uuid→SKIP; natural/slot→FIELD_MERGE); deviation explicit. */
  readonly conflictDefault?: ConflictStrategy
  /** Default = in-domain sources of owning references into root (finalize #14 viaColumn real FK). */
  readonly members?: readonly AggregateMember[]
}

/**
 * Row-scope ownership for a SHARED table (F1). e.g. job_schedule
 * rows with type='agent.task' belong to AGENTS — rows not matching the filter must
 * be explicitly excluded (with reason) or fail-loud at export, never silently dropped.
 */
export interface RowScope {
  readonly table: DbTableName
  readonly ownerDomain: BackupDomain
  readonly filter: { readonly column: DbColumnName; readonly op: 'eq'; readonly value: string }
  /**
   * Per-JobType ownership assertion for the rows matched by filter (finalize
   * exhaustiveness). A JobType not listed is implicitly 'excluded' — the
   * contributor must either own it ('owned') or explicitly exclude it, so an
   * unhandled JobType can never be silently dropped from backup.
   */
  readonly typeCoverage?: Readonly<Record<JobType, 'owned' | 'excluded'>>
}

/** How a file_ref.sourceType is owned and resourced (finalize #11). */
export interface FileRefSourcePolicy {
  readonly sourceType: FileRefSourceType
  readonly ownerDomain: BackupDomain | 'excluded'
  readonly resourcePolicy: 'include-with-owner' | 'runtime-only-exclude'
  readonly sourceTable?: DbTableName
}

/** A soft reference embedded in a JSON column. */
export interface JsonSoftReferencePolicy {
  readonly table: DbTableName
  readonly column: DbColumnName
  /** file-ref → points at a fileId; entity-id → points at an entity primary key. */
  readonly target: 'file-ref' | 'entity-id'
  readonly ownerDomain: BackupDomain
  readonly kind: JsonSoftRefKind
}

/** Override the default omitted-reference action for one declared reference (finalize #7). */
export interface OmittedReferenceOverride {
  /** Must already exist in schema.references (finalize #7 binds it). */
  readonly reference: EntityReference
  /** Default is ReferenceKind→action, so an override must differ (non-redundant). */
  readonly action: 'SET_NULL' | 'DELETE_ROW' | 'cascade-prune'
  /** Non-empty rationale (finalize #7). */
  readonly reason: string
}

/**
 * A table with non-PK unique columns needing merge-before-insert on restore.
 * Shape (verbatim shape not given).
 */
export interface UniqueMergeRule {
  readonly table: DbTableName
  readonly uniqueColumns: readonly DbColumnName[]
}

/** Field-level merge rule for FIELD_MERGE conflict strategy (M4). */
export interface FieldMergePolicy {
  readonly table: DbTableName
  readonly column: DbColumnName
  readonly strategy: 'remote-fills-local-null' | 'remote-fills-local-empty' | 'deep-merge' | 'local-priority'
}

// ─── Hook context interfaces ───────────────────────────────────────────────────
// Co-located with the contributor operations that consume them (below) so this
// module no longer needs a type edge into contexts.ts for them.

/** Backup lifecycle phase (derived from BackupProgressEmitter.tick's phase union). */
export type BackupPhase = 'collect' | 'archive' | 'restore' | 'verify'

/** Progress reporting surface the orchestrator injects (optional on contexts). */
export interface BackupProgressEmitter {
  tick(phase: BackupPhase, count?: number): void
  fail(phase: BackupPhase, error: unknown): void
}

/**
 * Fields every hook context shares. Constructed/injected by the orchestrator.
 * Contributors obtain their own logger via `loggerService.withContext('backup/<domain>')`
 * — a logger is intentionally NOT on the context (it would force state on every
 * context without enforcing observability).
 */
export interface BackupContextBase {
  readonly registry: ReadonlyBackupRegistry
  readonly restoreId: string
  readonly domains: readonly BackupDomain[]
  readonly strategy: ConflictStrategy
  /** Omitted in unit tests; when absent the hook simply does not report progress. */
  readonly progress?: BackupProgressEmitter
}

/**
 * Typed descriptor for a file resource discovered by `collectFileResources`.
 * Replaces the untyped `Set<string>` contract: routing is by `kind`, NOT by the
 * producing domain — the orchestrator dispatches staging by kind, so new
 * resource forms extend the union without touching a domain switch.
 *
 * - `file-entry` / `knowledge-base` / `notes-file`: existing blob & markdown forms.
 * - `skill-dir` / `mcp-package-dir` / `agent-workspace-dir`: directory resources
 *   whose on-disk content is NOT re-fetchable (dejeune file-resource-hooks
 *   domains — SKILLS / MCP_SERVERS / AGENTS system workspace). Additive per
 *   identity key; promoted via restore journal `dir-add`. Staging for these
 *   lands with the directory-resource staging work; no contributor emits them
 *   until that work ships.
 */
export type ResourceDescriptor =
  | { readonly kind: 'file-entry'; readonly fileEntryId: string }
  | { readonly kind: 'knowledge-base'; readonly baseId: string }
  | { readonly kind: 'notes-file'; readonly relPath: string }
  | { readonly kind: 'skill-dir'; readonly folderName: string; readonly contentHash: string }
  | { readonly kind: 'mcp-package-dir'; readonly serverName: string }
  | { readonly kind: 'agent-workspace-dir'; readonly sessionId: string }

/**
 * A resource the export intentionally omitted (with observability) under a preset
 * limitation. TBD-1 (iii): lite preset omits zip/local skill-dir file content (the
 * skill DB row still ships as schema) but records each omission here so it is
 * visible in the manifest + logs, never silently lost. The orchestrator accumulates
 * these via FileResourceContext.recordDegraded and writes them to manifest.degraded.
 */
export type ExportResourceDegradation = {
  readonly kind: 'skill-dir-omitted-lite'
  readonly folderName: string
  readonly contentHash: string
}

/** Context for collectFileResources — reads live DB file metadata only. */
export interface FileResourceContext extends BackupContextBase {
  readonly liveDb: BackupReadonlyDb
  /** Export preset — collectors branch on it (TBD-1 (iii): SKILLS omits zip/local skill-dir content under lite). */
  readonly preset: 'full' | 'lite'
  /**
   * Sink for preset-limited omissions (TBD-1 (iii)). The orchestrator supplies an
   * accumulator that logs + carries each record into manifest.degraded; collectors
   * call it instead of silently dropping a resource. Required so a future caller
   * cannot silently discard a lite omission.
   */
  readonly recordDegraded: (item: ExportResourceDegradation) => void
  /**
   * Notes markdown root — BackupService resolves it from feature.notes.path when
   * set (else feature.notes.data when that dir exists). A set-but-unavailable
   * custom path fails the export rather than falling back to the managed default.
   * PREFERENCES.collectFileResources scans it case-insensitively for `.md` files.
   * undefined (unit tests / Notes never opened / lite preset) → empty set, skip.
   * When provided, the directory must be readable; ENOENT/EACCES throw.
   */
  readonly notesRoot?: string
}

/** Context for beforeArchive — may write the backup copy (own domain only). */
export interface BeforeArchiveContext extends BackupContextBase {
  readonly backupDb: BackupScopedDb
}

/**
 * Context for transformRow — pure computation, NO db on the context. Return null to
 * skip the row. Returned rows are written by the importer (global coordinator), so
 * the allowedTables boundary does not apply here.
 */
export interface RowTransformContext extends BackupContextBase {
  readonly row: Readonly<Record<string, unknown>>
  readonly table: DbTableName
}

/**
 * Context for afterImport (D model / #16714).
 *
 * Target semantics (C-import wires the handles):
 * - `backupDb`: write-scoped `BackupScopedDb` over the detached `work.sqlite`
 *   (own tables only) — FTS rebuild and in-tx derived writes land here.
 * - `liveDb`: read-only view of the **same** detached work copy (not the live
 *   DbService DB). Name is historical; C-import may rename later.
 *
 * Cache reload / timer re-arm are NOT done here — D model completes them via
 * relaunch after preboot promotion (`PreferenceService.onInit` /
 * `JobManager` startup recovery). Never write the live DB from this hook.
 */
export interface AfterImportContext extends BackupContextBase {
  readonly importedRowCount: number
  readonly backupDb: BackupScopedDb
  readonly liveDb: BackupReadonlyDb
}

/** Return value of restoreResources: which files were restored vs intentionally skipped. */
export interface RestoreResourceResult {
  readonly restoredFileIds: Set<string>
  readonly skippedFileIds: Set<string>
}

/**
 * Context for restoreResources (D model / #16714 / architecture §9).
 *
 * Runtime writes restored blobs into the staging tree under `backupRoot`; the
 * preboot promotion gate later promotes staging → live per the restore journal.
 * `liveFileRoot` is only used to compute journal `livePath` targets — contributors
 * MUST NOT write live paths in-place. `filesAffected` is the pre-write planned set
 * that restoreResources only reads to verify. Paths are pre-resolved by the
 * orchestrator (`application.getPath`).
 */
export interface RestoreResourceContext extends BackupContextBase {
  readonly backupRoot: string
  readonly liveFileRoot: string
  readonly filesAffected: ReadonlySet<string>
  readonly knowledgeRoot?: string
}

/**
 * Context for cloneAggregate — pure computation, NO db. newRootKey is generated by
 * the importer per PrimaryKeyFact.kind (v4/v7); member row re-keying is done by the
 * importer via memberKeyMap, so cloneAggregate only swaps the root PK.
 */
export interface CloneAggregateContext extends BackupContextBase {
  readonly aggregate: AggregateBoundary
  readonly rootRow: Readonly<Record<string, unknown>>
  /** Importer-generated new root PK (uuid version follows the root's PrimaryKeyFact.kind). */
  readonly newRootKey: string
  /** Old→new PK map per member table; empty for members whose PK derives from the root. */
  readonly memberKeyMap: ReadonlyMap<DbTableName, ReadonlyMap<string, string>>
}

// ─── Contributor schema + policy + operations ──────────────────────────────────

/** The entity-graph facts a contributor declares for its domain. */
export interface EntityGraphSchema {
  readonly tables: readonly DbTableName[]
  readonly references: readonly EntityReference[]
  readonly primaryKeys: readonly PrimaryKeyFact[]
  /** Conflict-policy object boundaries; may be empty for single-table domains. */
  readonly aggregates: readonly AggregateBoundary[]
  readonly fileRefSourcePolicies: readonly FileRefSourcePolicy[]
  readonly jsonSoftReferences: readonly JsonSoftReferencePolicy[]
  /** Shared-table row partitions (e.g. job_schedule.type='agent.task' → AGENTS). */
  readonly rowScopes?: readonly RowScope[]
  /**
   * JSON columns in schema.tables that are NOT soft-reference carriers and so are
   * exempt from jsonSoftReferences coverage (finalize exhaustiveness). reason is
   * required for each exemption (mirrors the reason-required pattern of
   * omittedReferenceOverrides). A JSON column must appear in either
   * jsonSoftReferences or exemptJsonCols, else finalize fails.
   */
  readonly exemptJsonCols?: readonly {
    readonly table: DbTableName
    readonly column: DbColumnName
    readonly reason: string
  }[]
  /**
   * Polymorphic entity-type → domain routing for shared polymorphic tables
   * (entity_tag, pin, group). Maps each EntityType to the BackupDomain that owns
   * its rows, or 'excluded' when that entity type is out of backup scope. Lets
   * finalize verify every EntityType is routed (no silent drops).
   */
  readonly polymorphicEntityMap?: Readonly<Record<EntityType, BackupDomain | 'excluded'>>
}

/** Domain-level backup policy. */
export interface BackupContributorPolicy {
  /** Only exceptions; each binds a declared reference + non-redundant action + reason. */
  readonly omittedReferenceOverrides?: readonly OmittedReferenceOverride[]
  /** Tables with non-PK unique columns needing merge-before-insert. */
  readonly uniqueMergeRules?: readonly UniqueMergeRule[]
  /** FIELD_MERGE column-level merge rules (M4). */
  readonly fieldMergePolicies?: readonly FieldMergePolicy[]
  /** PREFERENCES-only: platform-specific key patterns (shortcut.* / *.path / ...). */
  readonly platformSpecificKeys?: readonly string[]
}

/**
 * Contributor operation hooks (6 total; all optional except renamable aggregates
 * MUST supply cloneAggregate — finalize #16). Hooks are plain functions (no `this`);
 * db access is via the injected context. scanAggregates is NOT a contributor hook
 * (it's the importer's internal pre-scan).
 */
export interface BackupContributorOperations {
  // collectFileResources / beforeArchive / restoreResources run OUTSIDE the detached
  // write tx (file IO, pre-merge staging) — async is allowed.
  collectFileResources?: (ctx: FileResourceContext) => Promise<readonly ResourceDescriptor[]>
  beforeArchive?: (ctx: BeforeArchiveContext) => Promise<void>
  restoreResources?: (ctx: RestoreResourceContext) => Promise<RestoreResourceResult>
  // transformRow / afterImport / cloneAggregate run INSIDE the detached write tx
  // (better-sqlite3 transaction fn MUST be synchronous — it rejects Promise callbacks).
  // Returning a Promise would let the tx commit before the hook lands, breaking
  // atomicity + defer_foreign_keys guarantees. Sync only (spec R3 / plan MAJOR 8).
  // The return types below enforce this at the type boundary: `undefined` (not `void`)
  // rejects `async () => Promise<void>` — TS lets a Promise satisfy `() => void` but not
  // `() => undefined`. transformRow / cloneAggregate already reject async via non-void
  // return types.
  /** Pure row transform; return null to skip the row. No db on the context. */
  transformRow?: (ctx: RowTransformContext) => Readonly<Record<string, unknown>> | null
  /** FTS rebuild + in-tx derived writes via backupDb (own tables only). MUST be sync. */
  afterImport?: (ctx: AfterImportContext) => undefined
  /** Return a new root row with the PK replaced by ctx.newRootKey. No db on the context. */
  cloneAggregate?: (ctx: CloneAggregateContext) => { rootRow: Readonly<Record<string, unknown>> }
}

/** A frozen contributor constant: domain + static facts + optional hooks. */
export interface BackupContributor {
  readonly domain: BackupDomain
  readonly schema: EntityGraphSchema
  readonly backupPolicy: BackupContributorPolicy
  readonly operations?: BackupContributorOperations
}

// ─── ReadonlyBackupRegistry — the finalized read-only view ─

/**
 * The immutable registry produced by ContributorManager.finalize() (A3). Lives in
 * the neutral layer so BackupContextBase.registry (below) can reference it without
 * a neutral→services/backup reverse dependency. Impl arrives in A3; this is the
 * query surface consumers (orchestrator, contexts, finalize) program against.
 */
export interface ReadonlyBackupRegistry {
  // Per-domain access
  readonly domains: readonly BackupDomain[]
  getSchema(domain: BackupDomain): Readonly<EntityGraphSchema>
  getPolicy(domain: BackupDomain): Readonly<BackupContributorPolicy>
  getOperations(domain: BackupDomain): Readonly<BackupContributorOperations> | undefined

  // Cross-domain lookups
  getTableOwner(table: DbTableName): BackupDomain | 'excluded' | 'infrastructure'
  getPrimaryKey(table: DbTableName): Readonly<PrimaryKeyFact>
  getReferencesForDomain(domain: BackupDomain): readonly EntityReference[]
  getAggregatesForDomain(domain: BackupDomain): readonly AggregateBoundary[]
  getFileRefPolicy(sourceType: FileRefSourceType): Readonly<FileRefSourcePolicy>
  getJsonSoftReference(table: DbTableName, column: DbColumnName): Readonly<JsonSoftReferencePolicy> | undefined
  /** Foreign-key facts sourced from the codegen product (used by finalize #19/#24/#25). */
  getForeignKeys(table: DbTableName): readonly ForeignKeyFact[]

  // Topology
  /** Topologically sort domains by reference dependencies; throws on a cycle. */
  topoSort(domains: readonly BackupDomain[]): readonly BackupDomain[]
  getDependencies(domain: BackupDomain): readonly BackupDomain[]

  // Meta
  readonly finalizedAt: string
}
