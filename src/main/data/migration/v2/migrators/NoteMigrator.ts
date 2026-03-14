/**
 * Note migrator - migrates starred note paths from Redux to SQLite note table
 *
 * Only migrates starred paths from Redux. Other note files are lazily registered
 * by NoteService when the notes directory is first loaded at runtime.
 *
 * Data sources:
 *   - Redux note slice (note.starredPaths, note.notesPath)
 * Target table: note
 */

import { noteTable } from '@data/db/schemas/note'
import { loggerService } from '@logger'
import { getNotesDir } from '@main/utils/file'
import type { ExecuteResult, PrepareResult, ValidateResult } from '@shared/data/migration/v2/types'
import { sql } from 'drizzle-orm'
import path from 'path'

import type { MigrationContext } from '../core/MigrationContext'
import { BaseMigrator } from './BaseMigrator'

const logger = loggerService.withContext('NoteMigrator')

function toRelativePath(absolutePath: string, notesRoot: string): string {
  return path.relative(notesRoot, absolutePath).split(path.sep).join('/')
}

export class NoteMigrator extends BaseMigrator {
  readonly id = 'note'
  readonly name = 'Notes'
  readonly description = 'Migrate starred note paths from Redux'
  readonly order = 5

  private starredPaths: string[] = []
  private notesRoot = ''

  async prepare(ctx: MigrationContext): Promise<PrepareResult> {
    try {
      const rawPaths = ctx.sources.reduxState.get<string[]>('note', 'starredPaths')
      this.notesRoot = ctx.sources.reduxState.get<string>('note', 'notesPath') || getNotesDir()

      if (!rawPaths || !Array.isArray(rawPaths) || rawPaths.length === 0) {
        logger.info('No starred paths found in Redux state')
        return { success: true, itemCount: 0 }
      }

      // Deduplicate and filter valid paths
      this.starredPaths = [...new Set(rawPaths.filter((p) => typeof p === 'string' && p.trim()))]

      logger.info(`Found ${this.starredPaths.length} starred paths to migrate`, { notesRoot: this.notesRoot })

      return {
        success: true,
        itemCount: this.starredPaths.length
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
    if (this.starredPaths.length === 0) {
      return { success: true, processedCount: 0 }
    }

    try {
      const db = ctx.db
      const timestamp = Date.now()
      const BATCH_SIZE = 100
      let processed = 0

      await db.transaction(async (tx) => {
        for (let i = 0; i < this.starredPaths.length; i += BATCH_SIZE) {
          const batch = this.starredPaths.slice(i, i + BATCH_SIZE)
          await tx.insert(noteTable).values(
            batch.map((notePath) => ({
              relativePath: toRelativePath(notePath, this.notesRoot),
              isStarred: true,
              createdAt: timestamp,
              updatedAt: timestamp
            }))
          )

          processed += batch.length
          const progress = Math.round((processed / this.starredPaths.length) * 100)
          this.reportProgress(progress, `Migrated ${processed}/${this.starredPaths.length} starred notes`, {
            key: 'migration.progress.migrated_notes',
            params: { processed, total: this.starredPaths.length }
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
          sourceCount: this.starredPaths.length,
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
          sourceCount: this.starredPaths.length,
          targetCount: 0,
          skippedCount: 0
        }
      }
    }
  }
}
