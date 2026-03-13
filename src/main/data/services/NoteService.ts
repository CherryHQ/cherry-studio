/**
 * Note Service - manages note file metadata
 *
 * All operations use relativePath (relative to notesRoot preference).
 * Absolute path = notesRoot + relativePath, computed at runtime.
 *
 * TODO: Add syncDirectory(notesRoot) method for lazy registration.
 * When the notes directory is first loaded at runtime, scan all .md files
 * and create `note` rows for files not already in the table.
 * Migration only handles starred paths from Redux; all other files need
 * lazy-register here. This is renderer-layer integration work (v2-renderer).
 */

import { dbService } from '@data/db/DbService'
import { noteTable } from '@data/db/schemas/note'
import { loggerService } from '@logger'
import { DataApiErrorFactory } from '@shared/data/api'
import type { Note, UpdateNoteDto } from '@shared/data/api/schemas/notes'
import { eq } from 'drizzle-orm'

const logger = loggerService.withContext('DataApi:NoteService')

function rowToNote(row: typeof noteTable.$inferSelect): Note {
  return {
    id: row.id,
    relativePath: row.relativePath,
    isStarred: row.isStarred,
    createdAt: row.createdAt ? new Date(row.createdAt).toISOString() : new Date().toISOString(),
    updatedAt: row.updatedAt ? new Date(row.updatedAt).toISOString() : new Date().toISOString()
  }
}

export class NoteService {
  private static instance: NoteService

  private constructor() {}

  static getInstance(): NoteService {
    if (!NoteService.instance) {
      NoteService.instance = new NoteService()
    }
    return NoteService.instance
  }

  async list(): Promise<Note[]> {
    const db = dbService.getDb()
    const rows = await db.select().from(noteTable)
    return rows.map(rowToNote)
  }

  async getByRelativePath(relativePath: string): Promise<Note> {
    if (!relativePath?.trim()) {
      throw DataApiErrorFactory.validation({ relativePath: ['relativePath is required'] })
    }

    const db = dbService.getDb()
    const [existing] = await db.select().from(noteTable).where(eq(noteTable.relativePath, relativePath)).limit(1)

    if (existing) {
      return rowToNote(existing)
    }

    const [row] = await db.insert(noteTable).values({ relativePath }).returning()
    return rowToNote(row)
  }

  async update(relativePath: string, dto: UpdateNoteDto): Promise<Note> {
    if (!relativePath?.trim()) {
      throw DataApiErrorFactory.validation({ relativePath: ['relativePath is required'] })
    }

    const db = dbService.getDb()

    const [existing] = await db.select().from(noteTable).where(eq(noteTable.relativePath, relativePath)).limit(1)

    if (!existing) {
      const [row] = await db
        .insert(noteTable)
        .values({ relativePath, ...dto })
        .returning()
      logger.info('Created note metadata', { relativePath })
      return rowToNote(row)
    }

    const [row] = await db.update(noteTable).set(dto).where(eq(noteTable.relativePath, relativePath)).returning()
    logger.info('Updated note metadata', { relativePath, changes: Object.keys(dto) })
    return rowToNote(row)
  }

  async delete(relativePath: string): Promise<void> {
    const db = dbService.getDb()
    await db.delete(noteTable).where(eq(noteTable.relativePath, relativePath))
    logger.info('Deleted note metadata', { relativePath })
  }
}

export const noteService = NoteService.getInstance()
