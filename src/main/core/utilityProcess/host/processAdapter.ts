/**
 * The seam between the host engine and the OS process. The Electron adapter is the only
 * production implementation; tests supply an in-memory one. Neither is exported outside this module.
 */

import type { ConnectFrame, MainFrame } from '../protocol/frames'

export interface ProcessSpawnOptions {
  entryPath: string
  env: Record<string, string>
  serviceName: string
}

export interface ProcessErrorInfo {
  type: string
  location: string
  report: string
}

export interface ProcessHandle {
  /** OS pid once spawned; undefined before spawn and after exit. */
  readonly pid: number | undefined
  /** Sends the one-time bootstrap frame (with the private port) over the parent port. May throw on unclonable init data. */
  connect(frame: ConnectFrame): void
  /** Sends a frame over the private port. May throw synchronously on unclonable input. */
  send(frame: MainFrame): void
  kill(): void
  onSpawn(listener: () => void): void
  onMessage(listener: (data: unknown) => void): void
  /** The only lifecycle truth: fires exactly once when the process is gone. */
  onExit(listener: (code: number) => void): void
  onStdoutLine(listener: (line: string, truncated: boolean) => void): void
  onStderrLine(listener: (line: string, truncated: boolean) => void): void
  onError(listener: (info: ProcessErrorInfo) => void): void
}

export interface ProcessAdapter {
  /** May throw synchronously (bad entry path, fork failure). */
  spawn(options: ProcessSpawnOptions): ProcessHandle
}
