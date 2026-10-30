import { startCase } from 'es-toolkit'
import { ChevronRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import type { ThreadContextUsage, ContextCategoryKey } from '@cherrystudio/agent-runtime'
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger, Scrollbar } from '@cherrystudio/ui'
import { ContextUsageSummary } from '@renderer/components/chat/contextUsage'
import { parseFunctionCallToolName } from '@shared/ai/tools/mcpToolName'

const CATEGORY_KEYS: Record<ContextCategoryKey | 'buffer' | 'free', string> = {
  'system-prompt': 'system_prompt',
  'system-tools': 'system_tools',
  'mcp-tools': 'mcp_tools',
  'mcp-instructions': 'mcp_instructions',
  'memory-files': 'memory_files',
  agents: 'custom_agents',
  messages: 'messages',
  skills: 'skills',
  other: 'plugins',
  buffer: 'compact_buffer',
  free: 'free_space'
}
const CATEGORY_KIND_ORDER = { used: 0, buffer: 1, free: 2, deferred: 3 }
const RESOURCE_GROUP_ORDER: ContextCategoryKey[] = [
  'mcp-tools',
  'memory-files',
  'agents',
  'skills',
  'system-tools',
  'system-prompt',
  'mcp-instructions',
  'messages',
  'other'
]
const CATEGORY_COLORS: Partial<Record<ContextCategoryKey, string>> = {
  messages: 'var(--chart-1)',
  'mcp-tools': 'var(--chart-2)',
  'memory-files': 'var(--chart-3)',
  'system-tools': 'var(--chart-4)',
  'system-prompt': 'var(--chart-5)'
}

function resourceLabel(resource: NonNullable<ThreadContextUsage['resources']>[number]): string {
  const name = resource.name.split(/[\\/]/).at(-1) ?? resource.name
  if (resource.category !== 'mcp-tools') return name
  const parsed = parseFunctionCallToolName(name)
  const server = resource.source?.split(/[\\/]/).at(-1) || parsed?.serverPart
  const tool = startCase(parsed?.toolPart ?? name.replace(/^mcp__/, '')).replace(
    /\b(Mcp|Js|Cli|Api|Url|Id|Json|Sql|Http)\b/g,
    (word) => word.toUpperCase()
  )
  return server ? `${server} · ${tool}` : tool
}

interface AgentContextUsageSummaryProps {
  usage: ThreadContextUsage | null
  percentage: number | null
  className?: string
  isCompacting?: boolean
  modelName?: string
  /** The composer shows only the total; the status pane includes native details. */
  showCategories?: boolean
}

export function AgentContextUsageSummary({
  usage,
  percentage,
  className,
  isCompacting = false,
  modelName,
  showCategories = true
}: AgentContextUsageSummaryProps) {
  const { t, i18n } = useTranslation()
  const windowTokens = usage?.contextWindow ?? 0
  const label = (id: keyof typeof CATEGORY_KEYS) => t(`agent.right_pane.info.context_categories.${CATEGORY_KEYS[id]}`)
  const formatTokens = (tokens: number) =>
    tokens.toLocaleString('en-US', { notation: 'compact', maximumFractionDigits: 1 })
  const formatExact = (tokens: number) => tokens.toLocaleString(i18n.resolvedLanguage)
  const categories = showCategories
    ? [
        ...(usage?.breakdown?.categories ?? []).map((category) => ({
          id: category.id,
          label: `${category.key === 'other' ? (category.label ?? label('other')) : label(category.key)}${category.occupancy === 'deferred' ? ` (${t('agent.right_pane.info.context_details.deferred')})` : ''}`,
          kind: category.occupancy === 'deferred' ? ('deferred' as const) : ('used' as const),
          tokens: category.tokens,
          precision: category.precision,
          color: CATEGORY_COLORS[category.key] ?? 'var(--muted-foreground)'
        })),
        ...(['reserved', 'free'] as const).flatMap((key) => {
          const count = usage?.[key]
          const kind = key === 'reserved' ? ('buffer' as const) : ('free' as const)
          return count ? [{ id: key, label: label(kind), kind, ...count, color: 'var(--border-strong)' }] : []
        })
      ]
        .filter((category) => category.tokens > 0)
        .sort((a, b) => CATEGORY_KIND_ORDER[a.kind] - CATEGORY_KIND_ORDER[b.kind] || b.tokens - a.tokens)
    : []
  const data =
    usage?.used && percentage !== null
      ? {
          usedTokens: usage.used.tokens,
          estimated: usage.used.precision === 'estimated',
          maxTokens: windowTokens,
          percentage,
          modelName: modelName || usage.model,
          ...(usage.breakdown?.coverage === 'complete' && {
            segments: categories.filter((category) => category.kind === 'used' || category.kind === 'buffer')
          })
        }
      : null
  const groups = RESOURCE_GROUP_ORDER.map((id) => ({
    id,
    rows: (usage?.resources ?? [])
      .filter((resource) => resource.category === id)
      .map((resource) => ({
        id: resource.id,
        name: resourceLabel(resource),
        tokens: resource.count?.tokens,
        precision: resource.count?.precision,
        status: resource.state ? t(`agent.right_pane.info.context_details.${resource.state}`) : undefined
      }))
  }))

  return (
    <ContextUsageSummary
      title={t(showCategories ? 'agent.right_pane.info.context' : 'agent.right_pane.info.context_usage')}
      emptyLabel={t('common.unknown')}
      data={data}
      className={className}
      collapsible={showCategories}
      description={[
        usage?.breakdown?.coverage === 'partial' && t('agent.right_pane.info.context_details.partial'),
        usage?.basis === 'last-request' && t('agent.right_pane.info.context_details.last_request')
      ]
        .filter(Boolean)
        .join(' · ')}
      isBusy={isCompacting}>
      {categories.length > 0 && (
        <table
          className="w-full table-fixed border-separate border-spacing-y-1 text-muted-foreground"
          aria-label={t('agent.right_pane.info.context_usage')}>
          <tbody>
            {categories.map((category) => (
              <tr key={category.id}>
                <th scope="row" className="w-1/2 pr-2 text-left font-normal">
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="size-2 shrink-0 rounded-xs" style={{ background: category.color }} />
                    <span className="truncate" title={category.label}>
                      {category.label}
                    </span>
                  </span>
                </th>
                <td
                  className="text-right tabular-nums"
                  title={[
                    formatExact(category.tokens),
                    category.precision === 'estimated' && t('chat.message.token_details.cost_estimated')
                  ]
                    .filter(Boolean)
                    .join(' · ')}>
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
              <AccordionItem key={group.id} value={group.id} className="border-0 first:border-t-0">
                <AccordionTrigger className="group gap-2 py-2 text-xs font-normal text-muted-foreground [&>svg]:hidden">
                  <span className="flex min-w-0 flex-1 items-center gap-2">
                    <ChevronRight
                      aria-hidden
                      className="size-3 shrink-0 transition-transform duration-150 group-data-[state=open]:rotate-90 motion-reduce:transition-none"
                    />
                    <span className="flex-1">{label(group.id)}</span>
                    <span className="tabular-nums">{formatExact(group.rows?.length ?? 0)}</span>
                  </span>
                </AccordionTrigger>
                <AccordionContent className="pt-0 pb-2 text-xs">
                  <Scrollbar
                    className="max-h-60 overflow-x-hidden pl-5"
                    role="list"
                    aria-label={label(group.id)}
                    tabIndex={0}>
                    {group.rows?.map((row) => (
                      <div
                        key={row.id}
                        role="listitem"
                        className="flex min-w-0 items-center justify-between gap-3 py-1 text-muted-foreground">
                        <span className="min-w-0 truncate" title={row.name}>
                          {row.name}
                        </span>
                        <span
                          className="shrink-0 text-muted-foreground tabular-nums"
                          title={[
                            row.tokens === undefined ? undefined : formatExact(row.tokens),
                            row.precision === 'estimated' && t('chat.message.token_details.cost_estimated'),
                            row.status
                          ]
                            .filter(Boolean)
                            .join(' · ')}>
                          {row.tokens === undefined ? '—' : formatTokens(row.tokens)}
                        </span>
                      </div>
                    ))}
                  </Scrollbar>
                </AccordionContent>
              </AccordionItem>
            ))}
        </Accordion>
      )}
    </ContextUsageSummary>
  )
}
