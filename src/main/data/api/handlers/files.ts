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
 * services (`FileEntryService`, `FileRefService`).
 */

import { fileEntryService } from '@data/services/FileEntryService'
import { fileRefService } from '@data/services/FileRefService'
import { DataApiErrorFactory } from '@shared/data/api'
import type { HandlersFor } from '@shared/data/api/apiTypes'
import type { FileSchemas } from '@shared/data/api/schemas/files'

export const fileHandlers: HandlersFor<FileSchemas> = {
  '/files/entries': {
    GET: async ({ query }) => {
      return fileEntryService.listPaged(query ?? {})
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
      const counts = await fileRefService.countByEntryIds(query.entryIds)
      return query.entryIds.map((id) => ({ entryId: id, refCount: counts.get(id) ?? 0 }))
    }
  },

  '/files/entries/:id/refs': {
    GET: async ({ params }) => {
      return fileRefService.findByEntryId(params.id)
    }
  },

  '/files/refs/by-source': {
    GET: async ({ query }) => {
      return fileRefService.findBySource({ sourceType: query.sourceType, sourceId: query.sourceId })
    }
  }
}
