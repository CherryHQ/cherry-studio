/**
 * BackupOrchestrator
 * Main orchestrator for backup operations
 */

import * as fs from 'node:fs'
import * as fsPromises from 'node:fs/promises'
import * as path from 'node:path'

import { loggerService } from '@logger'
import type { BackupDomain } from '@shared/backup'
import type { BackupOptions } from '@shared/backup'
import { IpcChannel } from '@shared/IpcChannel'
import { app } from 'electron'

import { windowService } from '../WindowService'
import { BackupPhase, BackupProgressTracker } from './progress/BackupProgressTracker'
import type { BaseDomainExporter } from './providers/BaseDomainExporter'
import { GroupsExporter } from './providers/GroupsExporter'
import { KnowledgeExporter } from './providers/KnowledgeExporter'
import { TagsExporter } from './providers/TagsExporter'
import { TopicsExporter } from './providers/TopicsExporter'
import { ManifestBuilder } from './utils/ManifestBuilder'

const logger = loggerService.withContext('BackupOrchestrator')

const DOMAIN_EXPORTERS: Record<string, () => BaseDomainExporter> = {
  topics: () => new TopicsExporter(),
  preferences: () => {
    const mod = require('./providers/PreferencesExporter')
    return new mod.PreferencesExporter()
  },
  groups: () => new GroupsExporter(),
  tags: () => new TagsExporter(),
  knowledge: () => new KnowledgeExporter()
}

export class BackupOrchestrator {
  private progressTracker: BackupProgressTracker
  private tempDir: string
  private isCancelled: boolean
  private progressInterval: NodeJS.Timeout | null

  constructor() {
    this.progressTracker = new BackupProgressTracker()
    this.tempDir = path.join(app.getPath('temp'), 'cherry-studio', 'backup', 'export')
    this.isCancelled = false
    this.progressInterval = null
  }

  async export(options: BackupOptions): Promise<string> {
    this.isCancelled = false
    this.progressTracker = new BackupProgressTracker()
    this.setupProgressReporting()

    logger.info('Starting backup export', { domains: options.domains })

    try {
      this.progressTracker.setPhase(BackupPhase.INIT)

      const domains = this.resolveDomains(options.domains)

      await fsPromises.mkdir(this.tempDir, { recursive: true })
      const workDir = await this.createWorkDir()

      const manifestBuilder = new ManifestBuilder({
        encryptionPassword: options.encryptionPassword,
        incremental: options.incremental,
        chainId: options.chainId
      })

      this.progressTracker.setPhase(BackupPhase.EXPORTING)

      for (const domain of domains) {
        if (this.isCancelled) {
          throw new Error('Backup cancelled')
        }

        await this.exportDomain(domain, workDir, manifestBuilder, options)
      }

      this.progressTracker.setPhase(BackupPhase.FINALIZING)
      await this.writeManifest(workDir, manifestBuilder)

      this.progressTracker.setPhase(BackupPhase.COMPRESSING)
      const backupPath = await this.compressBackup(workDir, options)

      await fsPromises.rm(workDir, { recursive: true, force: true })

      this.progressTracker.setPhase(BackupPhase.COMPLETE)

      logger.info('Backup completed successfully', { path: backupPath })

      return backupPath
    } catch (error) {
      logger.error('Backup failed', error as Error)
      throw error
    } finally {
      this.cleanup()
    }
  }

  cancel(): void {
    this.isCancelled = true
    logger.info('Backup cancellation requested')
  }

  private resolveDomains(domains?: string[]): BackupDomain[] {
    if (!domains || domains.length === 0) {
      return Object.keys(DOMAIN_EXPORTERS) as BackupDomain[]
    }

    const resolved: BackupDomain[] = []
    for (const domain of domains) {
      if (domain in DOMAIN_EXPORTERS) {
        resolved.push(domain as BackupDomain)
      } else {
        logger.warn(`Unknown domain requested: ${domain}`)
      }
    }

    return resolved
  }

  private async createWorkDir(): Promise<string> {
    const timestamp = Date.now().toString()
    const workDir = path.join(this.tempDir, `backup-${timestamp}`)
    await fsPromises.mkdir(workDir, { recursive: true })
    return workDir
  }

  private async exportDomain(
    domain: BackupDomain,
    workDir: string,
    manifestBuilder: ManifestBuilder,
    options: BackupOptions
  ): Promise<void> {
    const exporterFactory = DOMAIN_EXPORTERS[domain]
    if (!exporterFactory) {
      logger.warn(`No exporter found for domain: ${domain}`)
      return
    }

    const exporter = exporterFactory()

    const context = {
      baseDir: workDir,
      progress: this.progressTracker,
      options: {
        includeFiles: options.includeFiles ?? false,
        format: 'jsonl' as const
      }
    }

    const result = await exporter.export(context)
    manifestBuilder.addDomainResult(result)
  }

  private async writeManifest(workDir: string, manifestBuilder: ManifestBuilder): Promise<void> {
    const manifest = await manifestBuilder.build()
    const manifestPath = path.join(workDir, 'manifest.json')
    await fsPromises.writeFile(manifestPath, JSON.stringify(manifest, null, 2))
    logger.debug('Manifest written', { path: manifestPath })
  }

  private async compressBackup(workDir: string, options: BackupOptions): Promise<string> {
    const backupDir = path.join(app.getPath('temp'), 'cherry-studio', 'backup')
    await fsPromises.mkdir(backupDir, { recursive: true })

    const timestamp = Date.now().toString()
    const fileName = `cherry-studio-backup-${timestamp}.zip`
    const outputPath = path.join(backupDir, fileName)

    return new Promise((resolve, reject) => {
      ;(async () => {
        const output = fs.createWriteStream(outputPath)

        try {
          const archiver = (await import('archiver')).default

          const archive = archiver('zip', {
            zlib: { level: options.compressionLevel ?? 5 }
          })

          archive.on('data', (chunk: Buffer) => {
            this.progressTracker.updateBytesProcessed(chunk.length)
          })

          archive.on('error', reject)

          archive.on('warning', (err: { code: string; message: string }) => {
            if (err.code !== 'ENOENT') {
              logger.warn('Archive warning', err)
            }
          })

          output.on('close', () => {
            resolve(outputPath)
          })

          archive.pipe(output)

          // Use async readdir and stat
          const files = await fsPromises.readdir(workDir)

          for (const file of files) {
            const filePath = path.join(workDir, file)
            const stat = await fsPromises.stat(filePath)

            if (stat.isDirectory()) {
              archive.directory(filePath, file)
            } else {
              archive.file(filePath, { name: file })
            }
          }

          archive.finalize()
        } catch (error) {
          reject(error)
        }
      })()
    })
  }

  private setupProgressReporting(): void {
    this.progressInterval = setInterval(() => {
      this.sendProgress()
    }, 500)
  }

  private sendProgress(): void {
    const mainWindow = windowService.getMainWindow()
    if (!mainWindow || mainWindow.isDestroyed()) {
      return
    }

    const progress = this.progressTracker.getBackupProgress()
    mainWindow.webContents.send(IpcChannel.BackupV2_GetBackupProgress, progress)
  }

  private cleanup(): void {
    if (this.progressInterval) {
      clearInterval(this.progressInterval)
      this.progressInterval = null
    }
  }
}
