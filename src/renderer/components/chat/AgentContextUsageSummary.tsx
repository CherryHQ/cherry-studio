import { cn } from '@renderer/utils'
import type { AgentSessionContextUsage } from '@shared/ai/agentSessionContextUsage'
import { useTranslation } from 'react-i18next'

interface AgentContextUsageSummaryProps {
  usage: AgentSessionContextUsage | null
  percentage: number | null
  color?: string
  className?: string
  isCompacting?: boolean
}

export function AgentContextUsageSummary({
  usage,
  percentage,
  color,
  className,
  isCompacting = false
}: AgentContextUsageSummaryProps) {
  const { t } = useTranslation()
  const normalizedPercentage = percentage === null ? null : Math.min(100, Math.max(0, percentage))
  const progressColor =
    color ?? (normalizedPercentage === null ? undefined : getAgentContextUsageColor(normalizedPercentage))
  const visibleCategories = usage?.categories.filter((category) => category.tokens > 0).slice(0, 4) ?? []

  return (
    <section className={cn('space-y-2 text-xs', className)} aria-busy={isCompacting || undefined}>
      <h3 className="font-medium text-foreground">{t('agent.right_pane.info.context_usage')}</h3>
      {usage && normalizedPercentage !== null ? (
        <div className="space-y-2">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-background-subtle">
            <div
              className={cn('h-full rounded-full', isCompacting && 'animate-pulse')}
              style={{ width: `${normalizedPercentage}%`, background: progressColor }}
            />
          </div>
          <div className="flex items-center justify-between gap-3 text-muted-foreground">
            <span className="shrink-0">
              {usage.totalTokens.toLocaleString()} / {usage.maxTokens.toLocaleString()} ({normalizedPercentage}%)
            </span>
            <span className="min-w-0 truncate">{usage.model}</span>
          </div>
          {visibleCategories.length > 0 && (
            <div className="space-y-1 border-border-subtle border-t pt-2">
              {visibleCategories.map((category) => (
                <div key={category.name} className="flex items-center justify-between gap-3 text-muted-foreground">
                  <span className="min-w-0 truncate">{category.name}</span>
                  <span className="shrink-0 text-foreground-secondary">{category.tokens.toLocaleString()}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <p className="text-muted-foreground">{t('common.none')}</p>
      )}
    </section>
  )
}

export function getAgentContextUsageColor(percentage: number): string {
  const normalizedPercentage = Math.min(100, Math.max(0, percentage))
  if (normalizedPercentage <= 50) {
    const warningWeight = normalizedPercentage * 2
    return `color-mix(in oklch, var(--color-success-base) ${100 - warningWeight}%, var(--color-warning-base) ${warningWeight}%)`
  }

  const destructiveWeight = (normalizedPercentage - 50) * 2
  return `color-mix(in oklch, var(--color-warning-base) ${100 - destructiveWeight}%, var(--color-destructive) ${destructiveWeight}%)`
}
