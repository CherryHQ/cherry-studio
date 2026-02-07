/**
 * BaseDomainExporter
 * Abstract base class for domain exporters
 */

import * as fs from 'node:fs/promises'
import * as path from 'node:path'

import { loggerService } from '@logger'
import type { BackupDomain } from '@shared/backup'

import type { BackupProgressTracker } from '../progress/BackupProgressTracker'

const logger = loggerService.withContext('BaseDomainExporter')

export interface ExportResult {
  domain: BackupDomain
  itemCount: number
  rawSize: number
  compressedSize: number
  checksum: string
  dataPath: string
}

export interface ExportContext {
  baseDir: string
  progress: BackupProgressTracker
  options: {
    includeFiles: boolean
    format: 'jsonl' | 'json'
  }
}

export abstract class BaseDomainExporter {
  protected domain: BackupDomain
  protected logger = logger

  constructor(domain: BackupDomain) {
    this.domain = domain
  }

  getDomainName(): string {
    return this.domain
  }

  abstract export(context: ExportContext): Promise<ExportResult>

  validateContext(context: ExportContext): void {
    if (!context.baseDir) {
      throw new Error(`Export context missing baseDir for domain ${this.domain}`)
    }
    if (!context.progress) {
      throw new Error(`Export context missing progress tracker for domain ${this.domain}`)
    }
  }

  async createDomainDir(baseDir: string): Promise<string> {
    const domainDir = path.join(baseDir, this.domain)
    await fs.mkdir(domainDir, { recursive: true })
    return domainDir
  }

  /**
   * Compute checksum for a file
   */
  async computeFileHash(filePath: string): Promise<string> {
    const { createHash } = await import('node:crypto')
    const content = await fs.readFile(filePath)
    const hash = createHash('sha256')
    hash.update(content)
    return hash.digest('hex')
  }
}
