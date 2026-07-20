import { spawn } from 'node:child_process'
import type { EventEmitter } from 'node:events'
import fs from 'node:fs'

// oxlint-disable-next-line import/default -- Electron Vite exposes ?modulePath imports as default asset paths.
import migrationDatabaseDiagnosticsChildPath from './migrationDatabaseDiagnosticsChild?modulePath'
import {
  type MigrationDatabaseDiagnosticResult,
  migrationDatabaseDiagnosticResultSchema,
  type MigrationDatabaseDiagnosticsChildInput,
  migrationDatabaseDiagnosticsChildInputSchema,
  migrationDatabaseDiagnosticsChildMessageSchema,
  type MigrationDatabaseFileResult,
  type MigrationDatabaseSqliteResult
} from './migrationDatabaseDiagnosticsSchemas'

const SQLITE_HEADER = Buffer.from('SQLite format 3\0', 'binary')
const MAX_HEADER_BYTES = 100
const DEFAULT_TIMEOUT_MS = 3_000

export interface MigrationDatabaseDiagnosticsChildStderrLike {
  on(event: 'data', listener: (chunk: unknown) => void): EventEmitter
  removeListener(event: 'data', listener: (chunk: unknown) => void): EventEmitter
}

export interface MigrationDatabaseDiagnosticsChildLike {
  readonly stderr: MigrationDatabaseDiagnosticsChildStderrLike | null
  on(event: 'message', listener: (message: unknown) => void): EventEmitter
  once(event: 'error', listener: (error: Error) => void): EventEmitter
  once(event: 'close', listener: (code: number | null, signal: NodeJS.Signals | null) => void): EventEmitter
  removeListener(event: 'message', listener: (message: unknown) => void): EventEmitter
  removeListener(event: 'error', listener: (error: Error) => void): EventEmitter
  removeListener(event: 'close', listener: (code: number | null, signal: NodeJS.Signals | null) => void): EventEmitter
  send(message: MigrationDatabaseDiagnosticsChildInput, callback: (error: Error | null) => void): boolean
  kill(signal?: NodeJS.Signals): boolean
  unref(): void
}

export interface MigrationDatabaseDiagnosticsSpawnOptions {
  readonly env: NodeJS.ProcessEnv
  readonly stdio: ['ignore', 'ignore', 'pipe', 'ipc']
  readonly windowsHide: true
  readonly shell: false
}

export type MigrationDatabaseDiagnosticsChildFactory = (
  modulePath: string,
  options: MigrationDatabaseDiagnosticsSpawnOptions
) => MigrationDatabaseDiagnosticsChildLike

export interface MigrationDatabaseDiagnosticsOptions {
  readonly createChild?: MigrationDatabaseDiagnosticsChildFactory
  readonly timeoutMs?: number
}

function spawnDiagnosticsChild(
  modulePath: string,
  options: MigrationDatabaseDiagnosticsSpawnOptions
): MigrationDatabaseDiagnosticsChildLike {
  return spawn(process.execPath, [modulePath], options) as MigrationDatabaseDiagnosticsChildLike
}

function sizeBucket(size: number): NonNullable<MigrationDatabaseFileResult['sizeBucket']> {
  if (size === 0) return '0'
  if (size < 4_096) return '1-4095'
  if (size <= 1_048_576) return '4096-1m'
  if (size <= 104_857_600) return '1m-100m'
  return '100m+'
}

function sidecarPresent(file: string): boolean | undefined {
  try {
    return fs.lstatSync(file).isFile()
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') return false
    return undefined
  }
}

function inspectFile(databaseFile: string): MigrationDatabaseFileResult {
  let stats: fs.Stats
  try {
    stats = fs.lstatSync(databaseFile)
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') {
      return {
        status: 'missing',
        sqliteHeader: 'unavailable',
        walPresent: sidecarPresent(`${databaseFile}-wal`),
        shmPresent: sidecarPresent(`${databaseFile}-shm`)
      }
    }
    return { status: 'unreadable', sqliteHeader: 'unavailable' }
  }

  if (!stats.isFile() || stats.isSymbolicLink()) return { status: 'not_regular', sqliteHeader: 'unavailable' }

  const base = {
    sizeBucket: sizeBucket(stats.size),
    walPresent: sidecarPresent(`${databaseFile}-wal`),
    shmPresent: sidecarPresent(`${databaseFile}-shm`)
  }
  let fd: number | undefined
  try {
    fd = fs.openSync(databaseFile, 'r')
    const header = Buffer.alloc(MAX_HEADER_BYTES)
    const bytesRead = fs.readSync(fd, header, 0, header.length, 0)
    return {
      status: 'readable',
      ...base,
      sqliteHeader:
        bytesRead >= SQLITE_HEADER.byteLength && header.subarray(0, SQLITE_HEADER.byteLength).equals(SQLITE_HEADER)
          ? 'valid'
          : 'invalid'
    }
  } catch {
    return { status: 'unreadable', ...base, sqliteHeader: 'unavailable' }
  } finally {
    if (fd !== undefined) {
      try {
        fs.closeSync(fd)
      } catch {
        // File evidence is best-effort and never changes the migration result.
      }
    }
  }
}

function unavailable(reason: Extract<MigrationDatabaseSqliteResult, { status: 'unavailable' }>['reason']) {
  return { status: 'unavailable' as const, reason }
}

export class MigrationDatabaseDiagnostics {
  private readonly createChild: MigrationDatabaseDiagnosticsChildFactory
  private readonly timeoutMs: number

  constructor(options: MigrationDatabaseDiagnosticsOptions = {}) {
    this.createChild = options.createChild ?? spawnDiagnosticsChild
    this.timeoutMs =
      options.timeoutMs !== undefined && Number.isFinite(options.timeoutMs) && options.timeoutMs > 0
        ? Math.floor(options.timeoutMs)
        : DEFAULT_TIMEOUT_MS
  }

  inspect(databaseFile: string): Promise<MigrationDatabaseDiagnosticResult> {
    const input = migrationDatabaseDiagnosticsChildInputSchema.safeParse({ databaseFile })
    const file = input.success
      ? inspectFile(input.data.databaseFile)
      : ({ status: 'unreadable', sqliteHeader: 'unavailable' } as const)
    if (!input.success || file.status === 'missing' || file.status === 'not_regular' || file.status === 'unreadable') {
      return Promise.resolve(
        migrationDatabaseDiagnosticResultSchema.parse({ file, sqlite: unavailable('not_attempted') })
      )
    }
    return this.runChild(input.data, file)
  }

  private runChild(
    input: MigrationDatabaseDiagnosticsChildInput,
    file: MigrationDatabaseFileResult
  ): Promise<MigrationDatabaseDiagnosticResult> {
    let child: MigrationDatabaseDiagnosticsChildLike
    try {
      child = this.createChild(migrationDatabaseDiagnosticsChildPath, {
        env: {
          ...process.env,
          ELECTRON_RUN_AS_NODE: '1',
          CHERRY_MIGRATION_DATABASE_DIAGNOSTICS_CHILD: '1'
        },
        stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
        windowsHide: true,
        shell: false
      })
    } catch {
      return Promise.resolve(migrationDatabaseDiagnosticResultSchema.parse({ file, sqlite: unavailable('child_exit') }))
    }

    return new Promise((resolve) => {
      let settled = false
      let received: MigrationDatabaseSqliteResult | undefined
      let killRequested = false

      const handleStderr = (): void => {}
      const cleanup = (): void => {
        clearTimeout(timeout)
        child.removeListener('message', handleMessage)
        child.removeListener('error', handleError)
        child.removeListener('close', handleClose)
        child.stderr?.removeListener('data', handleStderr)
      }
      const settle = (sqlite: MigrationDatabaseSqliteResult): void => {
        if (settled) return
        settled = true
        cleanup()
        resolve(migrationDatabaseDiagnosticResultSchema.parse({ file, sqlite }))
      }
      const killOnce = (): void => {
        if (killRequested) return
        killRequested = true
        try {
          child.kill('SIGKILL')
        } catch {
          // The fixed unavailable result remains authoritative.
        }
      }
      const rejectOutput = (): void => {
        killOnce()
        settle(unavailable('invalid_output'))
      }
      const handleMessage = (message: unknown): void => {
        if (settled) return
        const parsed = migrationDatabaseDiagnosticsChildMessageSchema.safeParse(message)
        if (!parsed.success || received !== undefined) {
          rejectOutput()
          return
        }
        received = parsed.data.result
      }
      const handleError = (): void => {
        killOnce()
        settle(unavailable('child_exit'))
      }
      const handleClose = (code: number | null, signal: NodeJS.Signals | null): void => {
        if (settled) return
        settle(code === 0 && signal === null && received !== undefined ? received : unavailable('child_exit'))
      }
      const timeout = setTimeout(() => {
        killOnce()
        settle(unavailable('timeout'))
      }, this.timeoutMs)
      timeout.unref()

      child.on('message', handleMessage)
      child.once('error', handleError)
      child.once('close', handleClose)
      child.stderr?.on('data', handleStderr)
      child.unref()
      try {
        child.send(input, (error) => {
          if (error !== null) handleError()
        })
      } catch {
        handleError()
      }
    })
  }
}
