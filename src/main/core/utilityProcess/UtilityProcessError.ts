import type { RemoteErrorShape } from './protocol/frames'
import { fromRemoteError } from './protocol/remoteError'

export const UTILITY_PROCESS_ERROR_CODES = [
  'PROCESS_START_FAILED',
  'PROCESS_EXITED',
  'PROCESS_PROTOCOL_ERROR',
  'PROCESS_REMOTE_ERROR',
  'PROCESS_SERIALIZATION_FAILED',
  'PROCESS_BLOCKED',
  'PROCESS_CIRCUIT_OPEN',
  'PROCESS_STOP_FAILED'
] as const

export type UtilityProcessErrorCode = (typeof UTILITY_PROCESS_ERROR_CODES)[number]

export interface UtilityProcessErrorDetails {
  processId: string
  generation?: number
  exitCode?: number
  /** True when the exit was requested by core (stop, terminate-cancel, idle) rather than a crash. */
  intentional?: boolean
  /** Consecutive infrastructure failures at the time the error was built. */
  failureCount?: number
  circuitOpen?: boolean
  /** Present on PROCESS_REMOTE_ERROR and PROCESS_START_FAILED raised by the child's `initialize`. */
  remote?: RemoteErrorShape
  cause?: unknown
}

/**
 * The single error class of the utility-process layer. `code` is the stable contract; everything
 * else is diagnostics. Cancellation is not a UtilityProcessError — the caller's own `signal.reason`
 * is rethrown untouched.
 */
export class UtilityProcessError extends Error {
  readonly code: UtilityProcessErrorCode
  readonly processId: string
  readonly generation?: number
  readonly exitCode?: number
  readonly intentional?: boolean
  readonly failureCount?: number
  readonly circuitOpen?: boolean
  readonly remote?: RemoteErrorShape

  constructor(code: UtilityProcessErrorCode, message: string, details: UtilityProcessErrorDetails) {
    const cause = details.cause ?? (details.remote ? fromRemoteError(details.remote) : undefined)
    super(message, cause === undefined ? undefined : { cause })
    this.name = 'UtilityProcessError'
    this.code = code
    this.processId = details.processId
    this.generation = details.generation
    this.exitCode = details.exitCode
    this.intentional = details.intentional
    this.failureCount = details.failureCount
    this.circuitOpen = details.circuitOpen
    this.remote = details.remote
  }
}

export function isUtilityProcessError(error: unknown, code?: UtilityProcessErrorCode): error is UtilityProcessError {
  return error instanceof UtilityProcessError && (code === undefined || error.code === code)
}
