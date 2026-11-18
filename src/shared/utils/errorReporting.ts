import * as z from 'zod'

import type { FailureFacts } from '../types/errorReporting'

const failureFactsSchema = z.object({
  source: z.enum(['application', 'sdk', 'provider', 'tool', 'environment']),
  kind: z.enum(['defect', 'reliability', 'expected', 'unknown']),
  reason: z.string().regex(/^[a-z][a-z0-9_.-]{0,79}$/i),
  outcome: z.enum(['retrying', 'recovered', 'failed', 'cancelled']),
  runtime: z.enum(['claude-code', 'pi', 'ai-sdk']).optional()
})

export function parseFailureFacts(value: unknown): FailureFacts | undefined {
  const parsed = failureFactsSchema.safeParse(value)
  return parsed.success ? parsed.data : undefined
}

export function isCancellation(cause: unknown): boolean {
  if (!cause || typeof cause !== 'object') return false
  const value = cause as Record<string, unknown>
  return (
    value.name === 'AbortError' ||
    value.name === 'CanceledError' ||
    value.code === 'ABORT_ERR' ||
    value.code === 'ERR_CANCELED'
  )
}

export function shouldReportFailure(facts: FailureFacts): boolean {
  if (facts.kind === 'expected' || facts.outcome === 'cancelled') return false
  return facts.outcome !== 'retrying' || facts.kind === 'defect'
}

export function hasReportingOwner(cause: unknown): boolean {
  return !!cause && typeof cause === 'object' && 'reportingHandled' in cause && cause.reportingHandled === true
}

export function markReportingHandled(cause: unknown): void {
  if (cause && typeof cause === 'object' && Object.isExtensible(cause) && !hasReportingOwner(cause)) {
    Object.defineProperty(cause, 'reportingHandled', { value: true, configurable: true, writable: true })
  }
}
