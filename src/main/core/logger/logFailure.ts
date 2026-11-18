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
  const stack = error instanceof Error ? error.stack : undefined
  const header = error instanceof Error ? `${Error.prototype.toString.call(error)}\n` : undefined
  // Multiline messages can contain pasted stack frames; only trust frames after the complete header.
  const frames =
    stack && header && stack.startsWith(header)
      ? stack
          .slice(header.length)
          .split('\n')
          .filter((line) => /^\s+at /.test(line))
      : undefined
  const context = {
    operation,
    failure,
    errorName: 'OperationError',
    errorMessage: failure.reason
  }
  if (frames?.length) Object.assign(context, { stack: [`OperationError: ${failure.reason}`, ...frames].join('\n') })
  logger[level](message, {
    ...context,
    diagnostic: { error },
    reportingHandled: hasReportingOwner(error)
  })
  markReportingHandled(error)
}
