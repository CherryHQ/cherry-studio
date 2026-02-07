/**
 * ManifestBuilder
 * Builds backup manifest with all domain statistics
 */

import * as crypto from 'node:crypto'

import type { BackupDomain, BackupManifest, EncryptionInfo, IncrementalManifest } from '@shared/backup'
import { BACKUP_MANIFEST_VERSION } from '@shared/backup'
import { app } from 'electron'

import type { ExportResult } from '../providers/BaseDomainExporter'

export class ManifestBuilder {
  private domainResults: Map<BackupDomain, ExportResult>
  private options: {
    encryptionPassword?: string
    incremental?: boolean
    chainId?: string
  }

  constructor(options: {
    encryptionPassword?: string
    incremental?: boolean
    chainId?: string
  }) {
    this.domainResults = new Map()
    this.options = options
  }

  addDomainResult(result: ExportResult): void {
    this.domainResults.set(result.domain, result)
  }

  async build(): Promise<BackupManifest> {
    const domainStats = this.buildDomainStats()
    const domains = Array.from(this.domainResults.keys())

    // Build manifest object without checksum first
    const manifestWithoutChecksum = {
      version: BACKUP_MANIFEST_VERSION,
      createdAt: new Date().toISOString(),
      appVersion: app.getVersion(),
      platform: process.platform,
      domains,
      domainStats,
      encryption: this.options.encryptionPassword ? await this.buildEncryptionInfo() : undefined,
      incremental: this.options.incremental ? await this.buildIncrementalInfo() : undefined
    }

    // Calculate manifest checksum
    const checksum = await this.calculateManifestChecksum(manifestWithoutChecksum)

    // Return complete manifest
    return {
      ...manifestWithoutChecksum,
      checksum
    }
  }

  private buildDomainStats(): Record<
    string,
    { itemCount: number; rawSize: number; archivedSize: number; checksum: string }
  > {
    const stats: Record<string, { itemCount: number; rawSize: number; archivedSize: number; checksum: string }> = {}

    for (const [domain, result] of this.domainResults) {
      stats[domain] = {
        itemCount: result.itemCount,
        rawSize: result.rawSize,
        archivedSize: result.compressedSize,
        checksum: result.checksum
      }
    }

    return stats
  }

  private async buildEncryptionInfo(): Promise<EncryptionInfo> {
    // Scrypt parameters for key derivation
    const n = 2 ** 17 // 131072 iterations
    const r = 8
    const p = 1

    return {
      algorithm: 'AES-256-GCM',
      kdf: 'scrypt',
      n,
      r,
      p,
      salt: crypto.randomBytes(16).toString('base64'),
      iv: crypto.randomBytes(12).toString('base64'),
      tagLength: 16
    }
  }

  private async buildIncrementalInfo(): Promise<IncrementalManifest | undefined> {
    if (!this.options.chainId) {
      return undefined
    }

    // In a full implementation, this would query database
    // to find the previous backup in the chain
    return {
      chainId: this.options.chainId,
      sequence: 0, // Full backup
      parentChecksum: '',
      changes: [],
      createdAt: new Date().toISOString()
    }
  }

  private async calculateManifestChecksum(manifest: Record<string, unknown>): Promise<string> {
    // Sort keys for consistent hashing
    const sortedManifest = JSON.stringify(manifest, Object.keys(manifest).sort())
    const hash = crypto.createHash('sha256')
    hash.update(sortedManifest)
    return hash.digest('hex')
  }
}
