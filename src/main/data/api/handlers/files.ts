/**
 * File API Handlers (Placeholder)
 *
 * Stub handlers for Phase 1 — will be implemented in Phase 2.
 * All endpoints throw NOT_IMPLEMENTED to satisfy ApiSchemas type requirements.
 */

import type { ApiHandler, ApiMethods } from '@shared/data/api/apiTypes'
import type { FileSchemas } from '@shared/data/api/schemas/files'

type FileHandler<Path extends keyof FileSchemas, Method extends ApiMethods<Path>> = ApiHandler<Path, Method>

const notImplemented =
  (endpoint: string): (() => never) =>
  (): never => {
    throw new Error(`Not implemented: ${endpoint} — will be added in Phase 2`)
  }

export const fileHandlers: {
  [Path in keyof FileSchemas]: {
    [Method in keyof FileSchemas[Path]]: FileHandler<Path, Method & ApiMethods<Path>>
  }
} = {
  '/files/nodes': {
    GET: notImplemented('GET /files/nodes'),
    POST: notImplemented('POST /files/nodes')
  },
  '/files/nodes/:id': {
    GET: notImplemented('GET /files/nodes/:id'),
    PATCH: notImplemented('PATCH /files/nodes/:id'),
    DELETE: notImplemented('DELETE /files/nodes/:id')
  },
  '/files/nodes/:id/children': {
    GET: notImplemented('GET /files/nodes/:id/children')
  },
  '/files/nodes/:id/move': {
    PUT: notImplemented('PUT /files/nodes/:id/move')
  },
  '/files/nodes/:id/trash': {
    PUT: notImplemented('PUT /files/nodes/:id/trash')
  },
  '/files/nodes/:id/restore': {
    PUT: notImplemented('PUT /files/nodes/:id/restore')
  },
  '/files/nodes/:id/refs': {
    GET: notImplemented('GET /files/nodes/:id/refs'),
    POST: notImplemented('POST /files/nodes/:id/refs')
  },
  '/files/refs/by-source': {
    GET: notImplemented('GET /files/refs/by-source'),
    DELETE: notImplemented('DELETE /files/refs/by-source')
  },
  '/files/batch/nodes/trash': {
    PUT: notImplemented('PUT /files/batch/nodes/trash')
  },
  '/files/batch/nodes/move': {
    PUT: notImplemented('PUT /files/batch/nodes/move')
  },
  '/files/batch/nodes/delete': {
    POST: notImplemented('POST /files/batch/nodes/delete')
  },
  '/files/mounts': {
    GET: notImplemented('GET /files/mounts')
  }
}
