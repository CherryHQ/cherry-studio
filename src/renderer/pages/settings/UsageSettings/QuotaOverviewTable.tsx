import { ChevronDown, Minus, Plus } from 'lucide-react'
import { memo, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button, EmptyState, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@cherrystudio/ui'
import { useQuery } from '@data/hooks/useDataApi'
import { usePreference } from '@data/hooks/usePreference'
import { useProviders } from '@renderer/hooks/useProvider'
import { AI_USAGE_RECORD_AGGREGATE_MAX_LIMIT } from '@shared/data/api/schemas/aiUsageRecords'
import type { ApiKeyLimitPeriod, ServiceUsageMap } from '@shared/data/preference/preferenceTypes'
import type { UniqueModelId } from '@shared/data/types/model'
import type { RuntimeApiKey } from '@shared/data/types/provider'
import {
  collectKeyUsage,
  forecastQuotaExhaustion,
  periodRenewsAt,
  periodStartOf,
  type QuotaForecast,
  usageAgainstLimit,
  usageStatsFrom
} from '@shared/utils/apiKeyLimit'

import {
  UsagePanel,
  UsagePanelHeader,
  UsagePanelTitle,
  UsageSection,
  UsageSectionTitle
} from './UsageSettingsPrimitives'

interface QuotaRow {
  limitKey: string
  providerName: string
  keyLabel: string
  tier: string
  period: ApiKeyLimitPeriod
  limit: number
  used: number
  remaining: number
  renewsAt: Date | null
  forecast: QuotaForecast
}

interface PoolGroup {
  poolId: string
  providerName: string
  period: ApiKeyLimitPeriod
  rows: QuotaRow[]
  poolLimit: number
  poolUsed: number
  poolRemaining: number
}

interface WebServiceRow {
  serviceKey: string
  label: string
  count: number
  periodStart: number
}

const PERIOD_LABELS: Record<ApiKeyLimitPeriod, string> = {
  daily: 'settings.provider.api_key.quota_daily',
  weekly: 'settings.provider.api_key.quota_weekly',
  monthly: 'settings.provider.api_key.quota_monthly',
  total: 'settings.provider.api_key.quota_total'
}

const TIER_LABELS: Record<string, string> = {
  free: 'settings.usage.quota.tier.free',
  paid: 'settings.usage.quota.tier.paid',
  trial: 'settings.usage.quota.tier.trial'
}

const HOUR_MS = 3_600_000

export const QuotaOverviewTable = memo(function QuotaOverviewTable() {
  const { t } = useTranslation()
  const { providers } = useProviders()
  const [limits, setLimits] = usePreference('chat.routing.api_key_limits')
  const [serviceUsage] = usePreference('chat.routing.service_usage')
  const [expandedPools, setExpandedPools] = useState<Set<string>>(new Set())
  const safeLimits = limits ?? {}
  const safeServiceUsage: ServiceUsageMap = serviceUsage ?? {}

  const togglePoolExpanded = (poolId: string) => {
    const next = new Set(expandedPools)
    if (next.has(poolId)) {
      next.delete(poolId)
    } else {
      next.add(poolId)
    }
    setExpandedPools(next)
  }

  const allKeyEntries = useMemo(() => {
    const entries: Array<{
      limitKey: string
      providerId: string
      providerName: string
      keyId: string
      keyLabel: string
      tier: string
      limit: number
      period: ApiKeyLimitPeriod
      renewalAnchor?: string
      renewalTimezone?: string
      // Present only for a model-scoped entry (`apiKeyModelLimitId`) — its usage must be read
      // against this one model, never the key's traffic across every model.
      modelId?: UniqueModelId
    }> = []

    for (const [limitKey, value] of Object.entries(safeLimits)) {
      const parts = limitKey.split('::')
      if (parts.length < 2) continue
      const providerId = parts[0]
      const keyId = parts[1]
      // `apiKeyModelLimitId` appends a full UniqueModelId (`providerId::modelId`), so a
      // model-scoped key has 4 parts; anything beyond 2 is the model id, rejoined verbatim.
      const modelId = parts.length > 2 ? (parts.slice(2).join('::') as UniqueModelId) : undefined

      const provider = providers.find((p) => p.id === providerId)
      const providerName = provider?.name ?? providerId
      const key: RuntimeApiKey | undefined = provider?.apiKeys.find((k) => k.id === keyId)
      const keyLabel = key?.label ?? keyId.slice(0, 8)
      const tier = key?.tier ?? 'free'

      entries.push({
        limitKey,
        providerId,
        providerName,
        keyId,
        keyLabel,
        tier,
        limit: value.limit,
        period: value.period,
        renewalAnchor: key?.renewalAnchor,
        renewalTimezone: key?.renewalTimezone,
        modelId
      })
    }

    return entries
  }, [safeLimits, providers])

  // Keyed by limitKey, not period: two entries can share a period yet renew on different
  // anchors/timezones, and a shared per-period start would read one of them off the wrong window.
  const periodStarts = useMemo(() => {
    const starts = new Map<string, number>()
    for (const entry of allKeyEntries) {
      starts.set(entry.limitKey, periodStartOf(entry.period, entry.renewalAnchor, entry.renewalTimezone))
    }
    return starts
  }, [allKeyEntries])

  const statsParams = useMemo(() => {
    // Absent options mean "enabled" to `useQuery`, so an empty table must opt out explicitly
    // instead of firing a query-less request the endpoint rejects.
    if (allKeyEntries.length === 0) return { enabled: false }
    const minFrom = usageStatsFrom([...periodStarts.values()])
    return {
      query: {
        // (key, model) pairs so a model-scoped ceiling reads that model's own traffic, not the
        // key's traffic across every model it's used for.
        groupBy: 'apiKeyModel' as const,
        metric: 'requests' as const,
        from: minFrom,
        to: Date.now(),
        limit: AI_USAGE_RECORD_AGGREGATE_MAX_LIMIT
      }
    }
  }, [allKeyEntries, periodStarts])

  const { data: usageData } = useQuery('/ai-usage-records/stats', statsParams)

  const usageCounts = useMemo(() => collectKeyUsage(usageData?.buckets, usageData?.other), [usageData])

  const rows: QuotaRow[] = useMemo(
    () =>
      allKeyEntries.map((entry) => {
        // A response truncated past its bucket limit reads as unknown, not zero — this table
        // shows what was counted rather than promising more headroom than can be proven.
        const used = usageAgainstLimit(usageCounts, entry.keyId, entry.modelId) ?? 0
        const renewMs = periodRenewsAt(entry.period, entry.renewalAnchor, entry.renewalTimezone)
        return {
          limitKey: entry.limitKey,
          providerName: entry.providerName,
          keyLabel: entry.keyLabel,
          tier: entry.tier,
          period: entry.period,
          limit: entry.limit,
          used,
          remaining: Math.max(0, entry.limit - used),
          renewsAt: renewMs !== null ? new Date(renewMs) : null,
          forecast: forecastQuotaExhaustion({
            used,
            limit: entry.limit,
            periodStartMs: periodStarts.get(entry.period) ?? 0,
            renewsAtMs: renewMs,
            nowMs: Date.now()
          })
        }
      }),
    [allKeyEntries, usageCounts, periodStarts]
  )

  const poolGroups: PoolGroup[] = useMemo(() => {
    const groupMap = new Map<string, QuotaRow[]>()
    for (const row of rows) {
      const groupKey = `${row.providerName}::${row.period}`
      if (!groupMap.has(groupKey)) {
        groupMap.set(groupKey, [])
      }
      groupMap.get(groupKey)!.push(row)
    }

    return Array.from(groupMap.entries()).map(([groupKey, groupRows]) => {
      const [providerName, period] = groupKey.split('::') as [string, ApiKeyLimitPeriod]
      const poolLimit = groupRows.reduce((sum, r) => sum + r.limit, 0)
      const poolUsed = groupRows.reduce((sum, r) => sum + r.used, 0)
      return {
        poolId: groupKey,
        providerName,
        period,
        rows: groupRows,
        poolLimit,
        poolUsed,
        poolRemaining: Math.max(0, poolLimit - poolUsed)
      }
    })
  }, [rows])

  const webServiceRows: WebServiceRow[] = useMemo(
    () =>
      Object.entries(safeServiceUsage)
        .filter(([key]) => key.startsWith('web::'))
        .map(([key, value]) => ({
          serviceKey: key,
          label: key.replace('web::', ''),
          count: value.count,
          periodStart: value.periodStart
        })),
    [safeServiceUsage]
  )

  const describeForecast = (forecast: QuotaForecast) => {
    if (forecast.kind === 'exhausted') return t('settings.usage.quota.forecast.exhausted')
    if (forecast.kind === 'within-period') return t('settings.usage.quota.forecast.within_period')
    if (forecast.kind === 'unknown') return '—'

    const hours = Math.max(1, Math.round((forecast.atMs - Date.now()) / HOUR_MS))
    return hours < 48
      ? t('settings.usage.quota.forecast.in_hours', { count: hours })
      : t('settings.usage.quota.forecast.in_days', { count: Math.round(hours / 24) })
  }

  const adjustLimit = (limitKey: string, delta: number) => {
    const current = safeLimits[limitKey]
    if (!current) return
    const newLimit = Math.max(1, current.limit + delta)
    void setLimits({ ...safeLimits, [limitKey]: { ...current, limit: newLimit } })
  }

  if (rows.length === 0 && webServiceRows.length === 0) {
    return (
      <UsageSection>
        <UsageSectionTitle>{t('settings.usage.quota.title')}</UsageSectionTitle>
        <UsagePanel className="p-4">
          <EmptyState
            compact
            preset="no-result"
            title={t('settings.usage.quota.no_limits')}
            description={t('settings.usage.quota.no_limits_description')}
          />
        </UsagePanel>
      </UsageSection>
    )
  }

  return (
    <UsageSection>
      <UsageSectionTitle>{t('settings.usage.quota.title')}</UsageSectionTitle>

      {rows.length > 0 && (
        <UsagePanel>
          <UsagePanelHeader>
            <UsagePanelTitle>{t('settings.usage.groupBy.apiKey')}</UsagePanelTitle>
          </UsagePanelHeader>
          <div className="min-w-0 overflow-x-auto p-3">
            <Table className="min-w-[700px] table-fixed">
              <colgroup>
                <col className="w-[24%]" />
                <col className="w-[9%]" />
                <col className="w-[10%]" />
                <col className="w-[16%]" />
                <col className="w-[9%]" />
                <col className="w-[9%]" />
                <col className="w-[11%]" />
                <col className="w-[12%]" />
              </colgroup>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('settings.usage.quota.column.source')}</TableHead>
                  <TableHead>{t('settings.usage.quota.column.tier')}</TableHead>
                  <TableHead>{t('settings.usage.quota.column.period')}</TableHead>
                  <TableHead className="text-center">{t('settings.usage.quota.column.limit')}</TableHead>
                  <TableHead className="text-right">{t('settings.usage.quota.column.used')}</TableHead>
                  <TableHead className="text-right">{t('settings.usage.quota.column.remaining')}</TableHead>
                  <TableHead>{t('settings.usage.quota.column.renews')}</TableHead>
                  <TableHead className="text-right">{t('settings.usage.quota.column.forecast')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {poolGroups.flatMap((pool) => {
                  const isExpanded = expandedPools.has(pool.poolId)
                  const sourceCountLabel = t('settings.usage.quota.pool_source_count', { count: pool.rows.length })

                  const poolRow = (
                    <TableRow
                      key={pool.poolId}
                      onClick={() => togglePoolExpanded(pool.poolId)}
                      className="cursor-pointer hover:bg-accent">
                      <TableCell className="min-w-0">
                        <div className="flex min-w-0 items-center gap-2">
                          <ChevronDown
                            className="size-4 flex-shrink-0 transition-transform"
                            style={{ transform: isExpanded ? 'rotate(0)' : 'rotate(-90deg)' }}
                          />
                          <div className="min-w-0">
                            <div className="truncate text-sm font-semibold text-foreground">{pool.providerName}</div>
                            <div className="truncate text-xs text-muted-foreground">{sourceCountLabel}</div>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell />
                      <TableCell />
                      <TableCell>
                        <div className="flex items-center justify-center gap-1">
                          <span className="w-12 text-center font-semibold tabular-nums text-sm">{pool.poolLimit}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-sm font-semibold">{pool.poolUsed}</TableCell>
                      <TableCell className="text-right tabular-nums text-sm">
                        <span className={pool.poolRemaining === 0 ? 'text-error font-semibold' : 'font-semibold'}>
                          {pool.poolRemaining}
                        </span>
                      </TableCell>
                      <TableCell />
                      <TableCell />
                    </TableRow>
                  )

                  const detailRows = isExpanded
                    ? pool.rows.map((row) => (
                        <TableRow key={row.limitKey} className="bg-muted/30">
                          <TableCell className="min-w-0 pl-10">
                            <div className="min-w-0">
                              <div className="truncate text-sm font-medium text-foreground">{row.keyLabel}</div>
                            </div>
                          </TableCell>
                          <TableCell>
                            <span className="text-xs text-muted-foreground">
                              {TIER_LABELS[row.tier] ? t(TIER_LABELS[row.tier]) : row.tier}
                            </span>
                          </TableCell>
                          <TableCell>
                            <span className="text-xs text-muted-foreground">{t(PERIOD_LABELS[row.period])}</span>
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center justify-center gap-1">
                              <Button
                                variant="ghost"
                                size="icon"
                                className="size-6"
                                onClick={() => adjustLimit(row.limitKey, -1)}>
                                <Minus className="size-3" />
                              </Button>
                              <span className="w-12 text-center font-medium tabular-nums text-sm">{row.limit}</span>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="size-6"
                                onClick={() => adjustLimit(row.limitKey, 1)}>
                                <Plus className="size-3" />
                              </Button>
                            </div>
                          </TableCell>
                          <TableCell className="text-right tabular-nums text-sm">{row.used}</TableCell>
                          <TableCell className="text-right tabular-nums text-sm">
                            <span className={row.remaining === 0 ? 'text-error font-medium' : ''}>{row.remaining}</span>
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {row.renewsAt
                              ? row.renewsAt.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
                              : '—'}
                          </TableCell>
                          <TableCell className="text-right text-xs">
                            <span
                              className={
                                row.forecast.kind === 'runs-out' || row.forecast.kind === 'exhausted'
                                  ? 'font-medium text-error'
                                  : 'text-muted-foreground'
                              }>
                              {describeForecast(row.forecast)}
                            </span>
                          </TableCell>
                        </TableRow>
                      ))
                    : []

                  return [poolRow, ...detailRows]
                })}
              </TableBody>
            </Table>
          </div>
        </UsagePanel>
      )}

      {webServiceRows.length > 0 && (
        <UsagePanel>
          <UsagePanelHeader>
            <UsagePanelTitle>{t('settings.usage.quota.web_services')}</UsagePanelTitle>
          </UsagePanelHeader>
          <div className="min-w-0 overflow-x-auto p-3">
            <Table className="table-fixed">
              <colgroup>
                <col className="w-[50%]" />
                <col className="w-[25%]" />
                <col className="w-[25%]" />
              </colgroup>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('settings.usage.quota.column.service')}</TableHead>
                  <TableHead className="text-right">{t('settings.usage.quota.column.used')}</TableHead>
                  <TableHead>{t('settings.usage.quota.column.since')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {webServiceRows.map((row) => (
                  <TableRow key={row.serviceKey}>
                    <TableCell className="text-sm font-medium">{row.label}</TableCell>
                    <TableCell className="text-right tabular-nums text-sm">{row.count}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {row.periodStart > 0
                        ? new Date(row.periodStart).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
                        : '—'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </UsagePanel>
      )}
    </UsageSection>
  )
})
