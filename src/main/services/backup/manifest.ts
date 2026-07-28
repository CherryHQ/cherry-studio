import { BACKUP_DEGRADATION_CODES } from '@shared/ipc/schemas/backup'
import * as z from 'zod'

/** The incompatible whole-database Lite archive format. */
export const BACKUP_FORMAT_VERSION = 2 as const

const Sha256HexSchema = z.string().regex(/^[0-9a-f]{64}$/, 'must be 64 lowercase hex chars (sha256)')

const MigrationChainEntrySchema = z.strictObject({
  folderMillis: z.number().int().safe().nonnegative(),
  hash: z.string().min(1)
})

const ManagedRootIdentitySchema = z.strictObject({
  key: z.string().min(1),
  path: z.string().min(1)
})

const ManifestDegradationSchema = z.strictObject({
  code: z.enum(BACKUP_DEGRADATION_CODES),
  count: z.number().int().safe().positive()
})

const ProducerSchema = z.strictObject({
  platform: z.enum(['darwin', 'win32', 'linux']),
  // The only producer paths restore may use: deterministic rebasing inputs.
  managedRoots: z
    .array(ManagedRootIdentitySchema)
    .refine((roots) => new Set(roots.map((root) => root.key)).size === roots.length, {
      message: 'managed-root keys must be unique'
    })
})

/**
 * Lite archives are deliberately a closed, two-payload contract. No resource
 * inventory, compatibility provenance, or future-preset field is accepted.
 */
export const BackupManifestSchema = z.strictObject({
  backupFormatVersion: z.literal(BACKUP_FORMAT_VERSION),
  preset: z.literal('lite'),
  createdAt: z.iso.datetime(),
  producer: ProducerSchema,
  migrationChain: z.array(MigrationChainEntrySchema).min(1),
  db: z.strictObject({
    hash: Sha256HexSchema,
    sizeBytes: z.number().int().positive()
  }),
  // One aggregate per closed code; archive manifests never carry row IDs, paths, or details.
  degradations: z
    .array(ManifestDegradationSchema)
    .max(BACKUP_DEGRADATION_CODES.length)
    .refine((degradations) => new Set(degradations.map(({ code }) => code)).size === degradations.length, {
      message: 'degradation codes must be unique'
    })
})

export type BackupManifest = z.infer<typeof BackupManifestSchema>
export type ManagedRootIdentity = z.infer<typeof ManagedRootIdentitySchema>
export type BackupManifestDegradation = z.infer<typeof ManifestDegradationSchema>

export type ReadManifestResult =
  | { readonly kind: 'ok'; readonly manifest: BackupManifest }
  | { readonly kind: 'invalid'; readonly error: string }

/** Pure structural parse. Admission supplies already bounded, extracted bytes. */
export function parseBackupManifest(value: unknown): ReadManifestResult {
  const result = BackupManifestSchema.safeParse(value)
  return result.success ? { kind: 'ok', manifest: result.data } : { kind: 'invalid', error: result.error.message }
}
