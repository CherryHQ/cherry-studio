import type { RetryPolicy } from '@shared/data/api/schemas/jobs'

/**
 * Retry delay in ms for the given attempt number.
 *   - `none`: 0
 *   - `fixed`: clamp(baseDelay, maxDelay)
 *   - `exponential`: clamp(base × 2^(attempt-1), maxDelay)
 *
 * Pure function — extracted from JobManager so unit tests can exercise the
 * three branches + clamping without standing up the whole service.
 */
export function computeBackoff(policy: RetryPolicy, attempt: number): number {
  if (policy.backoff === 'none') return 0
  if (policy.backoff === 'fixed') return Math.min(policy.baseDelayMs, policy.maxDelayMs)
  // exponential: base * 2^(attempt-1), floored at attempt=1 so the first
  // retry uses the raw base delay.
  const exp = policy.baseDelayMs * Math.pow(2, Math.max(0, attempt - 1))
  return Math.min(exp, policy.maxDelayMs)
}
