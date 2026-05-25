import { type NoteInsert, noteTable } from '@data/db/schemas/note'
import { loggerService } from '@logger'
import type { ExecuteResult, PrepareResult, ValidateResult } from '@shared/data/migration/v2/types'
import { eq, sql } from 'drizzle-orm'

import type { MigrationContext } from '../core/MigrationContext'
import { BaseMigrator } from './BaseMigrator'

const logger = loggerService.withContext('NoteMigrator')

interface LegacyNoteState {
  notesPath?: unknown
  starredPaths?: unknown
  expandedPaths?: unknown
}

function normalizePathValue(value: string): string {
  return value.replace(/\\/g, '/')
}

function pathArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    .map((item) => normalizePathValue(item.trim()))
}

export class NoteMigrator extends BaseMigrator {
  readonly id = 'note'
  readonly name = 'Note'
  readonly description = 'Migrate notes starred and expanded state from Redux to SQLite'
  readonly order = 1.1

  private preparedRows: NoteInsert[] = []
  private skippedCount = 0

  override reset(): void {
    this.preparedRows = []
    this.skippedCount = 0
  }

  async prepare(ctx: MigrationContext): Promise<PrepareResult> {
    this.preparedRows = []
    this.skippedCount = 0

    const warnings: string[] = []
    const state = ctx.sources.reduxState.getCategory<LegacyNoteState>('note')

    if (!state) {
      logger.info('No note state found, skipping note migration')
      return { success: true, itemCount: 0 }
    }

    const rootPath = typeof state.notesPath === 'string' ? normalizePathValue(state.notesPath.trim()) : ''
    const starredPaths = pathArray(state.starredPaths)
    const expandedPaths = pathArray(state.expandedPaths)

    if (!rootPath) {
      const skipped = new Set([...starredPaths, ...expandedPaths]).size
      this.skippedCount = skipped
      if (skipped > 0) {
        warnings.push('Skipped note because legacy notesPath is empty')
      }
      return { success: true, itemCount: 0, warnings }
    }

    const rows = new Map<string, NoteInsert>()

    for (const path of starredPaths) {
      rows.set(path, {
        rootPath,
        path,
        isStarred: true,
        isExpanded: false
      })
    }

    for (const path of expandedPaths) {
      const existing = rows.get(path)
      rows.set(path, {
        ...existing,
        rootPath,
        path,
        isStarred: existing?.isStarred ?? false,
        isExpanded: true
      })
    }

    this.preparedRows = [...rows.values()]
    return { success: true, itemCount: this.preparedRows.length, warnings }
  }

  async execute(ctx: MigrationContext): Promise<ExecuteResult> {
    if (this.preparedRows.length === 0) {
      return { success: true, processedCount: 0 }
    }

    try {
      await ctx.db.transaction(async (tx) => {
        for (const row of this.preparedRows) {
          await tx
            .insert(noteTable)
            .values(row)
            .onConflictDoUpdate({
              target: [noteTable.rootPath, noteTable.path],
              set: {
                isStarred: row.isStarred,
                isExpanded: row.isExpanded
              }
            })
        }
      })

      return { success: true, processedCount: this.preparedRows.length }
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
    if (this.preparedRows.length === 0) {
      return {
        success: true,
        errors: [],
        stats: {
          sourceCount: 0,
          targetCount: 0,
          skippedCount: this.skippedCount
        }
      }
    }

    try {
      const rootPath = this.preparedRows[0].rootPath
      const result = await ctx.db
        .select({ count: sql<number>`count(*)` })
        .from(noteTable)
        .where(eq(noteTable.rootPath, rootPath))
        .get()
      const count = result?.count ?? 0
      const errors =
        count >= this.preparedRows.length
          ? []
          : [
              {
                key: 'count_mismatch',
                message: 'Migrated note count is lower than expected'
              }
            ]

      return {
        success: errors.length === 0,
        errors,
        stats: {
          sourceCount: this.preparedRows.length + this.skippedCount,
          targetCount: count,
          skippedCount: this.skippedCount
        }
      }
    } catch (error) {
      logger.error('Validation failed', error as Error)
      return {
        success: false,
        errors: [{ key: 'validation', message: error instanceof Error ? error.message : String(error) }],
        stats: {
          sourceCount: this.preparedRows.length + this.skippedCount,
          targetCount: 0,
          skippedCount: this.skippedCount
        }
      }
    }
  }
}
