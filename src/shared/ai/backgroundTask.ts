export type BackgroundTaskStatus = 'running' | 'completed' | 'failed' | 'stopped' | 'unknown'

export interface BackgroundTaskRecord {
  id: string
  name: string
  command: string
  pid: number
  pidStartTime?: string
  cwd: string
  startedAt: string
  logFile: string
  status: BackgroundTaskStatus
  exitCode: number | null
  signal: string | null
  finishedAt?: string
  durationMs?: number
  stopRequestedAt?: string
  stopSignal?: string
  note?: string
}
