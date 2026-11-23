import * as z from 'zod'

import type { FailureFacts } from '../types/errorReporting'

const failureFactsSchema = z.object({
  source: z.enum(['application', 'sdk', 'provider', 'tool', 'environment']),
  kind: z.enum(['defect', 'reliability', 'expected', 'unknown']),
  reason: z.string().regex(/^[a-z][a-z0-9_.-]{0,79}$/i),
  outcome: z.enum(['retrying', 'recovered', 'failed', 'cancelled']),
  runtime: z.enum(['claude-code', 'pi', 'ai-sdk']).optional()
})

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Error-reporting metadata is untrusted until failureFactsSchema validates its discriminants.
export function parseFailureFacts(value: unknown): FailureFacts | undefined {
  const parsed = failureFactsSchema.safeParse(value)

  return parsed.success ? parsed.data : undefined
}

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Native and SDK cancellation failures are untyped; only readable recognized name/code markers establish cancellation.
export function isCancellation(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false

  try {
    const name = 'name' in error ? error.name : undefined

    if (name === 'AbortError' || name === 'CanceledError') return true
    const code = 'code' in error ? error.code : undefined

    return code === 'ABORT_ERR' || code === 'ERR_CANCELED'
  } catch {
    return false
  }
}

export function shouldReportFailure(facts: FailureFacts): boolean {
  if (facts.kind === 'expected' || facts.outcome === 'cancelled') return false

  return facts.outcome !== 'retrying' || facts.kind === 'defect'
}

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Reporting ownership is optional metadata on arbitrary caught values; unreadable fields cannot prove a prior report.
export function hasReportingOwner(error: unknown): boolean {
  try {
    return !!error && typeof error === 'object' && 'reportingHandled' in error && error.reportingHandled === true
  } catch {
    return false
  }
}

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Rejection values may be primitive, frozen, or expose read-only metadata; best-effort ownership must not replace the original operation failure.
export function markReportingHandled(error: unknown): void {
  try {
    if (error && typeof error === 'object' && Object.isExtensible(error) && !hasReportingOwner(error)) {
      Object.defineProperty(error, 'reportingHandled', { value: true, configurable: true, writable: true })
    }
  } catch {
    // Reporting ownership is optional when the original failure cannot be annotated.
  }
}
