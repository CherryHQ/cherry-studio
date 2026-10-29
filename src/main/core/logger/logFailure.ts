import type { LoggerService } from '@logger'
import type { FailureFacts } from '@shared/types/errorReporting'
import { hasReportingOwner, markReportingHandled } from '@shared/utils/errorReporting'

/** Log sensitive failures locally, exposing only classification and stack frames to reporting. */
export function logFailure(
  logger: Pick<LoggerService, 'error' | 'warn'>,
  message: string,
  error: unknown,
  operation: string,
  failure: FailureFacts,
  level: 'error' | 'warn' = 'error'
): void {
  const frames = error instanceof Error ? error.stack?.split('\n').filter((line) => /^\s+at /.test(line)) : undefined
  logger[level](message, {
    operation,
    failure,
    errorName: 'OperationError',
    errorMessage: failure.reason,
    ...(frames?.length ? { stack: [`OperationError: ${failure.reason}`, ...frames].join('\n') } : {}),
    diagnostic: { error },
    reportingHandled: hasReportingOwner(error)
  })
  markReportingHandled(error)
}
