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

export function isCancellation(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const value = error as Record<string, unknown>
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

export function hasReportingOwner(error: unknown): boolean {
  return !!error && typeof error === 'object' && 'reportingHandled' in error && error.reportingHandled === true
}

export function markReportingHandled(error: unknown): void {
  if (error && typeof error === 'object' && Object.isExtensible(error) && !hasReportingOwner(error)) {
    Object.defineProperty(error, 'reportingHandled', { value: true, configurable: true, writable: true })
  }
}
