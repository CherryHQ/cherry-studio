/**
 * Note Service - manages note file metadata
 */

import { dbService } from '@data/db/DbService'
import { noteTable } from '@data/db/schemas/note'
import { preferenceService } from '@data/PreferenceService'
import { loggerService } from '@logger'
import { DataApiErrorFactory } from '@shared/data/api'
import type { Note, UpdateNoteDto } from '@shared/data/api/schemas/notes'
import { eq } from 'drizzle-orm'
import path from 'path'

const logger = loggerService.withContext('DataApi:NoteService')

function rowToNote(row: typeof noteTable.$inferSelect): Note {
  return {
    id: row.id,
    path: row.path,
    relativePath: row.relativePath,
    isStarred: row.isStarred,
    createdAt: row.createdAt ? new Date(row.createdAt).toISOString() : new Date().toISOString(),
    updatedAt: row.updatedAt ? new Date(row.updatedAt).toISOString() : new Date().toISOString()
  }
}

/**
 * Compute relative path from absolute path and notes root.
 * Normalizes separators to forward slashes for cross-platform compatibility.
 */
function toRelativePath(absolutePath: string, notesRoot: string): string {
  return path.relative(notesRoot, absolutePath).split(path.sep).join('/')
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

  private getNotesRoot(): string {
    return preferenceService.get('feature.notes.path')
  }

  async list(): Promise<Note[]> {
    const db = dbService.getDb()
    const rows = await db.select().from(noteTable)
    return rows.map(rowToNote)
  }

  async getByPath(notePath: string): Promise<Note> {
    if (!notePath?.trim()) {
      throw DataApiErrorFactory.validation({ path: ['Path is required'] })
    }

    const db = dbService.getDb()
    const [existing] = await db.select().from(noteTable).where(eq(noteTable.path, notePath)).limit(1)

    if (existing) {
      return rowToNote(existing)
    }

    const relativePath = toRelativePath(notePath, this.getNotesRoot())
    const [row] = await db.insert(noteTable).values({ path: notePath, relativePath }).returning()
    return rowToNote(row)
  }

  async update(notePath: string, dto: UpdateNoteDto): Promise<Note> {
    if (!notePath?.trim()) {
      throw DataApiErrorFactory.validation({ path: ['Path is required'] })
    }

    const db = dbService.getDb()

    const [existing] = await db.select().from(noteTable).where(eq(noteTable.path, notePath)).limit(1)
    if (!existing) {
      const relativePath = toRelativePath(notePath, this.getNotesRoot())
      const [row] = await db
        .insert(noteTable)
        .values({ path: notePath, relativePath, ...dto })
        .returning()
      logger.info('Created note metadata', { path: notePath })
      return rowToNote(row)
    }

    const [row] = await db.update(noteTable).set(dto).where(eq(noteTable.path, notePath)).returning()
    logger.info('Updated note metadata', { path: notePath, changes: Object.keys(dto) })
    return rowToNote(row)
  }

  async delete(notePath: string): Promise<void> {
    const db = dbService.getDb()
    await db.delete(noteTable).where(eq(noteTable.path, notePath))
    logger.info('Deleted note metadata', { path: notePath })
  }
}

export const noteService = NoteService.getInstance()
