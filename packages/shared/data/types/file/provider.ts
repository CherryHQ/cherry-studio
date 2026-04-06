/**
 * Mount types — Zod schemas for mount table validation.
 *
 * Mount config is stored as independent columns (not JSON).
 * These schemas validate the column-level data.
 */

import * as z from 'zod'

// ─── Mount Type Enum ───

export const MountTypeSchema = z.enum(['local_managed', 'local_external', 'remote', 'system'])
export type MountType = z.infer<typeof MountTypeSchema>

// ─── System Key Enum ───

export const SystemKeySchema = z.enum(['files', 'notes', 'temp', 'trash'])
export type SystemKey = z.infer<typeof SystemKeySchema>

// ─── Remote API Type Enum ───

export const RemoteApiTypeSchema = z.enum([
  'openai_files'
  // Future: 's3', 'webdav', 'google_drive', ...
])
export type RemoteApiType = z.infer<typeof RemoteApiTypeSchema>

// ─── Mount Schema ───

/** Validate that a string is an absolute filesystem path (Unix or Windows) */
const AbsolutePathSchema = z
  .string()
  .min(1)
  .refine((s) => s.startsWith('/') || /^[A-Za-z]:\\/.test(s), 'basePath must be an absolute path')

export const MountSchema = z
  .object({
    id: z.string().min(1),
    systemKey: SystemKeySchema.nullable(),
    name: z.string().min(1),
    mountType: MountTypeSchema,
    // local_managed / local_external
    basePath: AbsolutePathSchema.nullable(),
    // local_external
    watch: z.boolean().nullable(),
    watchExtensions: z.array(z.string()).nullable(),
    // remote
    apiType: RemoteApiTypeSchema.nullable(),
    providerId: z.string().min(1).nullable(),
    cachePath: z.string().nullable(),
    autoSync: z.boolean().nullable(),
    remoteOptions: z.record(z.string(), z.unknown()).nullable(),
    // timestamps
    createdAt: z.number().int().nonnegative(),
    updatedAt: z.number().int().nonnegative()
  })
  .superRefine((mount, ctx) => {
    if ((mount.mountType === 'local_managed' || mount.mountType === 'local_external') && mount.basePath === null) {
      ctx.addIssue({ code: 'custom', path: ['basePath'], message: 'basePath is required for local mounts' })
    }
    if (mount.mountType === 'remote') {
      if (mount.apiType === null) {
        ctx.addIssue({ code: 'custom', path: ['apiType'], message: 'apiType is required for remote mounts' })
      }
      if (mount.providerId === null) {
        ctx.addIssue({ code: 'custom', path: ['providerId'], message: 'providerId is required for remote mounts' })
      }
    }
  })
export type Mount = z.infer<typeof MountSchema>
