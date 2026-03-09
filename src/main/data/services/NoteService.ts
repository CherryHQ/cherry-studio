/**
 * Note Service - manages note file metadata
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
    path: row.path,
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

  async getByPath(path: string): Promise<Note> {
    if (!path?.trim()) {
      throw DataApiErrorFactory.validation({ path: ['Path is required'] })
    }

    const db = dbService.getDb()
    const [existing] = await db.select().from(noteTable).where(eq(noteTable.path, path)).limit(1)

    if (existing) {
      return rowToNote(existing)
    }

    // Auto-create metadata entry if not exists
    const [row] = await db.insert(noteTable).values({ path }).returning()
    return rowToNote(row)
  }

  async update(path: string, dto: UpdateNoteDto): Promise<Note> {
    if (!path?.trim()) {
      throw DataApiErrorFactory.validation({ path: ['Path is required'] })
    }

    const db = dbService.getDb()

    // Upsert: create if not exists, then update
    const [existing] = await db.select().from(noteTable).where(eq(noteTable.path, path)).limit(1)
    if (!existing) {
      const [row] = await db
        .insert(noteTable)
        .values({ path, ...dto })
        .returning()
      logger.info('Created note metadata', { path })
      return rowToNote(row)
    }

    const [row] = await db.update(noteTable).set(dto).where(eq(noteTable.path, path)).returning()
    logger.info('Updated note metadata', { path, changes: Object.keys(dto) })
    return rowToNote(row)
  }

  async delete(path: string): Promise<void> {
    const db = dbService.getDb()
    await db.delete(noteTable).where(eq(noteTable.path, path))
    logger.info('Deleted note metadata', { path })
  }
}

export const noteService = NoteService.getInstance()
