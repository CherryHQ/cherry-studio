import type { LoggerService } from '@logger'
import { chatErrorContext } from '@main/ai/utils/chatErrorContext'
import type { FailureFacts } from '@shared/types/errorReporting'
import { classifyErrorCategory } from '@shared/utils/errorCategory'
import { hasReportingOwner, markReportingHandled } from '@shared/utils/errorReporting'

export function providerFailureFacts(error: unknown): FailureFacts | undefined {
  if (!error || typeof error !== 'object') return
  const value = error as Record<string, unknown>
  const status = typeof value.statusCode === 'number' ? value.statusCode : undefined
  const category = classifyErrorCategory({ text: typeof value.message === 'string' ? value.message : '', status })
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
  error: unknown,
  operation: string,
  failure: FailureFacts,
  context: Record<string, unknown> = {},
  level: 'error' | 'warn' | 'debug' = 'error'
): void {
  logger[level](message, {
    ...context,
    ...chatErrorContext(error),
    operation,
    failure,
    reportingHandled: hasReportingOwner(error)
  })
  // Preserve capture ownership when the same failure crosses IPC or reaches the global handler.
  markReportingHandled(error)
}
