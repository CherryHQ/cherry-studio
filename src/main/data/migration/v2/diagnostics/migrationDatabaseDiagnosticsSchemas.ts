import * as z from 'zod'

import { MIGRATION_DATABASE_OBJECT_DEFINITIONS } from './migrationDatabaseTargets'

export { MIGRATION_DATABASE_OBJECT_DEFINITIONS } from './migrationDatabaseTargets'

const databaseIdentifierSchema = z.string().min(1).max(128)

const migrationDatabaseSchemaResultSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('ok') }).strict(),
  z
    .object({
      status: z.literal('mismatch'),
      missingTables: z.array(databaseIdentifierSchema).max(MIGRATION_DATABASE_OBJECT_DEFINITIONS.length),
      missingColumns: z.record(databaseIdentifierSchema, z.array(databaseIdentifierSchema).min(1))
    })
    .strict()
])

const migrationDatabaseAvailableSqliteResultSchema = z
  .object({
    status: z.literal('available'),
    quickCheck: z.enum(['ok', 'failed']),
    foreignKeyViolationCount: z.number().int().nonnegative(),
    schema: migrationDatabaseSchemaResultSchema
  })
  .strict()

const migrationDatabaseSqliteUnavailableReasonSchema = z.enum([
  'not_attempted',
  'open_failed',
  'query_failed',
  'timeout',
  'child_exit',
  'invalid_output'
])

export const migrationDatabaseSqliteResultSchema = z.discriminatedUnion('status', [
  migrationDatabaseAvailableSqliteResultSchema,
  z
    .object({
      status: z.literal('unavailable'),
      reason: migrationDatabaseSqliteUnavailableReasonSchema
    })
    .strict()
])

const migrationDatabaseFileResultSchema = z
  .object({
    status: z.enum(['missing', 'not_regular', 'readable', 'unreadable']),
    sizeBucket: z.enum(['0', '1-4095', '4096-1m', '1m-100m', '100m+']).optional(),
    sqliteHeader: z.enum(['valid', 'invalid', 'unavailable']),
    walPresent: z.boolean().optional(),
    shmPresent: z.boolean().optional()
  })
  .strict()
  .superRefine((file, ctx) => {
    if ((file.status === 'missing' || file.status === 'not_regular') && file.sizeBucket !== undefined) {
      ctx.addIssue({
        code: 'custom',
        message: 'Missing and non-regular files cannot expose a size bucket',
        path: ['sizeBucket']
      })
    }
    if (file.status === 'readable' && file.sizeBucket === undefined) {
      ctx.addIssue({ code: 'custom', message: 'Readable files expose a size bucket', path: ['sizeBucket'] })
    }
    if (file.status === 'readable' && file.sqliteHeader === 'unavailable') {
      ctx.addIssue({ code: 'custom', message: 'Readable files expose a header result', path: ['sqliteHeader'] })
    }
    if (file.status !== 'readable' && file.sqliteHeader !== 'unavailable') {
      ctx.addIssue({
        code: 'custom',
        message: 'Unreadable files cannot expose a header result',
        path: ['sqliteHeader']
      })
    }
  })

export const migrationDatabaseDiagnosticResultSchema = z
  .object({
    file: migrationDatabaseFileResultSchema,
    sqlite: migrationDatabaseSqliteResultSchema
  })
  .strict()

export const migrationDatabaseDiagnosticsChildInputSchema = z
  .object({
    databaseFile: z.string().min(1).max(4_096)
  })
  .strict()

export const migrationDatabaseDiagnosticsChildMessageSchema = z
  .object({
    type: z.literal('result'),
    result: migrationDatabaseSqliteResultSchema
  })
  .strict()

export type MigrationDatabaseSqliteResult = z.infer<typeof migrationDatabaseSqliteResultSchema>
export type MigrationDatabaseFileResult = z.infer<typeof migrationDatabaseFileResultSchema>
export type MigrationDatabaseDiagnosticResult = z.infer<typeof migrationDatabaseDiagnosticResultSchema>
export type MigrationDatabaseDiagnosticsChildInput = z.infer<typeof migrationDatabaseDiagnosticsChildInputSchema>
export type MigrationDatabaseDiagnosticsChildMessage = z.infer<typeof migrationDatabaseDiagnosticsChildMessageSchema>
