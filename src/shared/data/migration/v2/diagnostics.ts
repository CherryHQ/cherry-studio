import * as z from 'zod'

export const migrationRendererExportFailureReportSchema = z.discriminatedUnion('sourceRole', [
  z
    .object({
      sourceRole: z.literal('redux'),
      operationRole: z.enum(['read', 'parse'])
    })
    .strict(),
  z
    .object({
      sourceRole: z.literal('dexie'),
      operationRole: z.enum(['open', 'read', 'serialize', 'write'])
    })
    .strict(),
  z
    .object({
      sourceRole: z.literal('local_storage'),
      operationRole: z.enum(['read', 'serialize', 'write'])
    })
    .strict(),
  z
    .object({
      sourceRole: z.literal('unknown'),
      operationRole: z.literal('unknown')
    })
    .strict()
])

export type MigrationRendererExportFailureReport = z.infer<typeof migrationRendererExportFailureReportSchema>
