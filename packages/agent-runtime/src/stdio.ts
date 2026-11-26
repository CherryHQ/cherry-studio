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

export async function withStartupSignal<T>(
  signal: AbortSignal,
  start: () => Promise<T>,
  close: () => Promise<void>
): Promise<T> {
  signal.throwIfAborted()
  let stopping: Promise<void> | undefined
  const stop = () => {
    stopping ??= Promise.resolve().then(close)
    void stopping.catch(() => {})
  }
  signal.addEventListener('abort', stop, { once: true })
  try {
    const result = await start()
    signal.throwIfAborted()
    return result
  } catch (error) {
    stop()
    await stopping
    signal.throwIfAborted()
    throw error
  } finally {
    signal.removeEventListener('abort', stop)
  }
}

export async function runUsageCommand(launch: LaunchSpec, spawn: SpawnStdio, signal: AbortSignal) {
  signal.throwIfAborted()
  const child = spawn(launch)
  const output: { stdout: Buffer[]; stderr: Buffer[] } = { stdout: [], stderr: [] }
  let bytes = 0
  let tooLarge = false
  const stop = () => void child.closeAndJoin().catch(() => {})
  for (const key of ['stdout', 'stderr'] as const) {
    child[key].on('data', (chunk: Buffer) => {
      bytes += chunk.byteLength
      if (bytes > 256 * 1024) {
        tooLarge = true
        stop()
      } else output[key].push(chunk)
    })
  }
  child.stdin.on('error', stop)
  signal.addEventListener('abort', stop, { once: true })
  child.stdin.end()
  try {
    const result = await child.closed
    signal.throwIfAborted()
    if (tooLarge) throw new Error('Usage command output exceeded its size limit')
    if (result.kind === 'spawn-failed') throw result.error
    return {
      ok: result.code === 0,
      stdout: Buffer.concat(output.stdout).toString('utf8'),
      stderr: Buffer.concat(output.stderr).toString('utf8')
    }
  } finally {
    signal.removeEventListener('abort', stop)
    await child.closeAndJoin()
  }
}
