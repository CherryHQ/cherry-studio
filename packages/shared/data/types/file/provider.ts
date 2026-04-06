/**
 * Mount configuration types
 *
 * Zod schemas for runtime validation of mount config JSON stored in DB.
 * Each mount entry has a mountConfig field describing its storage mode.
 */

import * as z from 'zod'

// ─── Mount Type Enum ───

export const MountTypeSchema = z.enum(['local_managed', 'local_external', 'remote', 'system'])
export type MountType = z.infer<typeof MountTypeSchema>

// ─── Remote API Type Enum ───

export const RemoteApiTypeSchema = z.enum([
  'openai_files'
  // Future: 's3', 'webdav', 'google_drive', ...
])
export type RemoteApiType = z.infer<typeof RemoteApiTypeSchema>

// ─── Mount Config Schemas ───

/** Validate that a string is an absolute filesystem path (Unix or Windows) */
const AbsolutePathSchema = z
  .string()
  .min(1)
  .refine((s) => s.startsWith('/') || /^[A-Za-z]:\\/.test(s), 'basePath must be an absolute path')

/** Managed files: app-internal storage, UUID-based naming */
export const LocalManagedConfigSchema = z.object({
  mountType: z.literal('local_managed'),
  basePath: AbsolutePathSchema
})

/** External files: filesystem as source of truth, human-readable naming */
export const LocalExternalConfigSchema = z.object({
  mountType: z.literal('local_external'),
  basePath: AbsolutePathSchema,
  watch: z.boolean().default(true),
  watchExtensions: z.array(z.string()).default([])
})

/** Remote files: accessed via API */
export const RemoteConfigSchema = z.object({
  mountType: z.literal('remote'),
  apiType: RemoteApiTypeSchema,
  providerId: z.string().min(1),
  cachePath: z.string().optional(),
  autoSync: z.boolean().default(false),
  options: z.record(z.string(), z.unknown()).default({})
})

/** System mount: no physical storage, used for structural nodes like Trash */
export const SystemConfigSchema = z.object({
  mountType: z.literal('system')
})

// ─── Discriminated Union ───

export const MountConfigSchema = z.discriminatedUnion('mountType', [
  LocalManagedConfigSchema,
  LocalExternalConfigSchema,
  RemoteConfigSchema,
  SystemConfigSchema
])
export type MountConfig = z.infer<typeof MountConfigSchema>

// ─── Individual config types ───

export type LocalManagedConfig = z.infer<typeof LocalManagedConfigSchema>
export type LocalExternalConfig = z.infer<typeof LocalExternalConfigSchema>
export type RemoteConfig = z.infer<typeof RemoteConfigSchema>
export type SystemConfig = z.infer<typeof SystemConfigSchema>
