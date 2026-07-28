import { RelativeSubpathSchema } from '@main/utils/relativePath'
import * as z from 'zod'

/**
 * Backup v2 archive manifest — the strict `manifest.json` contract
 * (docs/references/backup/README.md §5.1). Pure schema + types; no I/O and no
 * validation policy beyond structure. Admission (Phase 1b) layers hash/size,
 * chain-compatibility, and ceiling checks on top of a manifest that has already
 * parsed here.
 *
 * `BACKUP_FORMAT_VERSION` is the ARCHIVE format version and is independent of
 * the restore-journal version ({@link @data/db/restore/restoreJournalV2}). It is
 * `2` to mark the incompatible break from the format-1 selective-domain manifest
 * (§5): an unrecognized `backupFormatVersion` fails `z.literal` here, so a
 * stray older archive is rejected before any migrate-forward is attempted.
 */
export const BACKUP_FORMAT_VERSION = 2 as const

/**
 * The archive presets. There is exactly one — Full — and the field is kept in the
 * manifest so a future second preset is an additive format change rather than a
 * breaking one.
 */
export const BACKUP_PRESETS = ['full'] as const
export type BackupPreset = (typeof BACKUP_PRESETS)[number]

/** Stable producer-side reasons for omitting one managed resource unit. */
export const RESOURCE_DEGRADATION_REASONS = [
  'absent-at-snapshot',
  'type-mismatch-at-snapshot',
  'changed-after-snapshot',
  'non-regular-source',
  'unportable-source',
  'resource-ceiling-exceeded'
] as const
export type ResourceDegradationReason = (typeof RESOURCE_DEGRADATION_REASONS)[number]

const ResourceTypeSchema = z.enum(['file', 'directory'])

/**
 * Cryptographic hash of a payload, in the single representation the repo's
 * `hashDbFile` produces: 64 lowercase hex chars (streaming SHA-256,
 * `createHash('sha256').digest('hex')`). Pinning the format here means a
 * producer and the admission gate can never disagree on encoding.
 */
const Sha256HexSchema = z.string().regex(/^[0-9a-f]{64}$/, 'must be 64 lowercase hex chars (sha256)')

/**
 * One applied migration in the COMPLETE producer chain. Mirrors
 * `AppliedMigration` from `@data/db/restore/appliedChain` (folderMillis + hash),
 * which is the only legitimate source: the chain must be the full applied
 * sequence, never the bundled-list tip, so a forked/ahead DB cannot vouch for
 * itself at admission. The migration `hash` keeps the applied-chain's own
 * representation (a non-empty string) — it is NOT a payload hash and is
 * deliberately not tightened to the sha256-hex form.
 */
const MigrationChainEntrySchema = z.strictObject({
  folderMillis: z.number().int().safe().nonnegative(),
  hash: z.string().min(1)
})

/**
 * Producer managed-root identity: the PathKey and the producer's absolute path
 * for that root. Consumed by the materializer (Phase 1c) to deterministically
 * rebase managed absolute paths onto target roots. Diagnostic + rebasing input
 * only — never an install target itself.
 */
const ManagedRootIdentitySchema = z.strictObject({
  key: z.string().min(1),
  path: z.string().min(1)
})

export const BACKUP_PRODUCER_BUILD_TYPES = ['packaged', 'development'] as const
export type BackupProducerBuildType = (typeof BACKUP_PRODUCER_BUILD_TYPES)[number]

// Presentation-safe producer provenance. Electron app versions are semver-like
// tokens; excluding whitespace, separators, and slashes prevents a manifest
// value from masquerading as a path or injecting terminal/UI structure.
const ProducerAppVersionSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[0-9A-Za-z][0-9A-Za-z.+-]*$/)

const ProducerSchema = z.strictObject({
  appVersion: ProducerAppVersionSchema,
  platform: z.enum(['darwin', 'win32', 'linux']),
  /** Optional so already-created format-v2 archives remain admissible. */
  buildType: z.enum(BACKUP_PRODUCER_BUILD_TYPES).optional(),
  // Managed-root PathKeys must be unique — two identities for one key would make
  // path rebasing (Phase 1c) ambiguous. Duplicate absolute paths are left to
  // Phase 1c (they can legitimately differ per key); only key uniqueness is
  // structural here. Array LENGTH is deliberately unbounded in the schema: the
  // manifest is size-bounded before parsing by `BACKUP_CEILINGS.maxManifestBytes`
  // (1 MiB, enforced at Phase-1b admission), so this and every other manifest
  // array cannot be a DoS vector without duplicating an arbitrary count limit here.
  managedRoots: z
    .array(ManagedRootIdentitySchema)
    .refine((roots) => new Set(roots.map((r) => r.key)).size === roots.length, {
      message: 'managed-root keys must be unique'
    })
})

const DbPayloadSchema = z.strictObject({
  hash: Sha256HexSchema,
  sizeBytes: z.number().int().positive()
})

/**
 * Existence-oriented requirement inventory. Declares WHICH resources the
 * restored DB references so restore can report coverage; carries no bytes and no
 * hash. `livePath` is the userData-relative target.
 */
const ResourceRequirementSchema = z.strictObject({
  kind: z.string().min(1),
  resourceType: ResourceTypeSchema,
  livePath: RelativeSubpathSchema
})

/**
 * Included payload inventory + cryptographic hash. `archivePath` is where the
 * payload sits inside the archive; `livePath` its userData-relative destination.
 */
const commonResourcePayloadFields = {
  kind: z.string().min(1),
  archivePath: RelativeSubpathSchema,
  livePath: RelativeSubpathSchema,
  hash: Sha256HexSchema,
  sizeBytes: z.number().int().nonnegative()
}

const ResourcePayloadSchema = z.discriminatedUnion('resourceType', [
  z.strictObject({ ...commonResourcePayloadFields, resourceType: z.literal('file'), executable: z.boolean() }),
  z.strictObject({ ...commonResourcePayloadFields, resourceType: z.literal('directory') })
])

/** An explicit product-allowed degradation recorded at snapshot time (§4). */
const DegradationSchema = z.strictObject({
  kind: z.string().min(1),
  livePath: RelativeSubpathSchema.optional(),
  reason: z.string().min(1)
})

const commonManifestFields = {
  backupFormatVersion: z.literal(BACKUP_FORMAT_VERSION),
  createdAt: z.iso.datetime(),
  producer: ProducerSchema,
  migrationChain: z.array(MigrationChainEntrySchema).min(1),
  db: DbPayloadSchema,
  resourceRequirements: z.array(ResourceRequirementSchema),
  degradations: z.array(DegradationSchema)
}

/**
 * `preset` is pinned to the one preset that exists, so an archive declaring any
 * other preset is rejected here rather than reinterpreted as Full. Every archive
 * carries the payload inventory (possibly empty when the profile owns no
 * resources).
 */
export const BackupManifestSchema = z.strictObject({
  ...commonManifestFields,
  preset: z.enum(BACKUP_PRESETS),
  resourcePayloads: z.array(ResourcePayloadSchema)
})

export type BackupManifest = z.infer<typeof BackupManifestSchema>
export type ManagedRootIdentity = z.infer<typeof ManagedRootIdentitySchema>
export type ResourceRequirement = z.infer<typeof ResourceRequirementSchema>
export type ResourcePayload = z.infer<typeof ResourcePayloadSchema>
export type BackupManifestDegradation = z.infer<typeof DegradationSchema>

export type ReadManifestResult =
  | { readonly kind: 'ok'; readonly manifest: BackupManifest }
  | { readonly kind: 'invalid'; readonly error: string }

/**
 * Bounded envelope read before the strict format-specific schema. It exists only
 * to distinguish an intact archive made by another backup format from malformed
 * input; no payload/path field is accepted through this projection.
 */
const ManifestDiagnosticEnvelopeSchema = z.object({
  backupFormatVersion: z.number().int().safe().nonnegative(),
  producer: z
    .object({
      appVersion: ProducerAppVersionSchema,
      buildType: z.enum(BACKUP_PRODUCER_BUILD_TYPES).optional()
    })
    .optional()
})

export type ManifestDiagnosticEnvelope = z.infer<typeof ManifestDiagnosticEnvelopeSchema>

export function parseManifestDiagnosticEnvelope(value: unknown): ManifestDiagnosticEnvelope | undefined {
  const result = ManifestDiagnosticEnvelopeSchema.safeParse(value)
  return result.success ? result.data : undefined
}

/** Pure structural parse — no I/O. Phase 1b feeds already-read bytes here. */
export function parseBackupManifest(value: unknown): ReadManifestResult {
  const result = BackupManifestSchema.safeParse(value)
  return result.success ? { kind: 'ok', manifest: result.data } : { kind: 'invalid', error: result.error.message }
}
