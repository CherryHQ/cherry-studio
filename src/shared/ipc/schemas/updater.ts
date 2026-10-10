import * as z from 'zod'

export const updateReleaseSchema = z.strictObject({
  candidateId: z.string(),
  version: z.string(),
  releaseNotes: z
    .union([z.string(), z.array(z.object({ version: z.string(), note: z.string().nullable() }))])
    .optional(),
  releaseDate: z.string().optional()
})

export const updateSnapshotSchema = z.strictObject({
  sessionId: z.string(),
  revision: z.number().int().nonnegative(),
  phase: z.enum(['idle', 'checking', 'downloading', 'cancelling', 'ready', 'installing', 'unavailable']),
  release: updateReleaseSchema.nullable(),
  percent: z.number().min(0).max(100).nullable(),
  error: z.string().nullable()
})

export type UpdateRelease = z.infer<typeof updateReleaseSchema>
export type UpdateSnapshot = z.infer<typeof updateSnapshotSchema>
