import { memo, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { EmptyState, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@cherrystudio/ui'
import { useQuery } from '@data/hooks/useDataApi'
import { formatCompactNumber } from '@renderer/utils/number'
import type { AiUsageRecordStatsBucket } from '@shared/data/api/schemas/aiUsageRecords'
import { usageStatsFrom } from '@shared/utils/apiKeyLimit'

import { startOfLocalDay } from './usageDisplay'
import { UsagePanel, UsageSection, UsageSectionTitle, UsageSourceLabel } from './UsageSettingsPrimitives'

type SourceBucket = Extract<AiUsageRecordStatsBucket, { groupBy: 'source' }>

const TOP_SOURCE_LIMIT = 5

/**
 * Answers "where did today's requests go" next to the quota table: today's
 * requests grouped by source (assistant / agent / mini-app), the one
 * dimension the quota table's per-key "used" count cannot show on its own.
 */
export const UsageSourceBreakdown = memo(function UsageSourceBreakdown() {
  const { t } = useTranslation()

  const statsParams = useMemo(() => {
    const todayStart = startOfLocalDay(new Date()).getTime()
    return {
      query: {
        groupBy: 'source' as const,
        metric: 'requests' as const,
        from: usageStatsFrom([todayStart]),
        to: Date.now(),
        limit: TOP_SOURCE_LIMIT
      }
    }
  }, [])

  const { data } = useQuery('/ai-usage-records/stats', statsParams)
  const buckets = (data?.buckets ?? []) as SourceBucket[]
  const other = data?.other
  const hasUsage = (data?.totals?.requestCount ?? 0) > 0

  const sourceLabel = (bucket: Pick<SourceBucket, 'sourceType' | 'sourceId' | 'sourceName'>): string => {
    if (!bucket.sourceType || !bucket.sourceId) return t('settings.usage.cards.unattributedSource')
    return bucket.sourceName || bucket.sourceId
  }

  if (!hasUsage) {
    return (
      <UsageSection>
        <UsageSectionTitle>{t('settings.usage.today.title')}</UsageSectionTitle>
        <UsagePanel className="p-4">
          <EmptyState compact preset="no-result" title={t('settings.usage.today.empty')} />
        </UsagePanel>
      </UsageSection>
    )
  }

  return (
    <UsageSection>
      <UsageSectionTitle>{t('settings.usage.today.title')}</UsageSectionTitle>
      <UsagePanel>
        <div className="min-w-0 overflow-x-auto p-3">
          <Table className="min-w-[420px] table-fixed">
            <colgroup>
              <col className="w-[60%]" />
              <col className="w-[20%]" />
              <col className="w-[20%]" />
            </colgroup>
            <TableHeader>
              <TableRow>
                <TableHead>{t('settings.usage.table.source')}</TableHead>
                <TableHead className="text-right">{t('settings.usage.cards.totalRequests')}</TableHead>
                <TableHead className="text-right">{t('settings.usage.table.tokens')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {buckets.map((bucket, index) => (
                <TableRow key={`${bucket.sourceType ?? 'none'}-${bucket.sourceId ?? index}`}>
                  <TableCell className="min-w-0">
                    <UsageSourceLabel
                      sourceType={bucket.sourceType}
                      sourceIcon={bucket.sourceIcon}
                      size={16}
                      className="max-w-full gap-1.5 [&>span:last-child]:truncate">
                      {sourceLabel(bucket)}
                    </UsageSourceLabel>
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-sm">
                    {formatCompactNumber(bucket.requestCount)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-sm">
                    {formatCompactNumber(bucket.totalTokens)}
                  </TableCell>
                </TableRow>
              ))}
              {other && other.requestCount > 0 && (
                <TableRow>
                  <TableCell className="text-sm text-muted-foreground">{t('common.other')}</TableCell>
                  <TableCell className="text-right tabular-nums text-sm text-muted-foreground">
                    {formatCompactNumber(other.requestCount)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-sm text-muted-foreground">
                    {formatCompactNumber(other.totalTokens)}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </UsagePanel>
    </UsageSection>
  )
})
