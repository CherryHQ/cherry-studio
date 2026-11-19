import type { LoggerService } from '@logger'
import { chatErrorContext } from '@main/ai/utils/chatErrorContext'
import type { FailureFacts } from '@shared/types/errorReporting'
import { classifyErrorCategory } from '@shared/utils/errorCategory'
import { hasReportingOwner, markReportingHandled } from '@shared/utils/errorReporting'

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Provider setup and generation catches pass arbitrary failures; classify only validated numeric status and string message fields.
export function providerFailureFacts(error: unknown): FailureFacts | undefined {
  if (!error || typeof error !== 'object') return
  const status = 'statusCode' in error && typeof error.statusCode === 'number' ? error.statusCode : undefined
  const text = 'message' in error && typeof error.message === 'string' ? error.message : ''
  const category = classifyErrorCategory({ text, status })
  if (
    ![
      'auth',
      'permission',
      'quota',
      'rate_limit',
      'region',
      'model',
      'deprecated',
      'context_length',
      'payload',
      'content',
      'network',
      'stream',
      'proxy',
      'server'
    ].includes(category)
  )
    return
  return { source: 'provider', kind: 'expected', reason: category, outcome: 'failed' }
}

export function logAiFailure(
  logger: Pick<LoggerService, 'error' | 'warn' | 'debug'>,
  message: string,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- AI execution catches retain the original rejection for sanitized chat context and capture ownership; reporting must not replace it with a fabricated Error.
  error: unknown,
  operation: string,
  failure: FailureFacts,
  context: Record<string, unknown> = {},
  level: 'error' | 'warn' | 'debug' = 'error'
): void {
  logger[level](message, {
    ...chatErrorContext(error),
    ...context,
    operation,
    failure,
    reportingHandled: hasReportingOwner(error)
  })
  // Preserve capture ownership when the same failure crosses IPC or reaches the global handler.
  markReportingHandled(error)
}
