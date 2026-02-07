/**
 * BackupProgressTracker
 * Tracks backup/restore operations with phase-aware progress reporting
 */

import { loggerService } from '@logger'
import type { BackupDomain, BackupProgress, RestoreProgress } from '@shared/backup'
import { EventEmitter } from 'events'

const logger = loggerService.withContext('BackupProgressTracker')

export enum BackupPhase {
  INIT = 'init',
  SCANNING = 'scanning',
  EXPORTING = 'exporting',
  COMPRESSING = 'compressing',
  FINALIZING = 'finalizing',
  COMPLETE = 'complete'
}

export enum RestorePhase {
  INIT = 'init',
  VALIDATING = 'validating',
  DECOMPRESSING = 'decompressing',
  IMPORTING = 'importing',
  LINKING = 'linking',
  COMPLETE = 'complete'
}

export class BackupProgressTracker extends EventEmitter {
  private currentPhase: BackupPhase | RestorePhase
  private currentDomain: BackupDomain | null
  private totalItems: number
  private processedItems: number
  private totalBytes: bigint
  private processedBytes: bigint
  private startTime: number

  private domainsProgress: Map<BackupDomain, { total: number; processed: number }>
  private errorCount: number

  constructor() {
    super()
    this.currentPhase = BackupPhase.INIT
    this.currentDomain = null
    this.totalItems = 0
    this.processedItems = 0
    this.totalBytes = 0n
    this.processedBytes = 0n
    this.startTime = Date.now()
    this.domainsProgress = new Map()
    this.errorCount = 0
  }

  setPhase(phase: BackupPhase | RestorePhase): void {
    this.currentPhase = phase
    this.emit('phaseChange', phase)
  }

  setDomain(domain: BackupDomain, totalItems: number): void {
    this.currentDomain = domain
    this.domainsProgress.set(domain, { total: totalItems, processed: 0 })
    this.emit('domainChange', domain)
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
    this.emit('error', error)
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
