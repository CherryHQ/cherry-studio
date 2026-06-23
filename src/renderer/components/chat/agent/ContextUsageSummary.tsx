import { cn } from '@renderer/utils'
import type { AgentSessionContextUsage } from '@shared/ai/agentSessionContextUsage'
import { useTranslation } from 'react-i18next'

// Category names are free-form English strings produced by the Claude Code CLI
// (SDKControlGetContextUsageResponse); unknown names fall back to the raw value.
const CATEGORY_NAME_KEYS: Record<string, string> = {
  'Autocompact buffer': 'agent.right_pane.info.context_categories.autocompact_buffer',
  'Custom agents': 'agent.right_pane.info.context_categories.custom_agents',
  'Free space': 'agent.right_pane.info.context_categories.free_space',
  'MCP tools': 'agent.right_pane.info.context_categories.mcp_tools',
  'Memory files': 'agent.right_pane.info.context_categories.memory_files',
  Messages: 'agent.right_pane.info.context_categories.messages',
  Plugins: 'agent.right_pane.info.context_categories.plugins',
  Skills: 'agent.right_pane.info.context_categories.skills',
  'System prompt': 'agent.right_pane.info.context_categories.system_prompt',
  'System tools': 'agent.right_pane.info.context_categories.system_tools'
}

interface ContextUsageSummaryProps {
  usage: AgentSessionContextUsage | null
  percentage: number | null
  color?: string
  className?: string
  isCompacting?: boolean
}

export function ContextUsageSummary({
  usage,
  percentage,
  color,
  className,
  isCompacting = false
}: ContextUsageSummaryProps) {
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
                  <span className="min-w-0 truncate">
                    {CATEGORY_NAME_KEYS[category.name] ? t(CATEGORY_NAME_KEYS[category.name]) : category.name}
                  </span>
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
