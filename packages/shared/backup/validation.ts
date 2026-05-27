/**
 * Backup Validation Types
 * V2 architecture: VACUUM INTO + selective restore
 *
 * Cross-process public contracts used for backup validation.
 */

import * as z from 'zod'

/** Error codes for backup validation failures, categorized by subsystem. */
export const ValidationErrorCode = {
  // Manifest errors
  MANIFEST_MISSING: 'manifest_missing',
  MANIFEST_INVALID_VERSION: 'manifest_invalid_version',
  MANIFEST_CHECKSUM_MISMATCH: 'manifest_checksum_mismatch',
  MANIFEST_CORRUPTED: 'manifest_corrupted',

  // Domain errors
  DOMAIN_MISSING: 'domain_missing',
  DOMAIN_EMPTY: 'domain_empty',
  DOMAIN_CHECKSUM_MISMATCH: 'domain_checksum_mismatch',
  DOMAIN_INVALID_FORMAT: 'domain_invalid_format',
  DOMAIN_SCHEMA_VERSION_MISMATCH: 'domain_schema_version_mismatch',

  // File errors
  FILE_MISSING: 'file_missing',
  FILE_CORRUPTED: 'file_corrupted',
  FILE_SIZE_MISMATCH: 'file_size_mismatch',
  FILE_HASH_MISMATCH: 'file_hash_mismatch',

  // Structure errors
  STRUCTURE_INVALID: 'structure_invalid',
  STRUCTURE_MISSING_ROOT: 'structure_missing_root',
  STRUCTURE_CYCLE_DETECTED: 'structure_cycle_detected',
  STRUCTURE_ORPHANED_NODE: 'structure_orphaned_node',

  // Data errors
  DATA_INVALID: 'data_invalid',
  DATA_REQUIRED_FIELD_MISSING: 'data_required_field_missing',
  DATA_TYPE_MISMATCH: 'data_type_mismatch',
  DATA_VALUE_INVALID: 'data_value_invalid',

  // Compatibility errors
  COMPAT_PLATFORM_MISMATCH: 'compat_platform_mismatch',
  COMPAT_VERSION_TOO_OLD: 'compat_version_too_old',
  COMPAT_VERSION_TOO_NEW: 'compat_version_too_new',

  // Schema migration errors
  SCHEMA_MIGRATION_FAILED: 'schema_migration_failed',
  SCHEMA_DOWNGRADE_NOT_SUPPORTED: 'schema_downgrade_not_supported'
} as const

export type ValidationErrorCode = (typeof ValidationErrorCode)[keyof typeof ValidationErrorCode]

/** Runtime schema for backup validation error codes. */
export const ValidationErrorCodeSchema = z.enum(
  Object.values(ValidationErrorCode) as [ValidationErrorCode, ...ValidationErrorCode[]]
)

/** Validation error or warning surfaced during backup inspection or restore preparation. */
export interface ValidationError {
  code: ValidationErrorCode
  message: string
  domain?: string
  filePath?: string
  recordId?: string
  expected?: unknown
  actual?: unknown
  nestedErrors?: ValidationError[]
  suggestion?: string
}

/** Runtime schema for validation error payloads crossing process boundaries. */
export const ValidationErrorSchema: z.ZodType<ValidationError> = z.lazy(() =>
  z.strictObject({
    code: ValidationErrorCodeSchema,
    message: z.string().min(1),
    domain: z.string().optional(),
    filePath: z.string().optional(),
    recordId: z.string().optional(),
    expected: z.unknown().optional(),
    actual: z.unknown().optional(),
    nestedErrors: z.array(ValidationErrorSchema).optional(),
    suggestion: z.string().optional()
  })
)

/** Aggregate validation result returned by archive validation APIs. */
export interface ValidationResult {
  valid: boolean
  errors: ValidationError[]
  warnings: ValidationError[]
  duration: number
  filesValidated: string[]
  recordsValidated: number
}

/** Runtime schema for aggregate validation results. */
export const ValidationResultSchema = z.strictObject({
  valid: z.boolean(),
  errors: z.array(ValidationErrorSchema),
  warnings: z.array(ValidationErrorSchema),
  duration: z.number().nonnegative(),
  filesValidated: z.array(z.string()),
  recordsValidated: z.number().int().nonnegative()
})

export interface ValidationSummary {
  errorCount: number
  warningCount: number
  errorsByCode: Partial<Record<ValidationErrorCode, number>>
  errorsByDomain: Record<string, number>
  canProceed: boolean
  recommendedAction: 'none' | 'skip' | 'repair' | 'abort'
}

export interface BackupValidator {
  getName(): string
  validate(context: ValidationContext): Promise<ValidationResult>
}

export interface ValidationContext {
  manifest: {
    version: number
    createdAt: string
    domains: string[]
    domainStats: Record<string, { itemCount: number; sizeBytes: number }>
    schemaVersion: { hash: string; createdAt: number }
  }
  backupDbPath: string
  filePaths: Map<string, string>
  options: {
    checkIntegrity: boolean
    checkFiles: boolean
    collectAllErrors: boolean
  }
  readFile: (path: string) => Promise<Uint8Array>
  verifyChecksum: (filePath: string, expected: string) => Promise<boolean>
}
