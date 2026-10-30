import { useTranslation } from 'react-i18next'

import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@cherrystudio/ui'
import { ContextUsageSummary } from '@renderer/components/chat/contextUsage'
import type { AgentSessionContextUsage } from '@shared/ai/agentSessionContextUsage'

type Category = AgentSessionContextUsage['categories'][number]

const CATEGORY_NAMES: Record<string, string> = {
  'Autocompact buffer': 'autocompact_buffer',
  'Compact buffer': 'compact_buffer',
  'Custom agents': 'custom_agents',
  'Free space': 'free_space',
  'MCP tools': 'mcp_tools',
  'MCP server instructions': 'mcp_instructions',
  'MCP tools (deferred)': 'mcp_tools_deferred',
  'System tools (deferred)': 'system_tools_deferred',
  'Memory files': 'memory_files',
  Messages: 'messages',
  Plugins: 'plugins',
  Skills: 'skills',
  'System prompt': 'system_prompt',
  'System tools': 'system_tools'
}
const CATEGORY_KEYS: Record<string, string> = {
  autocompact_buffer: 'agent.right_pane.info.context_categories.autocompact_buffer',
  compact_buffer: 'agent.right_pane.info.context_categories.compact_buffer',
  custom_agents: 'agent.right_pane.info.context_categories.custom_agents',
  free_space: 'agent.right_pane.info.context_categories.free_space',
  mcp_tools: 'agent.right_pane.info.context_categories.mcp_tools',
  mcp_instructions: 'agent.right_pane.info.context_categories.mcp_instructions',
  mcp_tools_deferred: 'agent.right_pane.info.context_categories.mcp_tools_deferred',
  system_tools_deferred: 'agent.right_pane.info.context_categories.system_tools_deferred',
  memory_files: 'agent.right_pane.info.context_categories.memory_files',
  messages: 'agent.right_pane.info.context_categories.messages',
  plugins: 'agent.right_pane.info.context_categories.plugins',
  skills: 'agent.right_pane.info.context_categories.skills',
  system_prompt: 'agent.right_pane.info.context_categories.system_prompt',
  system_tools: 'agent.right_pane.info.context_categories.system_tools'
}
const CATEGORY_KIND_ORDER = { used: 0, buffer: 1, free: 2, deferred: 3 }
const CATEGORY_COLORS: Record<string, string> = {
  messages: 'var(--chart-1)',
  mcp_tools: 'var(--chart-2)',
  memory_files: 'var(--chart-3)',
  system_tools: 'var(--chart-4)',
  system_prompt: 'var(--chart-5)'
}

function categoryId(category: Category): string | undefined {
  return category.id && Object.hasOwn(CATEGORY_KEYS, category.id) ? category.id : CATEGORY_NAMES[category.name]
}

function categoryKind(category: Category): NonNullable<Category['kind']> {
  if (category.kind) return category.kind
  const id = categoryId(category)
  if (category.isDeferred || id === 'mcp_tools_deferred' || id === 'system_tools_deferred') return 'deferred'
  if (id === 'free_space') return 'free'
  if (id === 'autocompact_buffer' || id === 'compact_buffer') return 'buffer'
  return 'used'
}

interface AgentContextUsageSummaryProps {
  usage: AgentSessionContextUsage | null
  percentage: number | null
  /** Denominator shared with the composer ring. */
  maxTokens?: number | null
  className?: string
  isCompacting?: boolean
  modelName?: string
  /** The composer shows only the total; the status pane includes native details. */
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
  const { t, i18n } = useTranslation()
  const windowTokens = maxTokens ?? usage?.maxTokens ?? 0
  const label = (id: string) => t(CATEGORY_KEYS[id])
  const formatTokens = (tokens: number) =>
    tokens.toLocaleString(i18n.resolvedLanguage, { notation: 'compact', maximumFractionDigits: 1 })
  const formatExact = (tokens: number) => tokens.toLocaleString(i18n.resolvedLanguage)
  const bufferTokens =
    usage?.categories.reduce((sum, category) => sum + (categoryKind(category) === 'buffer' ? category.tokens : 0), 0) ??
    0
  const categories = showCategories
    ? (usage?.categories
        .map((category) => {
          const id = categoryId(category)
          const kind = categoryKind(category)
          return {
            label: id ? label(id) : category.name,
            kind,
            tokens: kind === 'free' ? Math.max(0, windowTokens - usage.totalTokens - bufferTokens) : category.tokens,
            color: kind === 'used' ? (CATEGORY_COLORS[id ?? ''] ?? 'var(--muted-foreground)') : 'var(--border-strong)'
          }
        })
        .filter((category) => category.tokens > 0)
        .sort((a, b) => CATEGORY_KIND_ORDER[a.kind] - CATEGORY_KIND_ORDER[b.kind] || b.tokens - a.tokens) ?? [])
    : []
  const data =
    usage && percentage !== null
      ? {
          usedTokens: usage.totalTokens,
          maxTokens: windowTokens,
          percentage,
          modelName: modelName || usage.model,
          segments: categories.filter((category) => category.kind === 'used' || category.kind === 'buffer')
        }
      : null
  const groups = [
    {
      id: 'mcp_tools',
      rows: usage?.mcpTools?.map((tool) => ({
        name: tool.name,
        owner: tool.serverName,
        tokens: tool.tokens,
        status:
          tool.isLoaded === undefined
            ? undefined
            : tool.isLoaded
              ? t('agent.right_pane.info.context_details.loaded')
              : t('agent.right_pane.info.context_details.deferred')
      }))
    },
    {
      id: 'memory_files',
      rows: usage?.memoryFiles?.map((file) => ({
        name: file.path,
        owner: file.type,
        tokens: file.tokens,
        status: undefined
      }))
    },
    {
      id: 'custom_agents',
      rows: usage?.agents?.map((agent) => ({
        name: agent.agentType,
        owner: agent.source,
        tokens: agent.tokens,
        status: undefined
      }))
    }
  ]

  return (
    <ContextUsageSummary
      title={t('agent.right_pane.info.context_usage')}
      emptyLabel={t('common.none')}
      data={data}
      className={className}
      isBusy={isCompacting}>
      {categories.length > 0 && (
        <table
          className="w-full table-fixed border-separate border-spacing-y-1 text-muted-foreground"
          aria-label={t('agent.right_pane.info.context_usage')}>
          <tbody>
            {categories.map((category) => (
              <tr key={category.label}>
                <th scope="row" className="w-1/2 pr-2 text-left font-normal">
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="size-2 shrink-0 rounded-xs" style={{ background: category.color }} />
                    <span className="truncate" title={category.label}>
                      {category.label}
                    </span>
                  </span>
                </th>
                <td className="text-right tabular-nums" title={formatExact(category.tokens)}>
                  {formatTokens(category.tokens)}
                </td>
                <td className="text-right text-foreground tabular-nums">
                  {category.kind === 'deferred' || windowTokens <= 0
                    ? '—'
                    : `${((category.tokens / windowTokens) * 100).toLocaleString(i18n.resolvedLanguage, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {showCategories && groups.some((group) => group.rows?.length) && (
        <Accordion type="multiple">
          {groups
            .filter((group) => group.rows?.length)
            .map((group) => (
              <AccordionItem key={group.id} value={group.id}>
                <AccordionTrigger className="gap-2 py-2 text-xs font-normal text-muted-foreground">
                  <span className="flex flex-1 justify-between gap-2">
                    <span>{label(group.id)}</span>
                    <span className="tabular-nums">{formatExact(group.rows?.length ?? 0)}</span>
                  </span>
                </AccordionTrigger>
                <AccordionContent className="space-y-2 pt-0 pb-2 text-xs">
                  {group.rows?.map((row) => (
                    <div key={`${row.owner}:${row.name}`} className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="wrap-anywhere text-foreground">{row.name}</div>
                        <div className="wrap-anywhere text-muted-foreground">{row.owner}</div>
                        {row.status && <div className="text-muted-foreground">{row.status}</div>}
                      </div>
                      <span className="shrink-0 text-muted-foreground tabular-nums" title={formatExact(row.tokens)}>
                        {formatTokens(row.tokens)}
                      </span>
                    </div>
                  ))}
                </AccordionContent>
              </AccordionItem>
            ))}
        </Accordion>
      )}
    </ContextUsageSummary>
  )
}
