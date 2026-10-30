import { useTranslation } from 'react-i18next'

import type { ThreadContextUsage, ContextCategoryKey } from '@cherrystudio/agent-runtime'
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@cherrystudio/ui'
import { ContextUsageSummary } from '@renderer/components/chat/contextUsage'

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
const CATEGORY_COLORS: Partial<Record<ContextCategoryKey, string>> = {
  messages: 'var(--chart-1)',
  'mcp-tools': 'var(--chart-2)',
  'memory-files': 'var(--chart-3)',
  'system-tools': 'var(--chart-4)',
  'system-prompt': 'var(--chart-5)'
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
    tokens.toLocaleString(i18n.resolvedLanguage, { notation: 'compact', maximumFractionDigits: 1 })
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
  const groups = [...new Set(usage?.resources?.map((resource) => resource.category) ?? [])].map((id) => ({
    id,
    rows: usage!
      .resources!.filter((resource) => resource.category === id)
      .map((resource) => ({
        id: resource.id,
        name: resource.name,
        owner: resource.source,
        tokens: resource.count?.tokens,
        precision: resource.count?.precision,
        status: resource.state ? t(`agent.right_pane.info.context_details.${resource.state}`) : undefined
      }))
  }))

  return (
    <ContextUsageSummary
      title={t('agent.right_pane.info.context_usage')}
      emptyLabel={t('common.unknown')}
      data={data}
      className={className}
      isBusy={isCompacting}>
      {showCategories && usage?.breakdown?.coverage === 'partial' && (
        <p className="text-muted-foreground">{t('agent.right_pane.info.context_details.partial')}</p>
      )}
      {usage?.basis === 'last-request' && (
        <p className="text-muted-foreground">{t('agent.right_pane.info.context_details.last_request')}</p>
      )}
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
                <td className="text-right tabular-nums" title={formatExact(category.tokens)}>
                  {category.precision === 'estimated' ? '≈' : ''}
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
                    <div key={row.id} className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="wrap-anywhere text-foreground">{row.name}</div>
                        <div className="wrap-anywhere text-muted-foreground">{row.owner}</div>
                        {row.status && <div className="text-muted-foreground">{row.status}</div>}
                      </div>
                      <span
                        className="shrink-0 text-muted-foreground tabular-nums"
                        title={row.tokens === undefined ? undefined : formatExact(row.tokens)}>
                        {row.tokens === undefined
                          ? '—'
                          : `${row.precision === 'estimated' ? '≈' : ''}${formatTokens(row.tokens)}`}
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
