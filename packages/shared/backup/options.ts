/**
 * Backup & Restore Options
 * V2 architecture: VACUUM INTO + selective restore
 */

export enum ConflictStrategy {
  SKIP = 'skip',
  OVERWRITE = 'overwrite',
  RENAME = 'rename'
}

export enum CompressionLevel {
  NONE = 0,
  FAST = 1,
  NORMAL = 5,
  MAXIMUM = 9
}

export interface BackupOptions {
  includeFiles?: boolean
  includeKnowledgeFiles?: boolean
  compressionLevel?: CompressionLevel
  onProgress?: (progress: BackupProgress) => void
}

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

export interface RestoreOptions {
  domains?: string[]
  conflictStrategy?: ConflictStrategy
  restoreFiles?: boolean
  validateOnly?: boolean
  onProgress?: (progress: RestoreProgress) => void
}

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

export interface BackupStatistics {
  duration: number
  rawSize: number
  compressedSize: number
  compressionRatio: number
  domainCounts: Record<string, number>
  fileCount: number
}

export interface RestoreStatistics {
  duration: number
  domainCounts: Record<string, number>
  conflictCount: number
  resolvedCount: number
  skippedCount: number
  fileCount: number
  errorCount: number
}
