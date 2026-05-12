/**
 * File API Handlers — read-only DataApi surface.
 *
 * Phase 1b.1 implements all five read endpoints. Mutations are intentionally
 * absent: write operations live on File IPC (FileManager); ref writes are
 * called directly by business services via fileRefService.
 *
 * DataApi boundary rule (CLAUDE.md / docs/references/data/api-design-guidelines.md):
 * pure SQL, no FS IO, no main-side resolvers, no in-memory caches outside the DB.
 */

import { application } from '@application'
import { fileEntryTable, fileRefTable } from '@data/db/schemas/file'
import { fileEntryService } from '@data/services/FileEntryService'
import { fileRefService } from '@data/services/FileRefService'
import { DataApiErrorFactory } from '@shared/data/api'
import type { HandlersFor } from '@shared/data/api/apiTypes'
import type { FileSchemas } from '@shared/data/api/schemas/files'
import { FileEntrySchema, FileRefSchema } from '@shared/data/types/file'
import { and, asc, count, desc, eq, inArray, isNotNull, isNull, type SQL } from 'drizzle-orm'

function getDb() {
  return application.get('DbService').getDb()
}

/** Same SQLite `IN (?, …)` parameter-cap rationale as in FileRefService. */
const SQLITE_INARRAY_CHUNK = 500

export const fileHandlers: HandlersFor<FileSchemas> = {
  '/files/entries': {
    GET: async ({ query }) => {
      const { origin, inTrash, sortBy, sortOrder, page, limit } = query ?? {}
      const conditions: SQL[] = []
      if (origin) {
        conditions.push(eq(fileEntryTable.origin, origin))
      }
      if (inTrash === true) {
        conditions.push(isNotNull(fileEntryTable.trashedAt))
      } else {
        conditions.push(isNull(fileEntryTable.trashedAt))
      }
      const where = and(...conditions)

      const sortColumn = (() => {
        switch (sortBy) {
          case 'name':
            return fileEntryTable.name
          case 'updatedAt':
            return fileEntryTable.updatedAt
          case 'size':
            return fileEntryTable.size
          default:
            return fileEntryTable.createdAt
        }
      })()
      const order = sortOrder === 'desc' ? desc(sortColumn) : asc(sortColumn)

      const pageNum = page ?? 1
      const pageSize = limit ?? 50
      const offset = (pageNum - 1) * pageSize

      const [rows, totalRow] = await Promise.all([
        getDb().select().from(fileEntryTable).where(where).orderBy(order).limit(pageSize).offset(offset),
        getDb().select({ value: count() }).from(fileEntryTable).where(where)
      ])

      return {
        items: rows.map((r) => FileEntrySchema.parse(r)),
        total: totalRow[0]?.value ?? 0,
        page: pageNum
      }
    }
  },

  '/files/entries/:id': {
    GET: async ({ params }) => {
      const entry = await fileEntryService.findById(params.id)
      if (!entry) throw DataApiErrorFactory.notFound('FileEntry', params.id)
      return entry
    }
  },

  '/files/entries/ref-counts': {
    GET: async ({ query }) => {
      const entryIds = query.entryIds
      if (entryIds.length === 0) return []
      const counts = new Map<string, number>()
      // Chunk against SQLite's IN-list parameter cap; renderer batches from
      // long lists (e.g. KnowledgeBase view enumerating thousands of items).
      for (let i = 0; i < entryIds.length; i += SQLITE_INARRAY_CHUNK) {
        const chunk = entryIds.slice(i, i + SQLITE_INARRAY_CHUNK)
        const rows = await getDb()
          .select({
            entryId: fileRefTable.fileEntryId,
            refCount: count()
          })
          .from(fileRefTable)
          .where(inArray(fileRefTable.fileEntryId, chunk))
          .groupBy(fileRefTable.fileEntryId)
        for (const r of rows) counts.set(r.entryId, r.refCount)
      }
      return entryIds.map((id) => ({ entryId: id, refCount: counts.get(id) ?? 0 }))
    }
  },

  '/files/entries/:id/refs': {
    GET: async ({ params }) => {
      const rows = await getDb().select().from(fileRefTable).where(eq(fileRefTable.fileEntryId, params.id))
      return rows.map((r) => FileRefSchema.parse(r))
    }
  },

  '/files/refs/by-source': {
    GET: async ({ query }) => {
      return fileRefService.findBySource({ sourceType: query.sourceType, sourceId: query.sourceId })
    }
  }
}
