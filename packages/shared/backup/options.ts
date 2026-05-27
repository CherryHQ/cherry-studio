/**
 * Backup & Restore Options
 * V2 architecture: VACUUM INTO + selective restore
 *
 * Cross-process public contracts used for IPC between main and renderer.
 */

import * as z from 'zod'

import { type BackupDomain, BackupDomainSchema, type BackupMode, BackupModeSchema } from './types.js'

/** Conflict resolution strategy when a restored row's primary key already exists in the live database. */
export const ConflictStrategy = {
  /** Preserve the existing row; discard the backup row. */
  SKIP: 'skip',
  /** Replace the existing row with the backup row. */
  OVERWRITE: 'overwrite',
  /** Assign a new UUID to the backup row and insert alongside the existing row. */
  RENAME: 'rename'
} as const

export type ConflictStrategy = (typeof ConflictStrategy)[keyof typeof ConflictStrategy]

/** Runtime schema for restore conflict strategies. */
export const ConflictStrategySchema = z.enum(
  Object.values(ConflictStrategy) as [ConflictStrategy, ...ConflictStrategy[]]
)

/** ZIP compression level for backup archives. */
export const CompressionLevel = {
  NONE: 0,
  FAST: 1,
  NORMAL: 5,
  MAXIMUM: 9
} as const

export type CompressionLevel = (typeof CompressionLevel)[keyof typeof CompressionLevel]

/** Runtime schema for supported ZIP compression levels. */
export const CompressionLevelSchema = z.union([
  z.literal(CompressionLevel.NONE),
  z.literal(CompressionLevel.FAST),
  z.literal(CompressionLevel.NORMAL),
  z.literal(CompressionLevel.MAXIMUM)
])

/** Options for backup export operations. */
export interface BackupOptions {
  mode?: BackupMode
  domains: BackupDomain[]
  includeFiles?: boolean
  includeKnowledgeFiles?: boolean
  /** When true, sensitive data (provider API keys, auth config) is included in the backup. Defaults to false. */
  includeSensitiveData?: boolean
  compressionLevel?: CompressionLevel
}

/** Runtime schema for backup export options. */
export const BackupOptionsSchema = z.strictObject({
  mode: BackupModeSchema.optional(),
  domains: z.array(BackupDomainSchema),
  includeFiles: z.boolean().optional(),
  includeKnowledgeFiles: z.boolean().optional(),
  includeSensitiveData: z.boolean().optional(),
  compressionLevel: CompressionLevelSchema.optional()
})

/** Real-time progress events for backup export. */
export interface BackupProgress {
  phase: 'init' | 'vacuum' | 'files' | 'compressing' | 'finalizing' | 'complete'
  domain?: string
  overallProgress: number
  domainProgress: number
  itemsProcessed: number
  totalItems: number
  bytesProcessed: number
  estimatedTimeRemaining?: number
  message?: string
}

/** Options for backup restore operations. */
export interface RestoreOptions {
  domains?: BackupDomain[]
  conflictStrategy?: ConflictStrategy
  restoreFiles?: boolean
  /** When true, only validate the archive without performing actual restore. */
  validateOnly?: boolean
}

/** Runtime schema for backup restore options. */
export const RestoreOptionsSchema = z.strictObject({
  domains: z.array(BackupDomainSchema).optional(),
  conflictStrategy: ConflictStrategySchema.optional(),
  restoreFiles: z.boolean().optional(),
  validateOnly: z.boolean().optional()
})

/** Real-time progress events for backup restore. */
export interface RestoreProgress {
  phase: 'init' | 'validating' | 'decompressing' | 'migrating' | 'importing' | 'fts_rebuild' | 'complete'
  domain?: string
  overallProgress: number
  domainProgress: number
  itemsProcessed: number
  totalItems: number
  bytesProcessed: number
  estimatedTimeRemaining?: number
  message?: string
}

export interface ValidationOptions {
  checkIntegrity?: boolean
  checkManifest?: boolean
  checkFiles?: boolean
  collectAllErrors?: boolean
}

/** Runtime schema for backup validation options. */
export const ValidationOptionsSchema = z.strictObject({
  checkIntegrity: z.boolean().optional(),
  checkManifest: z.boolean().optional(),
  checkFiles: z.boolean().optional(),
  collectAllErrors: z.boolean().optional()
})

/** Statistics returned after a successful backup export. */
export interface BackupStatistics {
  duration: number
  rawSize: number
  compressedSize: number
  compressionRatio: number
  domainCounts: Record<string, number>
  fileCount: number
}

/** Statistics returned after a successful backup restore. */
export interface RestoreStatistics {
  duration: number
  domainCounts: Record<string, number>
  conflictCount: number
  resolvedCount: number
  skippedCount: number
  fileCount: number
  errorCount: number
}
