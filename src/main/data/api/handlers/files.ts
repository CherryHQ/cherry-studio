/**
 * File API Handlers — read-only DataApi surface.
 *
 * Phase 1b.1 implements all five read endpoints. Mutations are intentionally
 * absent: write operations live on File IPC (FileManager); ref writes are
 * called directly by business services via fileRefService.
 *
 * DataApi boundary rule (CLAUDE.md / docs/references/data/api-design-guidelines.md):
 * pure SQL, no FS IO, no main-side resolvers, no in-memory caches outside the DB.
 * Handlers are thin per `data-api-in-main.md` — all SQL lives in the owning
 * services (`FileEntryService`, `FileRefService`). Inputs flowing in from the
 * IPC boundary are Zod-parsed here per `fileEntry.ts` JSDoc — the type-level
 * `FileEntryId` brand carries no runtime guarantee on its own.
 */

import { fileEntryService } from '@data/services/FileEntryService'
import { fileRefService } from '@data/services/FileRefService'
import { DataApiErrorFactory } from '@shared/data/api'
import type { HandlersFor } from '@shared/data/api/apiTypes'
import type { FileSchemas } from '@shared/data/api/schemas/files'
import { FileEntryIdSchema, FileRefSourceTypeSchema } from '@shared/data/types/file'
import * as z from 'zod'

const EntryIdsSchema = z.array(FileEntryIdSchema)
const SourceIdSchema = z.string().min(1)

export const fileHandlers: HandlersFor<FileSchemas> = {
  '/files/entries': {
    GET: async ({ query }) => {
      return fileEntryService.listPaged(query ?? {})
    }
  },

  '/files/entries/:id': {
    GET: async ({ params }) => {
      const id = FileEntryIdSchema.parse(params.id)
      const entry = await fileEntryService.findById(id)
      if (!entry) throw DataApiErrorFactory.notFound('FileEntry', id)
      return entry
    }
  },

  '/files/entries/ref-counts': {
    GET: async ({ query }) => {
      const ids = EntryIdsSchema.parse(query.entryIds)
      const counts = await fileRefService.countByEntryIds(ids)
      return ids.map((id) => ({ entryId: id, refCount: counts.get(id) ?? 0 }))
    }
  },

  '/files/entries/:id/refs': {
    GET: async ({ params }) => {
      const id = FileEntryIdSchema.parse(params.id)
      return fileRefService.findByEntryId(id)
    }
  },

  '/files/refs/by-source': {
    GET: async ({ query }) => {
      const sourceType = FileRefSourceTypeSchema.parse(query.sourceType)
      const sourceId = SourceIdSchema.parse(query.sourceId)
      return fileRefService.findBySource({ sourceType, sourceId })
    }
  }
}
