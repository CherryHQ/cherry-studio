import { application } from '@application'
import { type NoteRow, noteTable } from '@data/db/schemas/note'
import { defaultHandlersFor, withSqliteErrors } from '@data/db/sqliteErrors'
import { DataApiErrorFactory } from '@shared/data/api'
import type { DeleteNoteQuery, RewriteNotePathDto, UpsertNoteDto } from '@shared/data/api/schemas/notes'
import type { Note } from '@shared/data/types/note'
import { and, asc, eq, inArray, not, sql } from 'drizzle-orm'

import { timestampToISO } from './utils/rowMappers'

function rowToNote(row: NoteRow): Note {
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
  return sql`(${noteTable.path} = ${path} OR substr(${noteTable.path}, 1, length(${prefix})) = ${prefix})`
}

export class NoteService {
  private get dbService() {
    return application.get('DbService')
  }

  private get db() {
    return this.dbService.getDb()
  }

  async listByRoot(rootPath: string): Promise<Note[]> {
    const rows = await this.db
      .select()
      .from(noteTable)
      .where(eq(noteTable.rootPath, rootPath))
      .orderBy(asc(noteTable.path))
    return rows.map(rowToNote)
  }

  async upsert(dto: UpsertNoteDto): Promise<Note | null> {
    const updateValues: Partial<Pick<NoteRow, 'isStarred' | 'isExpanded'>> = {}
    if (dto.isStarred !== undefined) {
      updateValues.isStarred = dto.isStarred
    }
    if (dto.isExpanded !== undefined) {
      updateValues.isExpanded = dto.isExpanded
    }
    if (Object.keys(updateValues).length === 0) {
      throw DataApiErrorFactory.validation({
        note: ['At least one note field is required']
      })
    }
    if (dto.isStarred === false && dto.isExpanded === false) {
      // `null` means the row no longer exists; deleting an already-absent row is still a successful patch.
      await this.deleteByPath({ rootPath: dto.rootPath, path: dto.path })
      return null
    }

    const row = await withSqliteErrors(
      () =>
        this.dbService.withWriteTx(async (tx) => {
          const [existing] = await tx
            .select()
            .from(noteTable)
            .where(and(eq(noteTable.rootPath, dto.rootPath), eq(noteTable.path, dto.path)))
            .limit(1)

          const nextIsStarred = dto.isStarred ?? existing?.isStarred ?? false
          const nextIsExpanded = dto.isExpanded ?? existing?.isExpanded ?? false

          if (!nextIsStarred && !nextIsExpanded) {
            if (existing) {
              await tx.delete(noteTable).where(eq(noteTable.id, existing.id))
            }
            return null
          }

          if (existing) {
            const [updated] = await tx
              .update(noteTable)
              .set(updateValues)
              .where(eq(noteTable.id, existing.id))
              .returning()
            return updated
          }

          const [inserted] = await tx
            .insert(noteTable)
            .values({
              rootPath: dto.rootPath,
              path: dto.path,
              isStarred: nextIsStarred,
              isExpanded: nextIsExpanded
            })
            .returning()

          return inserted
        }),
      defaultHandlersFor('Note', `${dto.rootPath}:${dto.path}`)
    )

    return row ? rowToNote(row) : null
  }

  async deleteByPath(query: DeleteNoteQuery): Promise<void> {
    await withSqliteErrors(
      () =>
        this.dbService.withWriteTx((tx) =>
          tx
            .delete(noteTable)
            .where(and(eq(noteTable.rootPath, query.rootPath), pathCondition(query.path, query.recursive ?? false)))
        ),
      defaultHandlersFor('Note', `${query.rootPath}:${query.path}`)
    )
  }

  async rewritePath(dto: RewriteNotePathDto): Promise<{ updated: number }> {
    return withSqliteErrors(
      () =>
        this.dbService.withWriteTx(async (tx) => {
          const rows = await tx
            .select()
            .from(noteTable)
            .where(and(eq(noteTable.rootPath, dto.rootPath), pathCondition(dto.fromPath, dto.recursive ?? false)))

          if (rows.length === 0) {
            return { updated: 0 }
          }

          const rewrites = rows.map((row) => ({
            id: row.id,
            path: row.path === dto.fromPath ? dto.toPath : `${dto.toPath}${row.path.slice(dto.fromPath.length)}`
          }))
          const sourceIds = rewrites.map((rewrite) => rewrite.id)
          const targetPaths = [...new Set(rewrites.map((rewrite) => rewrite.path))]

          // Destination rows can pre-exist for ordinary renames or retry recovery; remove them before the
          // CASE update so the unique (root_path, path) index does not reject the move.
          await tx
            .delete(noteTable)
            .where(
              and(
                eq(noteTable.rootPath, dto.rootPath),
                inArray(noteTable.path, targetPaths),
                not(inArray(noteTable.id, sourceIds))
              )
            )

          const pathCase = sql<string>`CASE ${noteTable.id} ${sql.join(
            rewrites.map((rewrite) => sql`WHEN ${rewrite.id} THEN ${rewrite.path}`),
            sql` `
          )} ELSE ${noteTable.path} END`

          await tx.update(noteTable).set({ path: pathCase }).where(inArray(noteTable.id, sourceIds))

          return { updated: rows.length }
        }),
      defaultHandlersFor('Note', `${dto.rootPath}:${dto.fromPath}`)
    )
  }
}

export const noteService = new NoteService()
