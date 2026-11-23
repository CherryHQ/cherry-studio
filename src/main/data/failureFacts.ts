import { type DataApiError, ErrorCode } from '@shared/data/api/errors'
import type { FailureFacts } from '@shared/types/errorReporting'
import { isCancellation } from '@shared/utils/errorReporting'

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Database calls and wrapped storage failures can throw any value; inspect bounded cause chains for recognized SQLite codes without changing the failure.
export function classifyDatabaseFailure(error: unknown): FailureFacts {
  let cause = error

  for (let depth = 0; depth < 5 && cause && typeof cause === 'object'; depth++) {
    if ('code' in cause && typeof cause.code === 'string' && /^SQLITE_[A-Z_]+$/.test(cause.code)) {
      return {
        source: 'application',
        kind: cause.code.startsWith('SQLITE_CONSTRAINT') ? 'defect' : 'reliability',
        reason: cause.code.toLowerCase(),
        outcome: 'failed'
      }
    }

    cause = 'cause' in cause ? cause.cause : undefined
  }

  return { source: 'application', kind: 'reliability', reason: 'database_failed', outcome: 'failed' }
}

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- ApiServer and middleware catches retain the original rejection beside its normalized DataApiError so cancellation and driver causes remain classifiable.
export function classifyDataApiFailure(error: unknown, apiError: DataApiError): FailureFacts {
  if (isCancellation(error)) {
    return { source: 'application', kind: 'expected', reason: 'cancelled', outcome: 'cancelled' }
  }

  if (
    apiError.code === ErrorCode.NOT_FOUND &&
    apiError.details &&
    'resource' in apiError.details &&
    apiError.details.resource === 'Handler'
  ) {
    return { source: 'application', kind: 'defect', reason: 'data_handler_missing', outcome: 'failed' }
  }

  if (
    [
      ErrorCode.BAD_REQUEST,
      ErrorCode.UNAUTHORIZED,
      ErrorCode.NOT_FOUND,
      ErrorCode.CONFLICT,
      ErrorCode.VALIDATION_ERROR,
      ErrorCode.RATE_LIMIT_EXCEEDED,
      ErrorCode.PERMISSION_DENIED,
      ErrorCode.INVALID_OPERATION,
      ErrorCode.RESOURCE_LOCKED,
      ErrorCode.CONCURRENT_MODIFICATION
    ].includes(apiError.code)
  ) {
    return { source: 'application', kind: 'expected', reason: apiError.code.toLowerCase(), outcome: 'failed' }
  }

  const database = classifyDatabaseFailure(error)

  if (database.reason !== 'database_failed') return database

  if ([ErrorCode.DATA_INCONSISTENT, ErrorCode.DATABASE_ERROR, ErrorCode.MIGRATION_ERROR].includes(apiError.code)) {
    return { ...database, reason: apiError.code.toLowerCase() }
  }

  return {
    source: 'application',
    kind:
      error instanceof TypeError || error instanceof ReferenceError || error instanceof SyntaxError
        ? 'defect'
        : 'unknown',
    reason: 'data_request_failed',
    outcome: 'failed'
  }
}
