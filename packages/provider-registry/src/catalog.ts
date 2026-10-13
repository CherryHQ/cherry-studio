import * as z from 'zod'

/**
 * Schema-compatibility version of the registry JSON contract.
 *
 * The remote updater fetches from a `v{REGISTRY_SCHEMA_VERSION}/` path and the
 * sync CI publishes to the matching dir, so an app only ever receives data its
 * bundled schema can parse. The sync CI derives its publish dir from this
 * constant (single source of truth).
 *
 * Bump on ANY change older clients cannot parse. Since v2 that is a narrow set:
 * the schemas drop what they do not recognize instead of failing the document
 * (`schemas/forwardCompat.ts`), so **enum-vocabulary growth no longer bumps** —
 * a new modality / capability / effort is dropped by v2 clients and honored by
 * newer ones. New optional fields were always safe (`z.object` strips unknown
 * keys). Structural changes (field rename / retype / required-field removal)
 * still bump. New runtime wire behavior also gets a new stream when it requires
 * raising {@link REGISTRY_MIN_APP_VERSION}, so older streams keep their existing
 * version floor and continue receiving compatible catalog updates.
 */
export const REGISTRY_SCHEMA_VERSION = 3

/**
 * Oldest application version whose runtime understands the semantic values in
 * the current remote catalog. Bump when data starts using a new adapter family,
 * endpoint type, wire behavior, or other value that older runtime code cannot execute.
 */
export const REGISTRY_MIN_APP_VERSION = '2.1.4'

/**
 * The three JSON data files this package emits (`packages/provider-registry/data/`).
 * The canonical definition of what a full catalog consists of — consumed by the
 * app's loader-path resolution and by the remote updater's fetch loop.
 */
export const REGISTRY_FILES = ['models.json', 'providers.json', 'provider-models.json'] as const
export type RegistryFileName = (typeof REGISTRY_FILES)[number]

/** Unsigned branch data permitted to shadow the bundle. Provider routing stays bundled. */
export const REMOTE_REGISTRY_FILES = ['models.json', 'provider-models.json'] as const
export type RemoteRegistryFileName = (typeof REMOTE_REGISTRY_FILES)[number]

/**
 * Manifest published alongside each `v{N}/` catalog set (written last as the
 * completion marker). Consumed by the app's remote updater — to validate a
 * downloaded manifest and to gate a persisted override — so both parse against
 * this one schema instead of hand-rolled checks.
 */
export const CatalogManifestSchema = z.object({
  /** Oldest app whose runtime can interpret this catalog's semantic values. */
  minAppVersion: z.string().min(1),
  /** Latest released bundle this snapshot is known to be at least as new as. */
  sourceAppVersion: z.string().min(1),
  /** Monotonic workflow revision; clients never replace an active snapshot with an older/equal revision. */
  revision: z.number().int().nonnegative(),
  /** Schema version the set targets; must equal {@link REGISTRY_SCHEMA_VERSION} to be usable. */
  schemaVersion: z.number().int(),
  /** filename → content-hash `version`, binding the set to one published snapshot. */
  files: z.record(z.string(), z.string())
})
export type CatalogManifest = z.infer<typeof CatalogManifestSchema>
