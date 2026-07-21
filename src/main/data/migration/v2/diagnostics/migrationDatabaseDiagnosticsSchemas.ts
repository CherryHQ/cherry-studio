import * as z from 'zod'

import { MIGRATION_DATABASE_OBJECT_DEFINITIONS } from './migrationDatabaseTargets'

export { MIGRATION_DATABASE_OBJECT_DEFINITIONS } from './migrationDatabaseTargets'

const objectRoles = MIGRATION_DATABASE_OBJECT_DEFINITIONS.map(({ role }) => role) as [
  (typeof MIGRATION_DATABASE_OBJECT_DEFINITIONS)[number]['role'],
  ...(typeof MIGRATION_DATABASE_OBJECT_DEFINITIONS)[number]['role'][]
]
const columnRoles = [...new Set(MIGRATION_DATABASE_OBJECT_DEFINITIONS.flatMap(({ columns }) => columns))] as [
  (typeof MIGRATION_DATABASE_OBJECT_DEFINITIONS)[number]['columns'][number],
  ...(typeof MIGRATION_DATABASE_OBJECT_DEFINITIONS)[number]['columns'][number][]
]
const maxExpectedColumnCount = Math.max(...MIGRATION_DATABASE_OBJECT_DEFINITIONS.map(({ columns }) => columns.length))

export const migrationDatabaseObjectRoleSchema = z.enum(objectRoles)
export const migrationDatabaseColumnRoleSchema = z.enum(columnRoles)

export const migrationDatabaseObjectCheckSchema = z
  .object({
    role: migrationDatabaseObjectRoleSchema,
    tableName: z.string().min(1).max(128),
    status: z.enum(['present', 'missing_table', 'missing_columns']),
    missingColumnRoles: z.array(migrationDatabaseColumnRoleSchema).min(1).max(maxExpectedColumnCount).optional()
  })
  .strict()
  .superRefine((object, ctx) => {
    const definition = MIGRATION_DATABASE_OBJECT_DEFINITIONS.find(({ role }) => role === object.role)
    if (definition === undefined) return
    if (object.tableName !== definition.table) {
      ctx.addIssue({
        code: 'custom',
        message: 'Database object checks must use the fixed physical table name',
        path: ['tableName']
      })
    }
    const missing = object.missingColumnRoles
    if ((object.status === 'missing_columns') !== (missing !== undefined)) {
      ctx.addIssue({
        code: 'custom',
        message: 'Missing-column roles appear only with missing_columns',
        path: ['missingColumnRoles']
      })
      return
    }
    if (missing === undefined) return
    if (new Set(missing).size !== missing.length || missing.some((column) => !definition.columns.includes(column))) {
      ctx.addIssue({
        code: 'custom',
        message: 'Missing columns must be unique fixed roles for the selected object',
        path: ['missingColumnRoles']
      })
    }
  })

const migrationDatabaseAvailableSqliteResultSchema = z
  .object({
    status: z.literal('available'),
    quickCheck: z.enum(['ok', 'failed']),
    foreignKeyViolationCountBucket: z.enum(['0', '1', '2-10', '11+']),
    objects: z.array(migrationDatabaseObjectCheckSchema).length(MIGRATION_DATABASE_OBJECT_DEFINITIONS.length)
  })
  .strict()
  .superRefine((result, ctx) => {
    for (const [index, definition] of MIGRATION_DATABASE_OBJECT_DEFINITIONS.entries()) {
      if (result.objects[index]?.role !== definition.role) {
        ctx.addIssue({
          code: 'custom',
          message: 'Database object checks must use the fixed role order',
          path: ['objects', index, 'role']
        })
      }
    }
  })

export const migrationDatabaseSqliteUnavailableReasonSchema = z.enum([
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

export const migrationDatabaseFileResultSchema = z
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

export type MigrationDatabaseObjectRole = z.infer<typeof migrationDatabaseObjectRoleSchema>
export type MigrationDatabaseColumnRole = z.infer<typeof migrationDatabaseColumnRoleSchema>
export type MigrationDatabaseObjectCheck = z.infer<typeof migrationDatabaseObjectCheckSchema>
export type MigrationDatabaseSqliteResult = z.infer<typeof migrationDatabaseSqliteResultSchema>
export type MigrationDatabaseFileResult = z.infer<typeof migrationDatabaseFileResultSchema>
export type MigrationDatabaseDiagnosticResult = z.infer<typeof migrationDatabaseDiagnosticResultSchema>
export type MigrationDatabaseDiagnosticsChildInput = z.infer<typeof migrationDatabaseDiagnosticsChildInputSchema>
export type MigrationDatabaseDiagnosticsChildMessage = z.infer<typeof migrationDatabaseDiagnosticsChildMessageSchema>
