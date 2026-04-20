/**
 * File API Handlers (Placeholder)
 *
 * Stub handlers for Phase 1a — will be implemented in Phase 1b.
 * All endpoints throw NOT_IMPLEMENTED to satisfy ApiSchemas type requirements.
 *
 * Note: Only read endpoints are exposed via DataApi. Write operations
 * (create, rename, trash, permanentDelete, etc.) are handled by FileManager IPC.
 * Ref write operations are called directly by business services via fileRefService.
 */

import type { ApiHandler, ApiMethods } from '@shared/data/api/apiTypes'
import type { FileSchemas } from '@shared/data/api/schemas/files'

type FileHandler<Path extends keyof FileSchemas, Method extends ApiMethods<Path>> = ApiHandler<Path, Method>

const notImplemented =
  (endpoint: string): (() => never) =>
  (): never => {
    throw new Error(`Not implemented: ${endpoint} — will be added in Phase 1b`)
  }

export const fileHandlers: {
  [Path in keyof FileSchemas]: {
    [Method in keyof FileSchemas[Path]]: FileHandler<Path, Method & ApiMethods<Path>>
  }
} = {
  '/files/entries': {
    GET: notImplemented('GET /files/entries')
  },
  '/files/entries/:id': {
    GET: notImplemented('GET /files/entries/:id')
  },
  '/files/entries/:id/refs': {
    GET: notImplemented('GET /files/entries/:id/refs')
  },
  '/files/refs/by-source': {
    GET: notImplemented('GET /files/refs/by-source')
  }
}
