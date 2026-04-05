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

/** Validate that a string is an absolute filesystem path (Unix or Windows) */
const AbsolutePathSchema = z
  .string()
  .min(1)
  .refine((s) => /^\//.test(s) || /^[A-Za-z]:\\/.test(s), 'basePath must be an absolute path')

/** Managed files: app-internal storage, UUID-based naming */
export const LocalManagedConfigSchema = z.object({
  providerType: z.literal('local_managed'),
  basePath: AbsolutePathSchema
})

/** External files: filesystem as source of truth, human-readable naming */
export const LocalExternalConfigSchema = z.object({
  providerType: z.literal('local_external'),
  basePath: AbsolutePathSchema,
  watch: z.boolean().default(true),
  watchExtensions: z.array(z.string()).default([])
})

/** Remote files: accessed via API */
export const RemoteConfigSchema = z.object({
  providerType: z.literal('remote'),
  apiType: RemoteApiTypeSchema,
  providerId: z.string().min(1),
  cachePath: z.string().optional(),
  autoSync: z.boolean().default(false),
  options: z.record(z.string(), z.unknown()).default({})
})

/** System mount: no physical storage, used for structural nodes like Trash */
export const SystemConfigSchema = z.object({
  providerType: z.literal('system')
})

// ─── Discriminated Union ───

export const MountProviderConfigSchema = z.discriminatedUnion('providerType', [
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
