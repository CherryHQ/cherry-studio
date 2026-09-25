import type { StdioOptions } from 'child_process'

export enum ProcessState {
  Idle = 'idle',
  Starting = 'starting',
  Running = 'running',
  Stopping = 'stopping',
  Stopped = 'stopped',
  Crashed = 'crashed'
}

export interface ProcessLogLine {
  processId: string
  stream: 'stdout' | 'stderr'
  data: string
  timestamp: number
}

export const DEFAULT_KILL_TIMEOUT_MS = 4000

export interface ChildProcessOptions {
  id: string
  command: string
  args?: string[]
  cwd?: string
  detached?: boolean
  env?: NodeJS.ProcessEnv
  killTimeoutMs?: number
  stdio?: StdioOptions
  skipOnStop?: boolean
}
