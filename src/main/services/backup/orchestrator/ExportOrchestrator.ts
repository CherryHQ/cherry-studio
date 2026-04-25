import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { application } from '@application'
import { createClient } from '@libsql/client'
import { loggerService } from '@logger'
import type { BackupManifest, BackupOptions, BackupStatistics, DomainStats } from '@shared/backup'
import { BACKUP_MANIFEST_VERSION, BackupDomain } from '@shared/backup'
import archiver from 'archiver'
import { sql } from 'drizzle-orm'
import { app } from 'electron'
import { pathToFileURL } from 'url'

import type { CancellationToken } from '../CancellationToken'
import { DOMAIN_TABLE_MAP } from '../domain/DomainRegistry'
import { stripUnselectedDomains } from '../domain/DomainStripper'
import { collectReferencedFiles } from '../files/FileCollector'
import { filterPreferences } from '../filters/PreferenceFilter'
import { BackupPhase, type BackupProgressTracker } from '../progress/BackupProgressTracker'
import { hashFile } from '../utils/checksum'

const logger = loggerService.withContext('ExportOrchestrator')

export class ExportOrchestrator {
  constructor(
    private readonly progressTracker: BackupProgressTracker,
    private readonly token: CancellationToken
  ) {}

  async execute(outputPath: string, options: BackupOptions): Promise<BackupStatistics> {
    const startTime = Date.now()
    const tempDir = await fsp.mkdtemp(path.join(application.getPath('feature.backup.temp'), 'export-'))

    try {
      this.progressTracker.setPhase(BackupPhase.VACUUM)
      const backupDbPath = path.join(tempDir, 'backup.sqlite')
      await this.vacuumInto(backupDbPath)

      this.token.throwIfCancelled()
      await stripUnselectedDomains(backupDbPath, options.domains, this.token)

      const backupUrl = pathToFileURL(backupDbPath).href
      const backupClient = createClient({ url: backupUrl })
      let domainStats: Record<string, DomainStats>
      try {
        if (options.domains.includes(BackupDomain.PREFERENCES)) {
          await filterPreferences(backupClient, this.token)
        }

        domainStats = await this.collectDomainStats(backupClient, options.domains)
        const totalItems = Object.values(domainStats).reduce((sum, s) => sum + s.itemCount, 0)
        this.progressTracker.setTotals(totalItems, 0n)

        this.progressTracker.setPhase(BackupPhase.FILES)
        await this.collectFiles(backupClient, tempDir, options)
        await this.collectKnowledgeBases(backupClient, tempDir, options)
      } finally {
        backupClient.close()
      }

      this.progressTracker.setPhase(BackupPhase.FINALIZING)
      const checksums = await this.computeChecksums(tempDir)
      const schemaHash = await this.getSchemaHash(backupDbPath)

      const manifest = this.buildManifest(options.domains, domainStats, checksums, schemaHash)
      await fsp.writeFile(path.join(tempDir, 'manifest.json'), JSON.stringify(manifest, null, 2))
      await fsp.writeFile(path.join(tempDir, 'checksums.json'), JSON.stringify(checksums, null, 2))

      this.progressTracker.setPhase(BackupPhase.COMPRESSING)
      const compressedSize = await this.createZip(tempDir, outputPath, options)
      const rawSize = await this.computeRawSize(tempDir)

      this.progressTracker.setPhase(BackupPhase.COMPLETE)

      return {
        duration: Date.now() - startTime,
        rawSize,
        compressedSize,
        compressionRatio: rawSize > 0 ? compressedSize / rawSize : 1,
        domainCounts: Object.fromEntries(Object.entries(domainStats).map(([k, v]) => [k, v.itemCount])),
        fileCount: checksums ? Object.keys(checksums).length - 1 : 0
      }
    } finally {
      await fsp.rm(tempDir, { recursive: true, force: true }).catch(() => {})
    }
  }

  private async vacuumInto(targetPath: string): Promise<void> {
    const db = application.get('DbService').getDb()
    const escaped = targetPath.replaceAll("'", "''")
    await db.run(sql.raw(`VACUUM INTO '${escaped}'`))
    logger.info('VACUUM INTO complete', { target: targetPath })
  }

  private async collectDomainStats(
    backupClient: ReturnType<typeof createClient>,
    domains: BackupDomain[]
  ): Promise<Record<string, DomainStats>> {
    const stats: Record<string, DomainStats> = {}
    for (const domain of domains) {
      const tables = DOMAIN_TABLE_MAP[domain]
      let itemCount = 0
      for (const table of tables) {
        const result = await backupClient.execute(`SELECT COUNT(*) as cnt FROM "${table}"`)
        itemCount += Number(result.rows[0].cnt)
      }
      stats[domain] = { itemCount, sizeBytes: 0 }
    }
    return stats
  }

  private async collectFiles(
    backupClient: ReturnType<typeof createClient>,
    tempDir: string,
    options: BackupOptions
  ): Promise<void> {
    const filesDir = path.join(tempDir, 'files')
    const sourceDir = application.getPath('feature.files.data')

    if (options.domains.includes(BackupDomain.FILE_STORAGE)) {
      if (fs.existsSync(sourceDir)) {
        await fsp.cp(sourceDir, filesDir, { recursive: true })
        logger.info('Copied all file storage')
      }
      return
    }

    if (options.domains.includes(BackupDomain.TOPICS) && options.includeFiles !== false) {
      const fileIds = await collectReferencedFiles(backupClient, this.token)
      if (fileIds.size > 0 && fs.existsSync(sourceDir)) {
        await fsp.mkdir(filesDir, { recursive: true })
        for (const fileId of fileIds) {
          this.token.throwIfCancelled()
          const sourcePath = path.join(sourceDir, fileId)
          if (fs.existsSync(sourcePath)) {
            await fsp.cp(sourcePath, path.join(filesDir, fileId), { recursive: true })
          }
        }
        logger.info('Copied referenced files', { count: fileIds.size })
      }
    }
  }

  private async collectKnowledgeBases(
    backupClient: ReturnType<typeof createClient>,
    tempDir: string,
    options: BackupOptions
  ): Promise<void> {
    if (!options.domains.includes(BackupDomain.KNOWLEDGE) || options.includeKnowledgeFiles === false) {
      return
    }
    const kbSourceDir = application.getPath('feature.knowledgebase.data')
    if (!fs.existsSync(kbSourceDir)) return

    const result = await backupClient.execute('SELECT id FROM knowledge_base')
    const kbDir = path.join(tempDir, 'knowledge')
    await fsp.mkdir(kbDir, { recursive: true })

    for (const row of result.rows) {
      this.token.throwIfCancelled()
      const baseId = row.id as string
      const sourcePath = path.join(kbSourceDir, baseId)
      if (fs.existsSync(sourcePath)) {
        await fsp.cp(sourcePath, path.join(kbDir, baseId), { recursive: true })
      }
    }
    logger.info('Copied knowledge bases', { count: result.rows.length })
  }

  private async computeChecksums(tempDir: string): Promise<Record<string, string>> {
    const checksums: Record<string, string> = {}
    const dbPath = path.join(tempDir, 'backup.sqlite')
    if (fs.existsSync(dbPath)) {
      checksums['backup.sqlite'] = await hashFile(dbPath)
    }
    await this.hashDirectory(tempDir, 'files', checksums)
    await this.hashDirectory(tempDir, 'knowledge', checksums)
    return checksums
  }

  private async hashDirectory(tempDir: string, subDir: string, checksums: Record<string, string>): Promise<void> {
    const dirPath = path.join(tempDir, subDir)
    if (!fs.existsSync(dirPath)) return
    const entries = await fsp.readdir(dirPath, { recursive: true, withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isFile()) continue
      const parentPath = entry.parentPath ?? (entry as unknown as { path: string }).path ?? dirPath
      const fullPath = path.join(parentPath, entry.name)
      const relativePath = path.relative(tempDir, fullPath)
      checksums[relativePath] = await hashFile(fullPath)
    }
  }

  private async getSchemaHash(backupDbPath: string): Promise<{ hash: string; createdAt: number }> {
    const client = createClient({ url: pathToFileURL(backupDbPath).href })
    try {
      const result = await client.execute(
        'SELECT hash, created_at FROM __drizzle_migrations ORDER BY created_at DESC LIMIT 1'
      )
      if (result.rows.length > 0) {
        return {
          hash: result.rows[0].hash as string,
          createdAt: Number(result.rows[0].created_at)
        }
      }
    } catch {
      logger.warn('Could not read schema hash from backup')
    } finally {
      client.close()
    }
    return { hash: '', createdAt: Date.now() }
  }

  private buildManifest(
    domains: BackupDomain[],
    domainStats: Record<string, DomainStats>,
    checksums: Record<string, string>,
    schemaVersion: { hash: string; createdAt: number }
  ): BackupManifest {
    return {
      version: BACKUP_MANIFEST_VERSION,
      appVersion: app.getVersion(),
      platform: process.platform,
      arch: process.arch,
      createdAt: new Date().toISOString(),
      schemaVersion,
      domains,
      domainStats,
      checksums,
      sourceDevice: {
        hostname: os.hostname(),
        os: `${process.platform} ${os.release()}`
      }
    }
  }

  private async createZip(tempDir: string, outputPath: string, options: BackupOptions): Promise<number> {
    const tmpOutput = `${outputPath}.tmp`
    const level = options.compressionLevel ?? 6

    return new Promise<number>((resolve, reject) => {
      const output = fs.createWriteStream(tmpOutput)
      const archive = archiver('zip', { zlib: { level } })

      output.on('close', async () => {
        try {
          await fsp.rename(tmpOutput, outputPath)
          resolve(archive.pointer())
        } catch (err) {
          reject(err)
        }
      })
      archive.on('error', reject)

      archive.pipe(output)
      archive.directory(tempDir, false)
      void archive.finalize()
    })
  }

  private async computeRawSize(tempDir: string): Promise<number> {
    let total = 0
    const entries = await fsp.readdir(tempDir, { recursive: true, withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isFile()) continue
      const parentPath = entry.parentPath ?? (entry as unknown as { path: string }).path ?? tempDir
      const stat = await fsp.stat(path.join(parentPath, entry.name))
      total += stat.size
    }
    return total
  }
}
