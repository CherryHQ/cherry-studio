export interface DataApiCallContext {
  requestId: string | null
  operationId: string | null
  retryAttempt: number | null
  /** Sanitized caller-declared source, or 'unknown'. Never trusted for identity. */
  source: string
  actor:
    | { kind: 'renderer'; webContentsId?: number; windowId: string | null }
    | { kind: 'main'; source: string }
    | { kind: 'unknown' }
}
