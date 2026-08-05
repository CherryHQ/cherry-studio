import { useTranslation } from 'react-i18next'

import { cn } from '@renderer/utils/style'
import type { AgentSessionContextUsage } from '@shared/ai/agentSessionContextUsage'

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

// Context usage is a visualization, so its midpoint keeps the reviewed amber-400
// value locally instead of changing the shared warning contract for one chart.
const CONTEXT_USAGE_WARNING_COLOR = 'oklch(0.83 0.164 84)'

// Window-filler pseudo-categories the CLI reports alongside real consumers; they
// aren't "usage" (unused space / reserved compaction buffer), so hide them.
const HIDDEN_CATEGORY_NAMES = new Set(['Free space', 'Autocompact buffer'])

interface ContextUsageSummaryProps {
  usage: AgentSessionContextUsage | null
  percentage: number | null
  color?: string
  className?: string
  isCompacting?: boolean
  /** Show the per-category breakdown. Off for the composer, which only reports the total. */
  showCategories?: boolean
}

export function ContextUsageSummary({
  usage,
  percentage,
  color,
  className,
  isCompacting = false,
  showCategories = true
}: ContextUsageSummaryProps) {
  const { t } = useTranslation()
  const normalizedPercentage = percentage === null ? null : Math.min(100, Math.max(0, percentage))
  const progressColor =
    color ?? (normalizedPercentage === null ? undefined : getAgentContextUsageColor(normalizedPercentage))
  const visibleCategories = showCategories
    ? (usage?.categories.filter((category) => category.tokens > 0 && !HIDDEN_CATEGORY_NAMES.has(category.name)) ?? [])
    : []

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
            <div className="space-y-1 border-t border-border-subtle pt-2">
              {visibleCategories.map((category) => {
                // Share of used context (totalTokens), so proportions stay meaningful
                // even when the window (maxTokens) is huge and barely filled.
                const share = usage.totalTokens > 0 ? Math.round((category.tokens / usage.totalTokens) * 100) : 0
                return (
                  <div key={category.name} className="flex items-center justify-between gap-3 text-muted-foreground">
                    <span className="min-w-0 truncate">
                      {CATEGORY_NAME_KEYS[category.name] ? t(CATEGORY_NAME_KEYS[category.name]) : category.name}
                    </span>
                    <span className="shrink-0 text-muted-foreground">
                      {category.tokens.toLocaleString()} ({share}%)
                    </span>
                  </div>
                )
              })}
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
    return `color-mix(in oklch, var(--success) ${100 - warningWeight}%, ${CONTEXT_USAGE_WARNING_COLOR} ${warningWeight}%)`
  }

  const destructiveWeight = (normalizedPercentage - 50) * 2
  return `color-mix(in oklch, ${CONTEXT_USAGE_WARNING_COLOR} ${100 - destructiveWeight}%, var(--destructive) ${destructiveWeight}%)`
}
