/**
 * Validation Types
 * Defines structures for backup validation
 */

/**
 * Error codes for validation failures
 */
export enum ValidationErrorCode {
  // Manifest errors
  MANIFEST_MISSING = 'manifest_missing',
  MANIFEST_INVALID_VERSION = 'manifest_invalid_version',
  MANIFEST_CHECKSUM_MISMATCH = 'manifest_checksum_mismatch',
  MANIFEST_CORRUPTED = 'manifest_corrupted',

  // Domain errors
  DOMAIN_MISSING = 'domain_missing',
  DOMAIN_EMPTY = 'domain_empty',
  DOMAIN_CHECKSUM_MISMATCH = 'domain_checksum_mismatch',
  DOMAIN_INVALID_FORMAT = 'domain_invalid_format',
  DOMAIN_SCHEMA_VERSION_MISMATCH = 'domain_schema_version_mismatch',

  // File errors
  FILE_MISSING = 'file_missing',
  FILE_CORRUPTED = 'file_corrupted',
  FILE_SIZE_MISMATCH = 'file_size_mismatch',
  FILE_HASH_MISMATCH = 'file_hash_mismatch',

  // Encryption errors
  ENCRYPTION_PASSWORD_REQUIRED = 'encryption_password_required',
  ENCRYPTION_INVALID_PASSWORD = 'encryption_invalid_password',
  ENCRYPTION_CORRUPTED = 'encryption_corrupted',
  ENCRYPTION_MISSING_KEY = 'encryption_missing_key',

  // Structure errors
  STRUCTURE_INVALID = 'structure_invalid',
  STRUCTURE_MISSING_ROOT = 'structure_missing_root',
  STRUCTURE_CYCLE_DETECTED = 'structure_cycle_detected',
  STRUCTURE_ORPHANED_NODE = 'structure_orphaned_node',

  // Data errors
  DATA_INVALID = 'data_invalid',
  DATA_REQUIRED_FIELD_MISSING = 'data_required_field_missing',
  DATA_TYPE_MISMATCH = 'data_type_mismatch',
  DATA_VALUE_INVALID = 'data_value_invalid',

  // Compatibility errors
  COMPAT_PLATFORM_MISMATCH = 'compat_platform_mismatch',
  COMPAT_VERSION_TOO_OLD = 'compat_version_too_old',
  COMPAT_VERSION_TOO_NEW = 'compat_version_too_new',

  // Incremental backup errors
  INCREMENTAL_CHAIN_BROKEN = 'incremental_chain_broken',
  INCREMENTAL_PARENT_MISSING = 'incremental_parent_missing',
  INCREMENTAL_SEQUENCE_GAP = 'incremental_sequence_gap'
}

/**
 * Validation error with context
 */
export interface ValidationError {
  /** Error code */
  code: ValidationErrorCode
  /** Human-readable message */
  message: string
  /** Domain where error occurred (if applicable) */
  domain?: string
  /** File path where error occurred */
  filePath?: string
  /** Record ID where error occurred */
  recordId?: string
  /** Expected value */
  expected?: unknown
  /** Actual value */
  actual?: unknown
  /** Nested validation errors */
  nestedErrors?: ValidationError[]
  /** Suggestion for fixing the error */
  suggestion?: string
}

/**
 * Result of validation
 */
export interface ValidationResult {
  /** Whether validation passed */
  valid: boolean
  /** List of errors encountered */
  errors: ValidationError[]
  /** List of warnings (non-fatal issues) */
  warnings: ValidationError[]
  /** Validation duration in milliseconds */
  duration: number
  /** Files that were validated */
  filesValidated: string[]
  /** Records that were validated */
  recordsValidated: number
}

/**
 * Summary of validation results by severity
 */
export interface ValidationSummary {
  /** Total error count */
  errorCount: number
  /** Total warning count */
  warningCount: number
  /** Errors grouped by code */
  errorsByCode: Record<ValidationErrorCode, number>
  /** Errors grouped by domain */
  errorsByDomain: Record<string, number>
  /** Whether validation can proceed despite errors */
  canProceed: boolean
  /** Recommended action */
  recommendedAction: 'none' | 'skip' | 'repair' | 'abort'
}

/**
 * Validator interface for custom validators
 */
export interface BackupValidator {
  /** Get the name of this validator */
  getName(): string
  /** Validate a backup */
  validate(context: ValidationContext): Promise<ValidationResult>
}

/**
 * Context provided to validators
 */
export interface ValidationContext {
  /** Backup manifest */
  manifest: {
    version: string
    createdAt: string
    domains: string[]
    domainStats: Record<string, { itemCount: number; checksum: string }>
  }
  /** Paths to domain data files */
  domainPaths: Map<string, string>
  /** Paths to file storage */
  filePaths: Map<string, string>
  /** Encryption info if encrypted */
  encryption?: {
    algorithm: string
    hasPassword: boolean
  }
  /** Options for this validation */
  options: {
    checkIntegrity: boolean
    checkFiles: boolean
    checkEncryption: boolean
    collectAllErrors: boolean
  }
  /** Function to read a file */
  readFile: (path: string) => Promise<Uint8Array>
  /** Function to validate a checksum */
  verifyChecksum: (data: Uint8Array, expected: string) => Promise<boolean>
}
