import type { EventEmitter } from 'node:events'

import type {
  MigrationDatabaseCompletionFailureCode,
  MigrationDatabaseDiagnosticResult,
  MigrationDatabaseDiagnosticStep,
  MigrationDatabaseDiagnosticsWorkerInput,
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
  migrationDatabaseDiagnosticsWorkerInputSchema,
  migrationDatabaseDiagnosticsWorkerMessageSchema
} from './migrationDatabaseDiagnosticsSchemas'
// oxlint-disable-next-line import/default -- Electron Vite exposes ?nodeWorker imports as default worker factories.
import createMigrationDatabaseDiagnosticsWorker from './migrationDatabaseDiagnosticsWorker?nodeWorker'

export { MIGRATION_DATABASE_DIAGNOSTIC_MAX_MESSAGE_BYTES } from './migrationDatabaseDiagnosticsSchemas'

const DEFAULT_MIGRATION_DATABASE_DIAGNOSTIC_TIMEOUT_MS = 3_000

export interface MigrationDatabaseDiagnosticsWorkerLike {
  on(event: 'message', listener: (message: unknown) => void): EventEmitter
  once(event: 'error', listener: (error: Error) => void): EventEmitter
  once(event: 'exit', listener: (code: number) => void): EventEmitter
  removeListener(event: 'message', listener: (message: unknown) => void): EventEmitter
  removeListener(event: 'error', listener: (error: Error) => void): EventEmitter
  removeListener(event: 'exit', listener: (code: number) => void): EventEmitter
  terminate(): Promise<number>
  unref(): void
}

export type MigrationDatabaseDiagnosticsWorkerFactory = (options: {
  readonly workerData: MigrationDatabaseDiagnosticsWorkerInput
}) => MigrationDatabaseDiagnosticsWorkerLike

export interface MigrationDatabaseDiagnosticsOptions {
  readonly createWorker?: MigrationDatabaseDiagnosticsWorkerFactory
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
    | { readonly status: 'timed_out'; readonly code: 'worker_timeout' }
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

function createWorkerInput(databaseFile: string): MigrationDatabaseDiagnosticsWorkerInput | null {
  const input = migrationDatabaseDiagnosticsWorkerInputSchema.safeParse({ databaseFile })
  return input.success ? input.data : null
}

function rememberStep(completed: CompletedSteps, step: MigrationDatabaseDiagnosticStep): void {
  if (step.level === 'l0') completed.l0 = step
  else if (step.level === 'l1') completed.l1 = step
  else completed.l2 = step
}

export class MigrationDatabaseDiagnostics {
  private readonly createWorker: MigrationDatabaseDiagnosticsWorkerFactory
  private readonly timeoutMs: number

  constructor(options: MigrationDatabaseDiagnosticsOptions = {}) {
    this.createWorker =
      options.createWorker ??
      (createMigrationDatabaseDiagnosticsWorker as unknown as MigrationDatabaseDiagnosticsWorkerFactory)
    this.timeoutMs =
      options.timeoutMs !== undefined && Number.isFinite(options.timeoutMs) && options.timeoutMs > 0
        ? Math.floor(options.timeoutMs)
        : DEFAULT_MIGRATION_DATABASE_DIAGNOSTIC_TIMEOUT_MS
  }

  inspect(databaseFile: string): Promise<MigrationDatabaseDiagnosticResult> {
    const input = createWorkerInput(databaseFile)
    if (input === null) return Promise.resolve(createTerminalResult({}, { status: 'failed', code: 'invalid_input' }))

    let worker: MigrationDatabaseDiagnosticsWorkerLike
    try {
      worker = this.createWorker({ workerData: input })
    } catch {
      return Promise.resolve(createTerminalResult({}, { status: 'failed', code: 'worker_error' }))
    }

    return new Promise((resolve) => {
      const completed: CompletedSteps = {}
      let settled = false

      const cleanup = (): void => {
        clearTimeout(timeout)
        worker.removeListener('message', handleMessage)
        worker.removeListener('error', handleError)
        worker.removeListener('exit', handleExit)
      }

      const terminateOnce = (): void => {
        try {
          void worker.terminate().catch(() => undefined)
        } catch {
          // Termination is best-effort; diagnostics already have a stable result.
        }
      }

      const finish = (result: MigrationDatabaseDiagnosticResult): void => {
        if (settled) return
        settled = true
        cleanup()
        terminateOnce()
        resolve(result)
      }

      const finishFailed = (code: MigrationDatabaseCompletionFailureCode): void => {
        finish(createTerminalResult(completed, { status: 'failed', code }))
      }

      function handleMessage(message: unknown): void {
        if (settled) return
        const byteLength = getMessageByteLength(message)
        if (byteLength === null || byteLength > MIGRATION_DATABASE_DIAGNOSTIC_MAX_MESSAGE_BYTES) {
          finishFailed('protocol_error')
          return
        }

        const parsed = migrationDatabaseDiagnosticsWorkerMessageSchema.safeParse(message)
        if (!parsed.success) {
          finishFailed('protocol_error')
          return
        }

        if (parsed.data.type === 'step') {
          if (!isExpectedIncrement(completed, parsed.data.step)) {
            finishFailed('protocol_error')
            return
          }
          rememberStep(completed, parsed.data.step)
          return
        }

        finish(parsed.data.result)
      }

      function handleError(): void {
        finishFailed('worker_error')
      }

      function handleExit(code: number): void {
        finishFailed(code === 0 ? 'worker_no_result' : 'worker_exit')
      }

      const timeout = setTimeout(
        () => finish(createTerminalResult(completed, { status: 'timed_out', code: 'worker_timeout' })),
        this.timeoutMs
      )
      timeout.unref()
      worker.unref()
      worker.on('message', handleMessage)
      worker.once('error', handleError)
      worker.once('exit', handleExit)
    })
  }
}
