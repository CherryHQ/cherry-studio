/**
 * BackupProgressTracker
 * Tracks backup/restore operations with phase-aware progress reporting
 */

import { loggerService } from '@logger'
import type { BackupDomain, BackupProgress, RestoreProgress } from '@shared/backup'

const logger = loggerService.withContext('BackupProgressTracker')

export enum BackupPhase {
  INIT = 'init',
  VACUUM = 'vacuum',
  FILES = 'files',
  COMPRESSING = 'compressing',
  FINALIZING = 'finalizing',
  COMPLETE = 'complete'
}

export enum RestorePhase {
  INIT = 'init',
  VALIDATING = 'validating',
  DECOMPRESSING = 'decompressing',
  MIGRATING = 'migrating',
  IMPORTING = 'importing',
  FTS_REBUILD = 'fts_rebuild',
  COMPLETE = 'complete'
}

export class BackupProgressTracker {
  private currentPhase: BackupPhase | RestorePhase = BackupPhase.INIT
  private currentDomain: BackupDomain | null = null
  private totalItems = 0
  private processedItems = 0
  private totalBytes = 0n
  private processedBytes = 0n
  private startTime = Date.now()
  private domainsProgress = new Map<BackupDomain, { total: number; processed: number }>()
  private errorCount = 0

  setPhase(phase: BackupPhase | RestorePhase): void {
    this.currentPhase = phase
  }

  setDomain(domain: BackupDomain, totalItems: number): void {
    this.currentDomain = domain
    this.domainsProgress.set(domain, { total: totalItems, processed: 0 })
  }

  incrementItemsProcessed(count: number = 1): void {
    this.processedItems += count
    if (this.currentDomain) {
      const progress = this.domainsProgress.get(this.currentDomain)
      if (progress) {
        progress.processed += count
        this.domainsProgress.set(this.currentDomain, progress)
      }
    }
  }

  updateBytesProcessed(bytes: number): void {
    this.processedBytes += BigInt(bytes)
  }

  setTotals(totalItems: number, totalBytes: bigint): void {
    this.totalItems = totalItems
    this.totalBytes = totalBytes
  }

  reportError(error: Error): void {
    this.errorCount++
    logger.error('Backup error', error)
  }

  getOverallProgress(): number {
    if (this.totalItems === 0) return 0
    return Math.min(100, Math.floor((this.processedItems / this.totalItems) * 100))
  }

  getDomainProgress(domain: BackupDomain): number {
    const progress = this.domainsProgress.get(domain)
    if (!progress || progress.total === 0) return 0
    return Math.min(100, Math.floor((progress.processed / progress.total) * 100))
  }

  getEstimatedTimeRemaining(): number | undefined {
    const elapsed = Date.now() - this.startTime
    if (this.processedBytes === 0n || elapsed < 1000) return undefined
    const bytesPerMs = Number(this.processedBytes) / elapsed
    const remainingBytes = Number(this.totalBytes - this.processedBytes)
    if (bytesPerMs <= 0) return undefined
    return Math.floor(remainingBytes / bytesPerMs)
  }

  getBackupProgress(): BackupProgress {
    return {
      phase: this.currentPhase as BackupPhase,
      domain: this.currentDomain ?? undefined,
      overallProgress: this.getOverallProgress(),
      domainProgress: this.currentDomain ? this.getDomainProgress(this.currentDomain) : 0,
      itemsProcessed: this.processedItems,
      totalItems: this.totalItems,
      bytesProcessed: Number(this.processedBytes),
      estimatedTimeRemaining: this.getEstimatedTimeRemaining()
    }
  }

  getRestoreProgress(): RestoreProgress {
    return {
      phase: this.currentPhase as RestorePhase,
      domain: this.currentDomain ?? undefined,
      overallProgress: this.getOverallProgress(),
      domainProgress: this.currentDomain ? this.getDomainProgress(this.currentDomain) : 0,
      itemsProcessed: this.processedItems,
      totalItems: this.totalItems,
      bytesProcessed: Number(this.processedBytes),
      estimatedTimeRemaining: this.getEstimatedTimeRemaining()
    }
  }
}
