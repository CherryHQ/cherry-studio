export type ManagedToolStatus = 'stopped' | 'starting' | 'running' | 'error'

export interface ManagedToolStatusState {
  status: ManagedToolStatus
  url?: string
}
