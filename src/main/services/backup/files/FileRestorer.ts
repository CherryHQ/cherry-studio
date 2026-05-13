import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'

import { application } from '@application'
import { loggerService } from '@logger'
import { ConflictStrategy } from '@shared/backup'

import type { CancellationToken } from '../CancellationToken'
import type { BackupProgressTracker } from '../progress/BackupProgressTracker'

const logger = loggerService.withContext('FileRestorer')

export class FileRestorer {
  constructor(
    private readonly extractDir: string,
    private readonly progressTracker: BackupProgressTracker,
    private readonly token: CancellationToken
  ) {}

  async restoreFiles(strategy: ConflictStrategy): Promise<{ restored: number; skipped: number }> {
    const sourceDir = path.join(this.extractDir, 'files')
    if (!fs.existsSync(sourceDir)) return { restored: 0, skipped: 0 }

    const targetDir = application.getPath('feature.files.data')
    await fsp.mkdir(targetDir, { recursive: true })

    let restored = 0
    let skipped = 0
    const entries = await fsp.readdir(sourceDir, { withFileTypes: true })

    for (const entry of entries) {
      this.token.throwIfCancelled()
      const sourcePath = path.join(sourceDir, entry.name)
      const targetPath = path.join(targetDir, entry.name)

      if (fs.existsSync(targetPath)) {
        if (strategy === ConflictStrategy.SKIP) {
          skipped++
          continue
        }
      }

      if (entry.isDirectory()) {
        await fsp.cp(sourcePath, targetPath, { recursive: true })
      } else {
        await fsp.copyFile(sourcePath, targetPath)
      }
      restored++
      this.progressTracker.incrementItemsProcessed(1)
    }

    logger.info('File restore complete', { restored, skipped })
    return { restored, skipped }
  }

  async restoreKnowledgeBases(strategy: ConflictStrategy): Promise<{ restored: number; skipped: number }> {
    const sourceDir = path.join(this.extractDir, 'knowledge')
    if (!fs.existsSync(sourceDir)) return { restored: 0, skipped: 0 }

    const targetDir = application.getPath('feature.knowledgebase.data')
    await fsp.mkdir(targetDir, { recursive: true })

    let restored = 0
    let skipped = 0
    const entries = await fsp.readdir(sourceDir, { withFileTypes: true })

    for (const entry of entries) {
      this.token.throwIfCancelled()
      if (!entry.isDirectory()) continue

      const sourcePath = path.join(sourceDir, entry.name)
      const targetPath = path.join(targetDir, entry.name)

      if (fs.existsSync(targetPath)) {
        if (strategy === ConflictStrategy.SKIP) {
          skipped++
          continue
        }
      }

      await fsp.cp(sourcePath, targetPath, { recursive: true })
      restored++
      this.progressTracker.incrementItemsProcessed(1)
    }

    logger.info('Knowledge base restore complete', { restored, skipped })
    return { restored, skipped }
  }
}
