import { application } from '@application'
import { type NoteSelect, noteTable } from '@data/db/schemas/note'
import { defaultHandlersFor, withSqliteErrors } from '@data/db/sqliteErrors'
import { DataApiErrorFactory } from '@shared/data/api'
import type { DeleteNoteQuery, RewriteNotePathDto, UpsertNoteDto } from '@shared/data/api/schemas/notes'
import type { Note } from '@shared/data/types/note'
import { and, asc, eq, inArray, not, sql } from 'drizzle-orm'

import { timestampToISO } from './utils/rowMappers'

function normalizePathValue(value: string): string {
  return value.replace(/\\/g, '/')
}

function normalizeDto<T extends { rootPath: string; path?: string; fromPath?: string; toPath?: string }>(dto: T): T {
  return {
    ...dto,
    rootPath: normalizePathValue(dto.rootPath),
    path: dto.path ? normalizePathValue(dto.path) : dto.path,
    fromPath: dto.fromPath ? normalizePathValue(dto.fromPath) : dto.fromPath,
    toPath: dto.toPath ? normalizePathValue(dto.toPath) : dto.toPath
  }
}

function rowToNote(row: NoteSelect): Note {
  return {
    id: row.id,
    rootPath: row.rootPath,
    path: row.path,
    isStarred: row.isStarred,
    isExpanded: row.isExpanded,
    createdAt: timestampToISO(row.createdAt),
    updatedAt: timestampToISO(row.updatedAt)
  }
}

function pathCondition(path: string, recursive: boolean = false) {
  if (!recursive) {
    return eq(noteTable.path, path)
  }

  const prefix = `${path}/`
  return sql`(${noteTable.path} = ${path} OR substr(${noteTable.path}, 1, ${prefix.length}) = ${prefix})`
}

export class NoteService {
  private get db() {
    return application.get('DbService').getDb()
  }

  async listByRoot(rootPath: string): Promise<Note[]> {
    const normalizedRootPath = normalizePathValue(rootPath)
    const rows = await this.db
      .select()
      .from(noteTable)
      .where(eq(noteTable.rootPath, normalizedRootPath))
      .orderBy(asc(noteTable.path))
    return rows.map(rowToNote)
  }

  async upsert(dto: UpsertNoteDto): Promise<Note | null> {
    const normalized = normalizeDto(dto)

    const updateValues: Partial<Pick<NoteSelect, 'isStarred' | 'isExpanded'>> = {}
    if (normalized.isStarred !== undefined) {
      updateValues.isStarred = normalized.isStarred
    }
    if (normalized.isExpanded !== undefined) {
      updateValues.isExpanded = normalized.isExpanded
    }
    if (Object.keys(updateValues).length === 0) {
      throw DataApiErrorFactory.validation({
        note: ['At least one note field is required']
      })
    }

    const row = await withSqliteErrors(
      () =>
        this.db.transaction(async (tx) => {
          const [upserted] = await tx
            .insert(noteTable)
            .values({
              rootPath: normalized.rootPath,
              path: normalized.path,
              isStarred: normalized.isStarred ?? false,
              isExpanded: normalized.isExpanded ?? false
            })
            .onConflictDoUpdate({
              target: [noteTable.rootPath, noteTable.path],
              set: updateValues
            })
            .returning()

          if (!upserted.isStarred && !upserted.isExpanded) {
            await tx.delete(noteTable).where(eq(noteTable.id, upserted.id))
            return null
          }

          return upserted
        }),
      defaultHandlersFor('Note', `${normalized.rootPath}:${normalized.path}`)
    )

    return row ? rowToNote(row) : null
  }

  async deleteByPath(query: DeleteNoteQuery): Promise<void> {
    const normalized = normalizeDto(query)
    await withSqliteErrors(
      () =>
        this.db
          .delete(noteTable)
          .where(
            and(
              eq(noteTable.rootPath, normalized.rootPath),
              pathCondition(normalized.path, normalized.recursive ?? false)
            )
          ),
      defaultHandlersFor('Note', `${normalized.rootPath}:${normalized.path}`)
    )
  }

  async rewritePath(dto: RewriteNotePathDto): Promise<{ updated: number }> {
    const normalized = normalizeDto(dto)

    return withSqliteErrors(
      () =>
        this.db.transaction(async (tx) => {
          const rows = await tx
            .select()
            .from(noteTable)
            .where(
              and(
                eq(noteTable.rootPath, normalized.rootPath),
                pathCondition(normalized.fromPath, normalized.recursive ?? false)
              )
            )

          if (rows.length === 0) {
            return { updated: 0 }
          }

          const rewrites = rows.map((row) => ({
            id: row.id,
            path:
              row.path === normalized.fromPath
                ? normalized.toPath
                : `${normalized.toPath}${row.path.slice(normalized.fromPath.length)}`
          }))
          const sourceIds = rewrites.map((rewrite) => rewrite.id)
          const targetPaths = [...new Set(rewrites.map((rewrite) => rewrite.path))]

          await tx
            .delete(noteTable)
            .where(
              and(
                eq(noteTable.rootPath, normalized.rootPath),
                inArray(noteTable.path, targetPaths),
                not(inArray(noteTable.id, sourceIds))
              )
            )

          for (const rewrite of rewrites) {
            await tx.update(noteTable).set({ path: rewrite.path }).where(eq(noteTable.id, rewrite.id))
          }

          return { updated: rows.length }
        }),
      defaultHandlersFor('Note', `${normalized.rootPath}:${normalized.fromPath}`)
    )
  }
}

export const noteService = new NoteService()
