/**
 * Note migrator - scans notes directory and migrates file metadata to SQLite
 *
 * Data sources:
 *   - File system: all .md files under notesRoot
 *   - Redux note slice: starredPaths (to mark starred), notesPath (notes root dir)
 * Target table: note
 */

import { noteTable } from '@data/db/schemas/note'
import { loggerService } from '@logger'
import { getNotesDir } from '@main/utils/file'
import type { ExecuteResult, PrepareResult, ValidateResult } from '@shared/data/migration/v2/types'
import { sql } from 'drizzle-orm'
import fs from 'fs/promises'
import path from 'path'

import type { MigrationContext } from '../core/MigrationContext'
import { BaseMigrator } from './BaseMigrator'

const logger = loggerService.withContext('NoteMigrator')

function toRelativePath(absolutePath: string, notesRoot: string): string {
  return path.relative(notesRoot, absolutePath).split(path.sep).join('/')
}

async function scanMarkdownFiles(dir: string): Promise<string[]> {
  const results: string[] = []

  try {
    const entries = await fs.readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        const subFiles = await scanMarkdownFiles(fullPath)
        results.push(...subFiles)
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
        results.push(fullPath)
      }
    }
  } catch (error) {
    logger.warn(`Failed to read directory: ${dir}`, { error: (error as Error).message })
  }

  return results
}

export class NoteMigrator extends BaseMigrator {
  readonly id = 'note'
  readonly name = 'Notes'
  readonly description = 'Migrate note file metadata and starred status'
  readonly order = 5

  private notesRoot = ''
  private allFiles: string[] = []
  private starredSet: Set<string> = new Set()

  async prepare(ctx: MigrationContext): Promise<PrepareResult> {
    try {
      // Resolve notes root: Redux notesPath > default
      this.notesRoot = ctx.sources.reduxState.get<string>('note', 'notesPath') || getNotesDir()

      // Check if notes directory exists
      try {
        await fs.access(this.notesRoot)
      } catch {
        logger.info('Notes directory does not exist, skipping', { notesRoot: this.notesRoot })
        return { success: true, itemCount: 0 }
      }

      // Scan all .md files
      this.allFiles = await scanMarkdownFiles(this.notesRoot)

      // Build starred set from Redux for quick lookup
      const rawPaths = ctx.sources.reduxState.get<string[]>('note', 'starredPaths')
      if (rawPaths && Array.isArray(rawPaths)) {
        for (const p of rawPaths) {
          if (typeof p === 'string' && p.trim()) {
            this.starredSet.add(p)
          }
        }
      }

      logger.info('Prepare completed', {
        notesRoot: this.notesRoot,
        totalFiles: this.allFiles.length,
        starredCount: this.starredSet.size
      })

      return {
        success: true,
        itemCount: this.allFiles.length
      }
    } catch (error) {
      logger.error('Preparation failed', error as Error)
      return {
        success: false,
        itemCount: 0,
        warnings: [error instanceof Error ? error.message : String(error)]
      }
    }
  }

  async execute(ctx: MigrationContext): Promise<ExecuteResult> {
    if (this.allFiles.length === 0) {
      return { success: true, processedCount: 0 }
    }

    try {
      const db = ctx.db
      const timestamp = Date.now()
      const BATCH_SIZE = 100
      let processed = 0

      await db.transaction(async (tx) => {
        for (let i = 0; i < this.allFiles.length; i += BATCH_SIZE) {
          const batch = this.allFiles.slice(i, i + BATCH_SIZE)
          await tx.insert(noteTable).values(
            batch.map((filePath) => ({
              relativePath: toRelativePath(filePath, this.notesRoot),
              isStarred: this.starredSet.has(filePath),
              createdAt: timestamp,
              updatedAt: timestamp
            }))
          )

          processed += batch.length
          const progress = Math.round((processed / this.allFiles.length) * 100)
          this.reportProgress(progress, `Migrated ${processed}/${this.allFiles.length} notes`, {
            key: 'migration.progress.migrated_notes',
            params: { processed, total: this.allFiles.length }
          })
        }
      })

      logger.info('Execute completed', { processedCount: processed })

      return {
        success: true,
        processedCount: processed
      }
    } catch (error) {
      logger.error('Execute failed', error as Error)
      return {
        success: false,
        processedCount: 0,
        error: error instanceof Error ? error.message : String(error)
      }
    }
  }

  async validate(ctx: MigrationContext): Promise<ValidateResult> {
    try {
      const db = ctx.db

      const result = await db.select({ count: sql<number>`count(*)` }).from(noteTable).get()

      const targetCount = result?.count ?? 0

      return {
        success: true,
        errors: [],
        stats: {
          sourceCount: this.allFiles.length,
          targetCount,
          skippedCount: 0
        }
      }
    } catch (error) {
      logger.error('Validation failed', error as Error)
      return {
        success: false,
        errors: [{ key: 'validation', message: error instanceof Error ? error.message : String(error) }],
        stats: {
          sourceCount: this.allFiles.length,
          targetCount: 0,
          skippedCount: 0
        }
      }
    }
  }
}
