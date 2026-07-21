import * as z from 'zod'

import { migrationDatabaseDiagnosticResultSchema } from './migrationDatabaseDiagnosticsSchemas'
import {
  migrationDiagnosticAppMetadataSchema,
  migrationDiagnosticAttemptSchema,
  migrationDiagnosticFinishedAttemptSchema
} from './migrationDiagnosticsSchemas'

export const MIGRATION_DIAGNOSTIC_BUNDLE_LIMIT_BYTES = 1_048_576
export const MIGRATION_DIAGNOSTIC_BUNDLE_ENTRIES = Object.freeze(['migration-diagnostics.json', 'README.txt'] as const)

export const migrationDiagnosticBundleEntryNameSchema = z.enum(MIGRATION_DIAGNOSTIC_BUNDLE_ENTRIES)

export const migrationDiagnosticBundleDocumentSchema = z
  .object({
    formatVersion: z.literal(2),
    generatedAt: z.string().datetime(),
    app: migrationDiagnosticAppMetadataSchema,
    state: z.enum(['active', 'failed', 'completed']),
    previous: migrationDiagnosticFinishedAttemptSchema.optional(),
    current: migrationDiagnosticAttemptSchema.optional(),
    database: migrationDatabaseDiagnosticResultSchema
  })
  .strict()

export type MigrationDiagnosticBundleEntryName = z.infer<typeof migrationDiagnosticBundleEntryNameSchema>
export type MigrationDiagnosticBundleDocument = z.infer<typeof migrationDiagnosticBundleDocumentSchema>
