/** Time from a click to the outcome it led to, in the buckets the Cherry Cloud funnel contract uses. */
export function sinceClickBucket(elapsedMs: number): 'under_5m' | 'under_30m' | 'under_24h' | 'over_24h' {
  const minutes = elapsedMs / 60_000
  if (minutes >= 24 * 60) return 'over_24h'
  return minutes < 5 ? 'under_5m' : minutes < 30 ? 'under_30m' : 'under_24h'
}
