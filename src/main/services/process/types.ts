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
  start(): Promise<void>
  stop(): Promise<void>
  restart(): Promise<void>
}

export interface UtilityProcessHandle extends ProcessHandle {
  postMessage(message: unknown): void
  onMessage(handler: (message: unknown) => void): () => void
}

export interface ProcessLogLine {
  processId: string
  stream: 'stdout' | 'stderr'
  data: string
  timestamp: number
}

export interface ProcessManagerEvents {
  'process:started': (id: string, pid: number) => void
  'process:exited': (id: string, code: number | null, signal: NodeJS.Signals | null) => void
  'process:log': (line: ProcessLogLine) => void
}

export interface ChildProcessDefinition {
  type: 'child'
  id: string
  command: string
  args?: string[]
  cwd?: string
  env?: Record<string, string>
  killTimeoutMs?: number
}

export interface UtilityProcessDefinition {
  type: 'utility'
  id: string
  modulePath: string
  args?: string[]
  env?: Record<string, string>
  killTimeoutMs?: number
}

export type ProcessDefinition = ChildProcessDefinition | UtilityProcessDefinition
