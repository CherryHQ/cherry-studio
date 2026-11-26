import type { Readable, Writable } from 'node:stream'

export { runCliLogin } from './cliLogin'

export interface LaunchSpec {
  readonly executable: string
  readonly args: readonly string[]
  readonly cwd: string
  readonly env: Readonly<Record<string, string>>
}

export interface StdioProcess {
  readonly stdin: Writable
  readonly stdout: Readable
  readonly stderr: Readable
  readonly closed: Promise<
    { kind: 'exited'; code: number | null; signal: string | null } | { kind: 'spawn-failed'; error: Error }
  >
  /** Close and join the owned process. Concurrent callers join one attempt, and failure permits retry. */
  closeAndJoin(): Promise<void>
}

export type SpawnStdio = (spec: LaunchSpec) => StdioProcess
