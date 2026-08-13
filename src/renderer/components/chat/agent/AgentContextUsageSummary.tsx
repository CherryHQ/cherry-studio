import { ContextUsageSummary } from '@renderer/components/chat/contextUsage'
import type { AgentSessionContextUsage } from '@shared/ai/agentSessionContextUsage'
import { useMemo } from 'react'
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

// Window-filler pseudo-categories the CLI reports alongside real consumers; they
// aren't "usage" (unused space / reserved compaction buffer), so hide them.
const HIDDEN_CATEGORY_NAMES = new Set(['Free space', 'Autocompact buffer'])

interface AgentContextUsageSummaryProps {
  usage: AgentSessionContextUsage | null
  percentage: number | null
  /** Denominator from `useAgentSessionContextUsage` — the model window, not the compaction budget. */
  maxTokens?: number | null
  className?: string
  isCompacting?: boolean
  /** Optional user-facing model name. Defaults to the raw runtime model id for diagnostic views. */
  modelName?: string
  /** Show the per-category breakdown. Off for the composer, which only reports the total. */
  showCategories?: boolean
}

export function AgentContextUsageSummary({
  usage,
  percentage,
  maxTokens,
  className,
  isCompacting = false,
  modelName,
  showCategories = true
}: AgentContextUsageSummaryProps) {
  const { t } = useTranslation()
  const data =
    usage && percentage !== null
      ? {
          usedTokens: usage.totalTokens,
          maxTokens: maxTokens ?? usage.maxTokens,
          percentage,
          modelName: modelName || usage.model
        }
      : null
  const visibleCategories = showCategories
    ? (usage?.categories.filter((category) => category.tokens > 0 && !HIDDEN_CATEGORY_NAMES.has(category.name)) ?? [])
    : []

  // Normalize shares so they sum to exactly 100%. Each visible category gets
  // Math.floor(x) and the last one absorbs the remainder; avoids the
  // independent-rounding pitfall (e.g. 12.2 + 1.6 + 88.1 → 12 + 2 + 88 = 102).
  const visibleCategoryDetails = useMemo(() => {
    if (!usage || usage.totalTokens <= 0 || visibleCategories.length === 0) return []
    const totalVisibleTokens = visibleCategories.reduce((s, c) => s + c.tokens, 0)
    if (totalVisibleTokens === 0) return []
    const raw = visibleCategories.map((c) => Math.floor((c.tokens / totalVisibleTokens) * 100))
    const remainder = 100 - raw.slice(0, -1).reduce((s, x) => s + x, 0)
    return visibleCategories.map((c, i) => ({
      ...c,
      share: i === visibleCategories.length - 1 ? Math.max(0, remainder) : raw[i]
    }))
  }, [usage, visibleCategories])

  return (
    <ContextUsageSummary
      title={t('agent.right_pane.info.context_usage')}
      emptyLabel={t('common.none')}
      data={data}
      className={className}
      isBusy={isCompacting}>
      {visibleCategoryDetails.length > 0 ? (
        <div className="space-y-1 border-border-subtle border-t pt-2">
          {visibleCategoryDetails.map((category) => (
            <div key={category.name} className="flex items-center justify-between gap-3 text-muted-foreground">
              <span className="min-w-0 truncate">
                {CATEGORY_NAME_KEYS[category.name] ? t(CATEGORY_NAME_KEYS[category.name]) : category.name}
              </span>
              <span className="shrink-0 text-muted-foreground">
                {category.tokens.toLocaleString()} ({category.share}%)
              </span>
            </div>
          ))}
        </div>
      ) : null}
    </ContextUsageSummary>
  )
}
