import { ContextUsageSummary } from '@renderer/components/chat/contextUsage'
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

  return (
    <ContextUsageSummary
      title={t('agent.right_pane.info.context_usage')}
      emptyLabel={t('common.none')}
      data={data}
      className={className}
      isBusy={isCompacting}>
      {visibleCategories.length > 0 ? (
        <div className="space-y-1 border-border-subtle border-t pt-2">
          {visibleCategories.map((category) => {
            // Share of used context (totalTokens), so proportions stay meaningful
            // even when the window (maxTokens) is huge and barely filled.
            const share = usage && usage.totalTokens > 0 ? Math.round((category.tokens / usage.totalTokens) * 100) : 0
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
      ) : null}
    </ContextUsageSummary>
  )
}
