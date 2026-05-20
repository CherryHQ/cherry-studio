import { application } from '@application'
import { type NoteMetadataSelect, noteMetadataTable } from '@data/db/schemas/noteMetadata'
import { defaultHandlersFor, withSqliteErrors } from '@data/db/sqliteErrors'
import type {
  DeleteNoteMetadataQuery,
  RewriteNoteMetadataPathDto,
  UpsertNoteMetadataDto
} from '@shared/data/api/schemas/notes'
import type { NoteMetadata } from '@shared/data/types/noteMetadata'
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

function rowToNoteMetadata(row: NoteMetadataSelect): NoteMetadata {
  return {
    id: row.id,
    rootPath: row.rootPath,
    path: row.path,
    nodeType: row.nodeType,
    isStarred: row.isStarred,
    isExpanded: row.isExpanded,
    createdAt: timestampToISO(row.createdAt),
    updatedAt: timestampToISO(row.updatedAt)
  }
}

function pathCondition(path: string, recursive: boolean = false) {
  if (!recursive) {
    return eq(noteMetadataTable.path, path)
  }

  const prefix = `${path}/`
  return sql`(${noteMetadataTable.path} = ${path} OR substr(${noteMetadataTable.path}, 1, ${prefix.length}) = ${prefix})`
}

export class NoteMetadataService {
  private get db() {
    return application.get('DbService').getDb()
  }

  async listByRoot(rootPath: string): Promise<NoteMetadata[]> {
    const normalizedRootPath = normalizePathValue(rootPath)
    const rows = await this.db
      .select()
      .from(noteMetadataTable)
      .where(eq(noteMetadataTable.rootPath, normalizedRootPath))
      .orderBy(asc(noteMetadataTable.path))
    return rows.map(rowToNoteMetadata)
  }

  async upsert(dto: UpsertNoteMetadataDto): Promise<NoteMetadata> {
    const normalized = normalizeDto(dto)

    const updateValues: Partial<Pick<NoteMetadataSelect, 'nodeType' | 'isStarred' | 'isExpanded'>> = {
      nodeType: normalized.nodeType
    }
    if (normalized.isStarred !== undefined) {
      updateValues.isStarred = normalized.isStarred
    }
    if (normalized.isExpanded !== undefined) {
      updateValues.isExpanded = normalized.isExpanded
    }

    const [row] = await withSqliteErrors(
      () =>
        this.db
          .insert(noteMetadataTable)
          .values({
            rootPath: normalized.rootPath,
            path: normalized.path,
            nodeType: normalized.nodeType,
            isStarred: normalized.isStarred ?? false,
            isExpanded: normalized.isExpanded ?? false
          })
          .onConflictDoUpdate({
            target: [noteMetadataTable.rootPath, noteMetadataTable.path],
            set: updateValues
          })
          .returning(),
      defaultHandlersFor('NoteMetadata', `${normalized.rootPath}:${normalized.path}`)
    )

    return rowToNoteMetadata(row)
  }

  async deleteByPath(query: DeleteNoteMetadataQuery): Promise<void> {
    const normalized = normalizeDto(query)
    await this.db
      .delete(noteMetadataTable)
      .where(
        and(
          eq(noteMetadataTable.rootPath, normalized.rootPath),
          pathCondition(normalized.path, normalized.recursive ?? false)
        )
      )
  }

  async rewritePath(dto: RewriteNoteMetadataPathDto): Promise<{ updated: number }> {
    const normalized = normalizeDto(dto)

    return this.db.transaction(async (tx) => {
      const rows = await tx
        .select()
        .from(noteMetadataTable)
        .where(
          and(
            eq(noteMetadataTable.rootPath, normalized.rootPath),
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
        .delete(noteMetadataTable)
        .where(
          and(
            eq(noteMetadataTable.rootPath, normalized.rootPath),
            inArray(noteMetadataTable.path, targetPaths),
            not(inArray(noteMetadataTable.id, sourceIds))
          )
        )

      for (const rewrite of rewrites) {
        await tx.update(noteMetadataTable).set({ path: rewrite.path }).where(eq(noteMetadataTable.id, rewrite.id))
      }

      return { updated: rows.length }
    })
  }
}

export const noteMetadataService = new NoteMetadataService()
