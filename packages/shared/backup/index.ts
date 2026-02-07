/**
 * Backup Module - Unified Export
 * Re-exports all backup-related types and interfaces
 */

// Constants
export { BACKUP_MANIFEST_VERSION } from './types.js'

// Core types
export type {
  BackupDomain,
  BackupFileEntry,
  BackupManifest,
  DomainMetadata,
  DomainStats,
  EncryptionInfo,
  IncrementalChange,
  IncrementalManifest
} from './types.js'

// Options and configuration
export type {
  BackupOptions,
  BackupProgress,
  BackupStatistics,
  CompressionLevel,
  ConflictStrategy,
  MergeStrategy,
  RestoreOptions,
  RestoreProgress,
  RestoreStatistics,
  ValidationOptions
} from './options.js'

// Tree structures
export type {
  MessageTree,
  MessageTreeRef,
  TopicConflictType,
  TreeBuildResult,
  TreeDiff,
  TreeMergeOperation,
  TreeNode,
  TreeSerializationNode
} from './tree.js'

// Validation
export type {
  BackupValidator,
  ValidationContext,
  ValidationError,
  ValidationErrorCode,
  ValidationResult,
  ValidationSummary
} from './validation.js'
