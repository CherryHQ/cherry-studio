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
import type { AiUsageRecordListSortBy, AiUsageRecordSortOrder } from '@shared/data/api/schemas/aiUsageRecord'
import { type AiUsageRecordEntry, getAiUsageRecordTotalTokens } from '@shared/data/types/aiUsageRecord'
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { displayModelId, getGenerationTokensPerSecond, MODALITY_LABEL_KEYS } from './usageAnalytics'
import { formatCost } from './usageDisplay'
import { UsageModelAvatar, UsageProviderLabel, UsageSourceLabel } from './UsageSettingsPrimitives'

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
  getApiKeyLabel: (entry: AiUsageRecordEntry) => string
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
  getApiKeyLabel,
  dateFormatter,
  timeFormatter
}: UsageEntriesTableProps) {
  const { t } = useTranslation()
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
      return t('settings.usage.cards.none')
    }

    return value < 1000 ? `${Math.round(value)}ms` : `${(value / 1000).toFixed(1)}s`
  }
  const formatTps = (value: number | undefined) =>
    value === undefined
      ? t('settings.usage.cards.none')
      : t('settings.usage.table.tpsValue', { value: value.toFixed(0) })

  return (
    <div className="flex min-w-0 flex-col rounded-lg border border-border bg-background">
      <div className="flex min-w-0 items-center justify-between gap-3 border-border border-b p-3">
        <div className="font-medium text-foreground text-sm">{t('settings.usage.explore.entries')}</div>
        <div className="text-foreground-muted text-xs">
          {t('settings.usage.explore.totalEntries', { count: entryTotal })}
        </div>
      </div>
      <div className="min-w-0 p-3">
        {isLoading ? (
          <div className="flex flex-col gap-2">
            {Array.from({ length: 6 }, (_, index) => (
              <Skeleton key={index} className="h-9 rounded-md" />
            ))}
          </div>
        ) : entries.length > 0 ? (
          <>
            <Table className="min-w-[900px] table-fixed">
              <colgroup>
                <col className="w-[32%]" />
                <col className="w-[22%]" />
                <col className="w-36" />
                <col className="w-24" />
                <col className="w-24" />
                <col className="w-20" />
                <col className="w-20" />
              </colgroup>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('settings.usage.table.request')}</TableHead>
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
                    : t('settings.usage.cards.unattributedSource')
                  const createdAt = new Date(entry.createdAt)

                  return (
                    <TableRow key={entry.id}>
                      <TableCell className="min-w-0">
                        <div className="flex min-w-0 items-start gap-2">
                          <UsageModelAvatar modelId={entry.modelId} providerId={entry.providerId ?? ''} size={18} />
                          <div className="min-w-0">
                            <div className="line-clamp-2 font-medium text-foreground text-sm leading-5">
                              {displayModelId(entry.modelId) || t('settings.usage.cards.none')}
                            </div>
                            <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-foreground-muted text-xs">
                              <UsageProviderLabel
                                provider={getProviderInfo(entry.providerId ?? '', entry.providerName)}
                                size={14}
                                className="max-w-full gap-1.5 [&>span:last-child]:truncate"
                              />
                              <span>{t(MODALITY_LABEL_KEYS[entry.modality])}</span>
                            </div>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="min-w-0">
                        <div className="min-w-0">
                          <div className="min-w-0 truncate text-foreground text-sm">
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
                          <div className="mt-1 truncate text-foreground-muted text-xs">{getApiKeyLabel(entry)}</div>
                        </div>
                      </TableCell>
                      <TableCell className="text-foreground-muted text-xs">
                        <span className="inline-flex min-w-0 flex-wrap gap-x-1">
                          <span className="break-words">{dateFormatter.format(createdAt)}</span>
                          <span className="break-words">{timeFormatter.format(createdAt)}</span>
                        </span>
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        {totalTokens === null ? t('settings.usage.cards.none') : formatCompactNumber(totalTokens)}
                      </TableCell>
                      <TableCell className="text-right">
                        {entry.cost !== null && entry.cost !== undefined
                          ? formatCost(entry.cost, entry.costCurrency)
                          : t('settings.usage.cards.none')}
                      </TableCell>
                      <TableCell className="text-right">{formatMilliseconds(entry.timeFirstTokenMs)}</TableCell>
                      <TableCell className="text-right">{formatTps(tps)}</TableCell>
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
    </div>
  )
}
