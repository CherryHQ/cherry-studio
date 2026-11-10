import type { DataApiRequestContext } from '@shared/data/api/types'

export interface DataApiCallContext extends DataApiRequestContext {
  requestId: string | null
  operationId: string | null
  /** Sanitized caller-declared source, or 'unknown'. Never trusted for identity. */
  source: string
  actor:
    | { kind: 'renderer'; webContentsId?: number; windowId: string | null }
    | { kind: 'main'; source: string }
    | { kind: 'unknown' }
}
