import fsp from 'node:fs/promises'
import path from 'node:path'

import { application } from '@application'
import { createClient } from '@libsql/client'
import { loggerService } from '@logger'
import { MESSAGE_FTS_STATEMENTS } from '@main/data/db/schemas/message'
import type { BackupManifest, RestoreOptions, RestoreStatistics } from '@shared/backup'
import { BackupDomain, ConflictStrategy } from '@shared/backup'
import { sql } from 'drizzle-orm'
import StreamZip from 'node-stream-zip'
import { pathToFileURL } from 'url'

import type { CancellationToken } from '../CancellationToken'
import { DomainImporter } from '../domain/DomainImporter'
import { IMPORT_ORDER } from '../domain/DomainRegistry'
import { IdRemapper } from '../domain/IdRemapper'
import { FileRestorer } from '../files/FileRestorer'
import { type BackupProgressTracker, RestorePhase } from '../progress/BackupProgressTracker'
import { hashFile } from '../utils/checksum'

const logger = loggerService.withContext('ImportOrchestrator')

export class ImportOrchestrator {
  constructor(
    private readonly progressTracker: BackupProgressTracker,
    private readonly token: CancellationToken
  ) {}

  async execute(zipPath: string, options: RestoreOptions): Promise<RestoreStatistics> {
    const startTime = Date.now()
    const tempDir = await fsp.mkdtemp(path.join(application.getPath('feature.backup.temp'), 'import-'))

    try {
      this.progressTracker.setPhase(RestorePhase.DECOMPRESSING)
      const zip = new StreamZip.async({ file: zipPath })
      await zip.extract(null, tempDir)
      await zip.close()

      this.progressTracker.setPhase(RestorePhase.VALIDATING)
      const manifest = await this.readManifest(tempDir)
      await this.verifyChecksums(tempDir)

      const backupDbPath = path.join(tempDir, 'backup.sqlite')
      const backupUrl = pathToFileURL(backupDbPath).href
      const backupClient = createClient({ url: backupUrl })

      const liveDb = application.get('DbService').getDb()
      const strategy = options.conflictStrategy ?? ConflictStrategy.SKIP
      const selectedDomains = this.resolveImportDomains(manifest, options)

      this.progressTracker.setPhase(RestorePhase.IMPORTING)

      const remapper = new IdRemapper()
      const domainCounts: Record<string, number> = {}
      let totalSkipped = 0
      let totalErrors = 0

      try {
        if (strategy === ConflictStrategy.RENAME) {
          await remapper.buildMap(backupClient, liveDb, selectedDomains)
        }

        const importer = new DomainImporter(backupClient, liveDb, remapper, this.progressTracker, this.token)

        for (const domain of IMPORT_ORDER) {
          if (!selectedDomains.includes(domain)) continue
          this.token.throwIfCancelled()

          const result = await importer.importDomain(domain, strategy)
          domainCounts[domain] = result.imported
          totalSkipped += result.skipped
          totalErrors += result.errors
        }
      } finally {
        backupClient.close()
      }

      if (selectedDomains.includes(BackupDomain.TOPICS)) {
        this.progressTracker.setPhase(RestorePhase.FTS_REBUILD)
        await this.rebuildFts(liveDb)
      }

      const fileRestorer = new FileRestorer(tempDir, this.progressTracker, this.token)
      let fileCount = 0
      if (options.restoreFiles !== false) {
        const fileResult = await fileRestorer.restoreFiles(strategy)
        fileCount += fileResult.restored
        const kbResult = await fileRestorer.restoreKnowledgeBases(strategy)
        fileCount += kbResult.restored
      }

      this.progressTracker.setPhase(RestorePhase.COMPLETE)

      return {
        duration: Date.now() - startTime,
        domainCounts,
        conflictCount: remapper.getMap().size,
        resolvedCount: remapper.getMap().size,
        skippedCount: totalSkipped,
        fileCount,
        errorCount: totalErrors
      }
    } finally {
      await fsp.rm(tempDir, { recursive: true, force: true }).catch(() => {})
    }
  }

  private async readManifest(tempDir: string): Promise<BackupManifest> {
    const raw = await fsp.readFile(path.join(tempDir, 'manifest.json'), 'utf-8')
    return JSON.parse(raw) as BackupManifest
  }

  private async verifyChecksums(tempDir: string): Promise<void> {
    let checksums: Record<string, string>
    try {
      const raw = await fsp.readFile(path.join(tempDir, 'checksums.json'), 'utf-8')
      checksums = JSON.parse(raw)
    } catch {
      logger.warn('No checksums.json found, skipping verification')
      return
    }

    for (const [filePath, expected] of Object.entries(checksums)) {
      const fullPath = path.join(tempDir, filePath)
      const actual = await hashFile(fullPath)
      if (actual !== expected) {
        throw new Error(`Checksum mismatch for ${filePath}: expected ${expected}, got ${actual}`)
      }
    }
    logger.info('Checksums verified', { count: Object.keys(checksums).length })
  }

  private resolveImportDomains(manifest: BackupManifest, options: RestoreOptions): BackupDomain[] {
    const available = new Set(manifest.domains)
    const selected = options.domains ?? [...available]
    return selected.filter((d) => available.has(d))
  }

  private async rebuildFts(db: { run(query: ReturnType<typeof sql.raw>): Promise<unknown> }): Promise<void> {
    await db.run(sql.raw('DROP TRIGGER IF EXISTS message_ai'))
    await db.run(sql.raw('DROP TRIGGER IF EXISTS message_ad'))
    await db.run(sql.raw('DROP TRIGGER IF EXISTS message_au'))
    await db.run(sql.raw('DROP TABLE IF EXISTS message_fts'))

    for (const stmt of MESSAGE_FTS_STATEMENTS) {
      await db.run(sql.raw(stmt))
    }

    await db.run(sql.raw(`INSERT INTO message_fts(message_fts) VALUES ('rebuild')`))
    logger.info('FTS rebuild complete')
  }
}
