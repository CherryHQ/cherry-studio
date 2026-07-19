import { spawn } from 'node:child_process'
import type { EventEmitter } from 'node:events'
import { isDeepStrictEqual } from 'node:util'

// oxlint-disable-next-line import/default -- Electron Vite exposes ?modulePath imports as default asset paths.
import migrationDatabaseDiagnosticsChildPath from './migrationDatabaseDiagnosticsChild?modulePath'
import type { MigrationDatabaseDiagnosticsLease } from './migrationDatabaseDiagnosticsLease'
import type {
  MigrationDatabaseCompletedDiagnosticResult,
  MigrationDatabaseCompletionFailureCode,
  MigrationDatabaseDiagnosticResult,
  MigrationDatabaseDiagnosticsChildInput,
  MigrationDatabaseDiagnosticStep,
  MigrationDatabaseFailedDiagnosticResult,
  MigrationDatabaseL0Step,
  MigrationDatabaseL1Step,
  MigrationDatabaseL2Step,
  MigrationDatabaseTimedOutDiagnosticResult
} from './migrationDatabaseDiagnosticsSchemas'
import {
  MIGRATION_DATABASE_DIAGNOSTIC_MAX_MESSAGE_BYTES,
  MIGRATION_DATABASE_DIAGNOSTIC_VERSION,
  MIGRATION_DATABASE_EXPECTED_SCHEMA_VERSION,
  migrationDatabaseDiagnosticsChildInputSchema,
  migrationDatabaseDiagnosticsChildMessageSchema,
  migrationDatabaseDiagnosticsChildReadySchema
} from './migrationDatabaseDiagnosticsSchemas'

export type { MigrationDatabaseDiagnosticsLease } from './migrationDatabaseDiagnosticsLease'
export { MIGRATION_DATABASE_DIAGNOSTIC_MAX_MESSAGE_BYTES } from './migrationDatabaseDiagnosticsSchemas'

const DEFAULT_MIGRATION_DATABASE_DIAGNOSTIC_TIMEOUT_MS = 3_000
const MAX_DRAINED_STDERR_BYTES = 65_536

export interface MigrationDatabaseDiagnosticsChildStderrLike {
  on(event: 'data', listener: (chunk: unknown) => void): EventEmitter
  removeListener(event: 'data', listener: (chunk: unknown) => void): EventEmitter
}

export interface MigrationDatabaseDiagnosticsChildLike {
  readonly stderr: MigrationDatabaseDiagnosticsChildStderrLike | null
  on(event: 'message', listener: (message: unknown) => void): EventEmitter
  once(event: 'error', listener: (error: Error) => void): EventEmitter
  once(event: 'exit', listener: (code: number | null, signal: NodeJS.Signals | null) => void): EventEmitter
  removeListener(event: 'message', listener: (message: unknown) => void): EventEmitter
  removeListener(event: 'error', listener: (error: Error) => void): EventEmitter
  removeListener(event: 'exit', listener: (code: number | null, signal: NodeJS.Signals | null) => void): EventEmitter
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

interface CompletedSteps {
  l0?: MigrationDatabaseL0Step
  l1?: MigrationDatabaseL1Step
  l2?: MigrationDatabaseL2Step
}

function createTerminalResult(
  completed: CompletedSteps,
  completion:
    | { readonly status: 'failed'; readonly code: MigrationDatabaseCompletionFailureCode }
    | { readonly status: 'timed_out'; readonly code: 'process_timeout' }
): MigrationDatabaseDiagnosticResult {
  const base = {
    version: MIGRATION_DATABASE_DIAGNOSTIC_VERSION,
    expectedSchemaVersion: MIGRATION_DATABASE_EXPECTED_SCHEMA_VERSION,
    ...completed
  }
  if (completion.status === 'failed') {
    const result: MigrationDatabaseFailedDiagnosticResult = { ...base, completion }
    return result
  }
  const result: MigrationDatabaseTimedOutDiagnosticResult = { ...base, completion }
  return result
}

function getMessageByteLength(message: unknown): number | null {
  try {
    const serialized = JSON.stringify(message)
    return serialized === undefined ? null : Buffer.byteLength(serialized, 'utf8')
  } catch {
    return null
  }
}

function isExpectedIncrement(completed: CompletedSteps, step: MigrationDatabaseDiagnosticStep): boolean {
  if (step.level === 'l0') return completed.l0 === undefined && completed.l1 === undefined && completed.l2 === undefined
  if (step.level === 'l1') return completed.l0 !== undefined && completed.l1 === undefined && completed.l2 === undefined
  return completed.l0 !== undefined && completed.l1 !== undefined && completed.l2 === undefined
}

function rememberStep(completed: CompletedSteps, step: MigrationDatabaseDiagnosticStep): void {
  if (step.level === 'l0') completed.l0 = step
  else if (step.level === 'l1') completed.l1 = step
  else completed.l2 = step
}

function isCompleteConsistentFinal(
  completed: CompletedSteps,
  result: MigrationDatabaseCompletedDiagnosticResult
): boolean {
  return (
    completed.l0 !== undefined &&
    completed.l1 !== undefined &&
    completed.l2 !== undefined &&
    isDeepStrictEqual(completed.l0, result.l0) &&
    isDeepStrictEqual(completed.l1, result.l1) &&
    isDeepStrictEqual(completed.l2, result.l2)
  )
}

function createL0OnlyInput(databaseFile: string): MigrationDatabaseDiagnosticsChildInput | null {
  const parsed = migrationDatabaseDiagnosticsChildInputSchema.safeParse({ mode: 'l0_only', databaseFile })
  return parsed.success ? parsed.data : null
}

function createFullInput(lease: MigrationDatabaseDiagnosticsLease): MigrationDatabaseDiagnosticsChildInput | null {
  const parsed = migrationDatabaseDiagnosticsChildInputSchema.safeParse({
    mode: 'full',
    databaseFile: lease.databaseFile,
    identity: lease.identity
  })
  return parsed.success ? parsed.data : null
}

function spawnDiagnosticsChild(
  modulePath: string,
  options: MigrationDatabaseDiagnosticsSpawnOptions
): MigrationDatabaseDiagnosticsChildLike {
  return spawn(process.execPath, [modulePath], options) as MigrationDatabaseDiagnosticsChildLike
}

export class MigrationDatabaseDiagnostics {
  private readonly createChild: MigrationDatabaseDiagnosticsChildFactory
  private readonly timeoutMs: number

  constructor(options: MigrationDatabaseDiagnosticsOptions = {}) {
    this.createChild = options.createChild ?? spawnDiagnosticsChild
    this.timeoutMs =
      options.timeoutMs !== undefined && Number.isFinite(options.timeoutMs) && options.timeoutMs > 0
        ? Math.floor(options.timeoutMs)
        : DEFAULT_MIGRATION_DATABASE_DIAGNOSTIC_TIMEOUT_MS
  }

  inspect(databaseFile: string): Promise<MigrationDatabaseDiagnosticResult> {
    const input = createL0OnlyInput(databaseFile)
    return input === null
      ? Promise.resolve(createTerminalResult({}, { status: 'failed', code: 'invalid_input' }))
      : this.runChild(input)
  }

  inspectWithLease(lease: MigrationDatabaseDiagnosticsLease): Promise<MigrationDatabaseDiagnosticResult> {
    const input = createFullInput(lease)
    return input === null
      ? Promise.resolve(createTerminalResult({}, { status: 'failed', code: 'invalid_input' }))
      : this.runChild(input)
  }

  private runChild(input: MigrationDatabaseDiagnosticsChildInput): Promise<MigrationDatabaseDiagnosticResult> {
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
      return Promise.resolve(createTerminalResult({}, { status: 'failed', code: 'process_error' }))
    }

    return new Promise((resolve) => {
      const completed: CompletedSteps = {}
      let ready = false
      let settled = false
      let killRequested = false
      let pendingResult: MigrationDatabaseDiagnosticResult | undefined
      let pendingFinal: MigrationDatabaseCompletedDiagnosticResult | undefined
      let drainedStderrBytes = 0

      const cleanup = (): void => {
        clearTimeout(timeout)
        child.removeListener('message', handleMessage)
        child.removeListener('error', handleError)
        child.removeListener('exit', handleExit)
        child.stderr?.removeListener('data', handleStderr)
      }

      const settleAfterExit = (result: MigrationDatabaseDiagnosticResult): void => {
        if (settled) return
        settled = true
        cleanup()
        resolve(result)
      }

      const killOnce = (): void => {
        if (killRequested) return
        killRequested = true
        try {
          child.kill('SIGKILL')
        } catch {
          // A thrown kill still waits for the process exit event. Releasing the
          // diagnostics lease before observing exit would reopen the WAL race.
        }
      }

      const stop = (result: MigrationDatabaseDiagnosticResult): void => {
        if (pendingResult !== undefined || settled) return
        pendingFinal = undefined
        pendingResult = result
        killOnce()
      }

      const stopFailed = (code: MigrationDatabaseCompletionFailureCode): void => {
        stop(createTerminalResult(completed, { status: 'failed', code }))
      }

      const handleStderr = (chunk: unknown): void => {
        if (drainedStderrBytes < MAX_DRAINED_STDERR_BYTES) {
          const byteLength = Buffer.isBuffer(chunk)
            ? chunk.byteLength
            : typeof chunk === 'string'
              ? Buffer.byteLength(chunk)
              : 0
          drainedStderrBytes = Math.min(MAX_DRAINED_STDERR_BYTES, drainedStderrBytes + byteLength)
        }
      }

      const handleMessage = (message: unknown): void => {
        if (settled || pendingResult !== undefined || pendingFinal !== undefined) return
        const byteLength = getMessageByteLength(message)
        if (byteLength === null || byteLength > MIGRATION_DATABASE_DIAGNOSTIC_MAX_MESSAGE_BYTES) {
          stopFailed('protocol_error')
          return
        }

        const parsedReady = migrationDatabaseDiagnosticsChildReadySchema.safeParse(message)
        if (!ready) {
          if (!parsedReady.success) {
            stopFailed('protocol_error')
            return
          }
          ready = true
          try {
            child.send(input, (error) => {
              if (error !== null) stopFailed('process_error')
            })
          } catch {
            stopFailed('process_error')
          }
          return
        }
        if (parsedReady.success) {
          stopFailed('protocol_error')
          return
        }

        const parsed = migrationDatabaseDiagnosticsChildMessageSchema.safeParse(message)
        if (!parsed.success) {
          stopFailed('protocol_error')
          return
        }
        if (parsed.data.type === 'step') {
          if (!isExpectedIncrement(completed, parsed.data.step)) {
            stopFailed('protocol_error')
            return
          }
          if (input.mode === 'l0_only' && parsed.data.step.level !== 'l0') {
            stopFailed('protocol_error')
            return
          }
          rememberStep(completed, parsed.data.step)
          return
        }

        if (input.mode !== 'full' || !isCompleteConsistentFinal(completed, parsed.data.result)) {
          stopFailed('protocol_error')
          return
        }
        pendingFinal = parsed.data.result
      }

      const handleError = (): void => {
        stopFailed('process_error')
      }

      const handleExit = (code: number | null, signal: NodeJS.Signals | null): void => {
        if (settled) return
        if (pendingResult !== undefined) {
          settleAfterExit(pendingResult)
          return
        }
        if (code === 0 && signal === null && pendingFinal !== undefined) {
          settleAfterExit(pendingFinal)
          return
        }
        if (code === 0 && signal === null && input.mode === 'l0_only' && completed.l0 !== undefined) {
          settleAfterExit(createTerminalResult(completed, { status: 'failed', code: 'lease_unavailable' }))
          return
        }
        settleAfterExit(
          createTerminalResult(completed, {
            status: 'failed',
            code: code === 0 && signal === null ? 'process_no_result' : 'process_exit'
          })
        )
      }

      const timeout = setTimeout(() => {
        stop(createTerminalResult(completed, { status: 'timed_out', code: 'process_timeout' }))
      }, this.timeoutMs)
      timeout.unref()
      child.on('message', handleMessage)
      child.once('error', handleError)
      child.once('exit', handleExit)
      child.stderr?.on('data', handleStderr)
      child.unref()
    })
  }
}
