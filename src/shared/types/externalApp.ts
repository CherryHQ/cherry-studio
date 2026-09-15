export type ExternalOpenTargetKind = 'system_default' | 'application' | 'file_manager' | 'terminal'

export interface ExternalOpenTarget {
  id: string
  /** Best-effort display name; absence does not make the target unavailable. */
  name?: string
  iconDataUrl?: string
  kind: ExternalOpenTargetKind
}

export interface ExternalOpenTargetResult {
  pathKind: 'file' | 'directory'
  /** Product fallback used when no valid persisted target preference exists. */
  recommendedTargetId: string
  targets: ExternalOpenTarget[]
}
