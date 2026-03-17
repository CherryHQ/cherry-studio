/**
 * File API Handlers (Placeholder)
 *
 * Stub handlers for Phase 1 — will be implemented in Phase 2.
 * All endpoints throw NOT_IMPLEMENTED to satisfy ApiSchemas type requirements.
 */

import type { ApiHandler, ApiMethods } from '@shared/data/api/apiTypes'
import type { FileSchemas } from '@shared/data/api/schemas/files'

type FileHandler<Path extends keyof FileSchemas, Method extends ApiMethods<Path>> = ApiHandler<Path, Method>

const notImplemented = (): never => {
  throw new Error('Not implemented: file handlers will be added in Phase 2')
}

export const fileHandlers: {
  [Path in keyof FileSchemas]: {
    [Method in keyof FileSchemas[Path]]: FileHandler<Path, Method & ApiMethods<Path>>
  }
} = {
  '/files/nodes': {
    GET: notImplemented,
    POST: notImplemented
  },
  '/files/nodes/:id': {
    GET: notImplemented,
    PATCH: notImplemented,
    DELETE: notImplemented
  },
  '/files/nodes/:id/children': {
    GET: notImplemented
  },
  '/files/nodes/:id/move': {
    PUT: notImplemented
  },
  '/files/nodes/:id/trash': {
    PUT: notImplemented
  },
  '/files/nodes/:id/restore': {
    PUT: notImplemented
  },
  '/files/nodes/:id/refs': {
    GET: notImplemented,
    POST: notImplemented
  },
  '/files/refs/by-source': {
    GET: notImplemented,
    DELETE: notImplemented
  },
  '/files/nodes/batch/trash': {
    PUT: notImplemented
  },
  '/files/nodes/batch/move': {
    PUT: notImplemented
  },
  '/files/nodes/batch/delete': {
    POST: notImplemented
  },
  '/files/mounts': {
    GET: notImplemented
  }
}
