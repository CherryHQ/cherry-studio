/**
 * Mount provider configuration types
 *
 * Zod schemas for runtime validation of provider config JSON stored in DB.
 * Each mount node has a providerConfig field describing its storage mode.
 */

import * as z from 'zod'

// ─── Provider Type Enum ───

export const MountProviderTypeSchema = z.enum(['local_managed', 'local_external', 'remote', 'system'])
export type MountProviderType = z.infer<typeof MountProviderTypeSchema>

// ─── Remote API Type Enum ───

export const RemoteApiTypeSchema = z.enum([
  'openai_files'
  // Future: 's3', 'webdav', 'google_drive', ...
])
export type RemoteApiType = z.infer<typeof RemoteApiTypeSchema>

// ─── Provider Config Schemas ───

/** Managed files: app-internal storage, UUID-based naming */
export const LocalManagedConfigSchema = z.object({
  provider_type: z.literal('local_managed'),
  base_path: z.string().min(1)
})

/** External files: filesystem as source of truth, human-readable naming */
export const LocalExternalConfigSchema = z.object({
  provider_type: z.literal('local_external'),
  base_path: z.string().min(1),
  watch: z.boolean().default(true),
  watch_extensions: z.array(z.string()).optional()
})

/** Remote files: accessed via API */
export const RemoteConfigSchema = z.object({
  provider_type: z.literal('remote'),
  api_type: RemoteApiTypeSchema,
  provider_id: z.string().min(1),
  cache_path: z.string().optional(),
  auto_sync: z.boolean().default(false),
  options: z.record(z.string(), z.unknown()).default({})
})

/** System mount: no physical storage, used for structural nodes like Trash */
export const SystemConfigSchema = z.object({
  provider_type: z.literal('system')
})

// ─── Discriminated Union ───

export const MountProviderConfigSchema = z.discriminatedUnion('provider_type', [
  LocalManagedConfigSchema,
  LocalExternalConfigSchema,
  RemoteConfigSchema,
  SystemConfigSchema
])
export type MountProviderConfig = z.infer<typeof MountProviderConfigSchema>

// ─── Individual config types ───

export type LocalManagedConfig = z.infer<typeof LocalManagedConfigSchema>
export type LocalExternalConfig = z.infer<typeof LocalExternalConfigSchema>
export type RemoteConfig = z.infer<typeof RemoteConfigSchema>
export type SystemConfig = z.infer<typeof SystemConfigSchema>
