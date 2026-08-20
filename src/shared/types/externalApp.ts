export type ExternalOpenTargetKind = 'system_default' | 'application' | 'file_manager' | 'terminal'

export interface ExternalOpenTarget {
  id: string
  name?: string
  iconDataUrl?: string
  kind: ExternalOpenTargetKind
}

export interface ExternalOpenTargetResult {
  pathKind: 'file' | 'directory'
  defaultTargetId: string
  targets: ExternalOpenTarget[]
}
