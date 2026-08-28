import type { StdioOptions } from 'child_process'

export enum ProcessState {
  Idle = 'idle',
  Running = 'running',
  Stopping = 'stopping',
  Stopped = 'stopped',
  Crashed = 'crashed'
}

export interface ProcessHandle {
  readonly id: string
  readonly state: ProcessState
  readonly pid: number | undefined
  readonly skipOnStop: boolean
  start(): Promise<void>
  stop(): Promise<void>
  restart(): Promise<void>
}

export interface ProcessLogLine {
  processId: string
  stream: 'stdout' | 'stderr'
  data: string
  timestamp: number
}

export interface ProcessStartedEvent {
  id: string
  pid: number
}

export interface ProcessExitedEvent {
  id: string
  code: number | null
  signal: NodeJS.Signals | null
}

export const DEFAULT_KILL_TIMEOUT_MS = 5000

export interface ProcessOptions {
  id: string
  args?: string[]
  env?: Record<string, string>
  killTimeoutMs?: number
}

export interface ChildProcessOptions extends ProcessOptions {
  command: string
  cwd?: string
  detached?: boolean
  stdio?: StdioOptions
  skipOnStop?: boolean
}

export interface UtilityProcessOptions extends ProcessOptions {
  modulePath: string
}
