import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import {
  Button,
  EmptyState,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@cherrystudio/ui'
import { formatCompactNumber } from '@renderer/utils/number'
import { cn } from '@renderer/utils/style'
import { createDurationFormatter } from '@renderer/utils/time'
import type { AiUsageRecordListSortBy, AiUsageRecordSortOrder } from '@shared/data/api/schemas/aiUsageRecords'
import {
  type AiUsageRecordEntry,
  type AiUsageRecordModality,
  getAiUsageRecordTotalTokens
} from '@shared/data/types/aiUsageRecord'

import { displayModelId, getGenerationTokensPerSecond } from './usageAnalytics'
import { formatCost } from './usageDisplay'
import {
  UsageModelAvatar,
  UsagePanel,
  UsagePanelHeader,
  UsagePanelTitle,
  UsageSourceLabel
} from './UsageSettingsPrimitives'

const EMPTY_VALUE = '-'
const MODALITY_LABEL_KEYS = {
  language: 'common.language',
  embedding: 'models.type.embedding',
  image: 'models.type.image',
  rerank: 'models.type.rerank'
} as const satisfies Record<AiUsageRecordModality, string>

interface UsageEntriesTableProps {
  entries: AiUsageRecordEntry[]
  entryTotal: number
  isLoading: boolean
  isRefreshing: boolean
  hasNextPage: boolean
  sortBy: AiUsageRecordListSortBy
  sortOrder: AiUsageRecordSortOrder
  onSort: (sortBy: AiUsageRecordListSortBy) => void
  onLoadNext: () => void
  getProviderInfo: (id: string, snapshotName?: string | null) => { id: string; name: string }
  dateFormatter: Intl.DateTimeFormat
  timeFormatter: Intl.DateTimeFormat
}

export function UsageEntriesTable({
  entries,
  entryTotal,
  isLoading,
  isRefreshing,
  hasNextPage,
  sortBy,
  sortOrder,
  onSort,
  onLoadNext,
  getProviderInfo,
  dateFormatter,
  timeFormatter
}: UsageEntriesTableProps) {
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage
  const durationFormatter = useMemo(() => createDurationFormatter(locale), [locale])
  const integerFormatter = useMemo(() => new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }), [locale])
  const isInitialLoading = isLoading && entries.length === 0
  const getAriaSort = (column: AiUsageRecordListSortBy) =>
    sortBy === column ? (sortOrder === 'asc' ? 'ascending' : 'descending') : 'none'
  const renderSortHeader = (column: AiUsageRecordListSortBy, label: string, align: 'left' | 'right' = 'left') => {
    const isActive = sortBy === column
    const Icon = isActive ? (sortOrder === 'asc' ? ArrowUp : ArrowDown) : ArrowUpDown

    return (
      <Button
        variant="ghost"
        size="sm"
        className={cn(
          '-mx-2 h-7 gap-1.5 px-2 font-medium text-muted-foreground hover:text-foreground',
          align === 'right' && 'ml-auto'
        )}
        onClick={() => onSort(column)}>
        <span>{label}</span>
        <Icon className="size-3.5" />
      </Button>
    )
  }
  const formatMilliseconds = (value: number | null | undefined) => {
    if (value === null || value === undefined) {
      return EMPTY_VALUE
    }

    return durationFormatter(value)
  }
  const formatTps = (value: number | undefined) =>
    value === undefined ? EMPTY_VALUE : t('settings.usage.table.tpsValue', { value: integerFormatter.format(value) })

  return (
    <UsagePanel>
      <UsagePanelHeader className="flex min-w-0 items-center justify-between gap-3">
        <UsagePanelTitle>{t('settings.usage.explore.entries')}</UsagePanelTitle>
        <div className="text-xs text-foreground-tertiary">
          {t('settings.usage.explore.totalEntries', { count: entryTotal })}
        </div>
      </UsagePanelHeader>
      <div className="min-w-0 p-3" aria-busy={isLoading || isRefreshing}>
        {isInitialLoading ? (
          <div className="flex flex-col gap-2">
            {Array.from({ length: 6 }, (_, index) => (
              <Skeleton key={index} className="h-9 rounded-md" />
            ))}
          </div>
        ) : entries.length > 0 ? (
          <>
            <Table className="min-w-[1040px] table-fixed">
              <colgroup>
                <col className="w-[25%]" />
                <col className="w-[22%]" />
                <col className="w-[19%]" />
                <col className="w-[9%]" />
                <col className="w-[9%]" />
                <col className="w-[7%]" />
                <col className="w-[9%]" />
              </colgroup>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('settings.usage.table.model')}</TableHead>
                  <TableHead>{t('settings.usage.table.source')}</TableHead>
                  <TableHead aria-sort={getAriaSort('createdAt')}>
                    {renderSortHeader('createdAt', t('settings.usage.table.date'))}
                  </TableHead>
                  <TableHead className="text-right" aria-sort={getAriaSort('totalTokens')}>
                    {renderSortHeader('totalTokens', t('settings.usage.table.tokens'), 'right')}
                  </TableHead>
                  <TableHead className="text-right" aria-sort={getAriaSort('cost')}>
                    {renderSortHeader('cost', t('settings.usage.table.cost'), 'right')}
                  </TableHead>
                  <TableHead className="text-right" aria-sort={getAriaSort('timeFirstTokenMs')}>
                    {renderSortHeader('timeFirstTokenMs', t('settings.usage.table.ttft'), 'right')}
                  </TableHead>
                  <TableHead className="text-right" aria-sort={getAriaSort('tokensPerSecond')}>
                    {renderSortHeader('tokensPerSecond', t('settings.usage.table.tps'), 'right')}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {entries.map((entry) => {
                  const tps = getGenerationTokensPerSecond(entry)
                  const totalTokens = getAiUsageRecordTotalTokens(entry)
                  const sourceName = entry.sourceId
                    ? entry.sourceName || entry.sourceId
                    : t(MODALITY_LABEL_KEYS[entry.modality])
                  const modelName = entry.modelName || displayModelId(entry.modelId) || EMPTY_VALUE
                  const providerName = getProviderInfo(entry.providerId ?? '', entry.providerName).name || EMPTY_VALUE
                  const createdAt = new Date(entry.createdAt)
                  const createdAtLabel = `${dateFormatter.format(createdAt)} ${timeFormatter.format(createdAt)}`

                  return (
                    <TableRow key={entry.id}>
                      <TableCell className="min-w-0">
                        <div className="flex min-w-0 items-center gap-2">
                          <UsageModelAvatar modelId={entry.modelId} providerId={entry.providerId ?? ''} size={18} />
                          <div className="min-w-0">
                            <div className="truncate text-sm leading-5 font-medium text-foreground" title={modelName}>
                              {modelName}
                            </div>
                            <div className="truncate text-xs leading-4 text-muted-foreground" title={providerName}>
                              {providerName}
                            </div>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="min-w-0">
                        <div className="min-w-0 truncate text-sm text-foreground">
                          {entry.sourceId ? (
                            <UsageSourceLabel
                              sourceType={entry.sourceType}
                              sourceIcon={entry.sourceIcon}
                              size={14}
                              className="max-w-full gap-1.5 [&>span:last-child]:truncate">
                              {sourceName}
                            </UsageSourceLabel>
                          ) : (
                            sourceName
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="min-w-0 text-xs text-muted-foreground">
                        <time
                          dateTime={entry.createdAt}
                          className="block truncate whitespace-nowrap tabular-nums"
                          title={createdAtLabel}>
                          {createdAtLabel}
                        </time>
                      </TableCell>
                      <TableCell className="text-right font-medium whitespace-nowrap tabular-nums">
                        {totalTokens === null ? EMPTY_VALUE : formatCompactNumber(totalTokens)}
                      </TableCell>
                      <TableCell className="text-right whitespace-nowrap tabular-nums">
                        {entry.cost !== null && entry.cost !== undefined
                          ? formatCost(entry.cost, entry.costCurrency)
                          : EMPTY_VALUE}
                      </TableCell>
                      <TableCell className="text-right whitespace-nowrap tabular-nums">
                        {formatMilliseconds(entry.timeFirstTokenMs)}
                      </TableCell>
                      <TableCell className="text-right whitespace-nowrap tabular-nums">{formatTps(tps)}</TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
            {hasNextPage && (
              <div className="flex justify-center pt-3">
                <Button variant="outline" size="sm" disabled={isRefreshing} onClick={onLoadNext}>
                  {isRefreshing ? t('settings.usage.explore.loading') : t('settings.usage.explore.loadMore')}
                </Button>
              </div>
            )}
          </>
        ) : (
          <EmptyState
            compact
            preset="no-result"
            title={t('settings.usage.explore.noEntries')}
            description={t('settings.usage.explore.noEntriesDescription')}
          />
        )}
      </div>
    </UsagePanel>
  )
}
