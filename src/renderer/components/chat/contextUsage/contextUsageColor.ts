// Context usage is a visualization, so its midpoint keeps the reviewed amber-400
// value locally instead of changing the shared warning contract for one chart.
const CONTEXT_USAGE_WARNING_COLOR = 'oklch(0.83 0.164 84)'

export function normalizeContextUsagePercentage(percentage: number): number {
  return Math.round(Math.min(100, Math.max(0, percentage)))
}

export function getContextUsageColor(percentage: number): string {
  const normalizedPercentage = normalizeContextUsagePercentage(percentage)
  if (normalizedPercentage <= 50) {
    const warningWeight = normalizedPercentage * 2
    return `color-mix(in oklch, var(--success) ${100 - warningWeight}%, ${CONTEXT_USAGE_WARNING_COLOR} ${warningWeight}%)`
  }

  const destructiveWeight = (normalizedPercentage - 50) * 2
  return `color-mix(in oklch, ${CONTEXT_USAGE_WARNING_COLOR} ${100 - destructiveWeight}%, var(--destructive) ${destructiveWeight}%)`
}
