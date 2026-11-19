import type { LoggerService } from '@logger'
import type { FailureFacts } from '@shared/types/errorReporting'
import { hasReportingOwner, markReportingHandled } from '@shared/utils/errorReporting'

/** Log sensitive failures locally, exposing only classification and stack frames to reporting. */
export function logFailure(
  logger: Pick<LoggerService, 'error' | 'warn'>,
  message: string,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Operation failures are arbitrary rejections; only verified stack frames may cross the reporting boundary.
  error: unknown,
  operation: string,
  failure: FailureFacts,
  level: 'error' | 'warn' = 'error'
): void {
  let frames: string[] | undefined
  try {
    const stack = error instanceof Error ? error.stack : undefined
    const header = error instanceof Error ? `${Error.prototype.toString.call(error)}\n` : undefined
    // Multiline messages can contain pasted stack frames; only trust frames after the complete header.
    frames =
      typeof stack === 'string' && header && stack.startsWith(header)
        ? stack
            .slice(header.length)
            .split('\n')
            .filter((line) => /^\s+at /.test(line))
        : undefined
  } catch {
    // Unreadable diagnostics cannot establish trusted reporting frames.
  }
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
