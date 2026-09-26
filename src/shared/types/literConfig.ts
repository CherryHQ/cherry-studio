import * as z from 'zod'

export const literConfigSourceSchema = z.discriminatedUnion('ownership', [
  z.object({ ownership: z.literal('managed') }).strict(),
  z.object({ ownership: z.literal('local'), path: z.string().min(1) }).strict()
])

export const literConfigEditSchema = z
  .object({
    path: z
      .string()
      .min(1)
      .max(512)
      .regex(/^[A-Za-z0-9_-]+(?:\.(?:[A-Za-z0-9_-]+|\[\d+\]))*$/),
    value: z.unknown()
  })
  .strict()
  .superRefine((edit, context) => {
    const segments = edit.path.split('.')
    if (
      segments[0] === 'models' ||
      segments.some((segment) => /(?:key|token|secret|credential|password)/i.test(segment))
    ) {
      context.addIssue({
        code: 'custom',
        path: ['path'],
        message: 'Provider models and secret-bearing fields are managed by the main process'
      })
    }
  })

export type LiterConfigSource = z.infer<typeof literConfigSourceSchema>
export type LiterConfigEdit = z.infer<typeof literConfigEditSchema>
export type LiterConfigSourceSelection = LiterConfigSource | { cancelled: true }

export type LiterConfigValidation =
  | { valid: true }
  | { valid: false; code: 'binary_unavailable' | 'invalid_config' | 'read_failed'; message: string }

export type LiterConfigSnapshot = {
  source: LiterConfigSource
  path: string
  exists: boolean
  revision: string
  checker: { available: boolean; path?: string; version?: string }
  validation: LiterConfigValidation
}

export type LiterConfigPreview = {
  source: LiterConfigSource
  baseRevision: string
  nextRevision: string
  changedPaths: string[]
  validation: LiterConfigValidation
  conflict?: { expectedRevision: string; currentRevision: string }
}

export type LiterConfigApplyState = 'validation-failed' | 'restart-required' | 'deployment-required' | 'conflict'

export type LiterConfigApplyResult = LiterConfigPreview & {
  state: LiterConfigApplyState
  backupPath?: string
  appliedPath?: string
}

export type LiterConfigExportResult = {
  cancelled: boolean
  remoteEndpoint?: string
  path?: string
  revision?: string
  validation?: LiterConfigValidation
  state?: 'deployment-required' | 'conflict'
  conflict?: { expectedRevision: string; currentRevision: string }
}
