import { Minus, Plus } from 'lucide-react'
import { memo, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { Button, EmptyState, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@cherrystudio/ui'
import { useQuery } from '@data/hooks/useDataApi'
import { usePreference } from '@data/hooks/usePreference'
import { useProviders } from '@renderer/hooks/useProvider'
import type { ApiKeyLimitPeriod, ServiceUsageMap } from '@shared/data/preference/preferenceTypes'
import type { RuntimeApiKey } from '@shared/data/types/provider'
import { periodRenewsAt, periodStartOf } from '@shared/utils/apiKeyLimit'

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
  free: 'Free',
  paid: 'Paid',
  trial: 'Trial'
}

export const QuotaOverviewTable = memo(function QuotaOverviewTable() {
  const { t } = useTranslation()
  const { providers } = useProviders()
  const [limits, setLimits] = usePreference('chat.routing.api_key_limits')
  const [serviceUsage] = usePreference('chat.routing.service_usage')
  const safeLimits = limits ?? {}
  const safeServiceUsage: ServiceUsageMap = serviceUsage ?? {}

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
    }> = []

    for (const [limitKey, value] of Object.entries(safeLimits)) {
      const parts = limitKey.split('::')
      if (parts.length < 2) continue
      const providerId = parts[0]
      const keyId = parts[1]

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
        renewalTimezone: key?.renewalTimezone
      })
    }

    return entries
  }, [safeLimits, providers])

  const periodStarts = useMemo(() => {
    const starts = new Map<ApiKeyLimitPeriod, number>()
    for (const entry of allKeyEntries) {
      if (!starts.has(entry.period)) {
        starts.set(entry.period, periodStartOf(entry.period, entry.renewalAnchor, entry.renewalTimezone))
      }
    }
    return starts
  }, [allKeyEntries])

  const periods = useMemo(() => [...new Set(allKeyEntries.map((e) => e.period))], [allKeyEntries])

  const statsParams = useMemo(() => {
    if (periods.length === 0) return undefined
    const minFrom = Math.min(...periods.map((p) => periodStarts.get(p) ?? 0))
    return {
      query: {
        groupBy: 'apiKey' as const,
        metric: 'requests' as const,
        from: minFrom,
        to: Date.now(),
        limit: 100
      }
    }
  }, [periods, periodStarts])

  const { data: usageData } = useQuery('/ai-usage-records/stats', statsParams)

  const usageCounts = useMemo(() => {
    const counts = new Map<string, number>()
    if (!usageData) return counts
    for (const bucket of usageData.buckets) {
      if (bucket.groupBy === 'apiKey' && bucket.apiKeyId) {
        counts.set(bucket.apiKeyId, bucket.requestCount)
      }
    }
    return counts
  }, [usageData])

  const rows: QuotaRow[] = useMemo(
    () =>
      allKeyEntries.map((entry) => {
        const used = usageCounts.get(entry.keyId) ?? 0
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
          renewsAt: renewMs !== null ? new Date(renewMs) : null
        }
      }),
    [allKeyEntries, usageCounts]
  )

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
                <col className="w-[28%]" />
                <col className="w-[10%]" />
                <col className="w-[12%]" />
                <col className="w-[18%]" />
                <col className="w-[10%]" />
                <col className="w-[10%]" />
                <col className="w-[12%]" />
              </colgroup>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('settings.usage.groupBy.apiKey')}</TableHead>
                  <TableHead>{t('settings.provider.api_key.tier_label') || 'Tier'}</TableHead>
                  <TableHead>{t('settings.provider.api_key.quota_limit')}</TableHead>
                  <TableHead className="text-center">{t('settings.provider.api_key.quota_limit')}</TableHead>
                  <TableHead className="text-right">{t('settings.usage.cards.totalRequests')}</TableHead>
                  <TableHead className="text-right">
                    {t('settings.usage.quota.remaining')?.replace('{{count}} ', '') || 'Left'}
                  </TableHead>
                  <TableHead>
                    {t('settings.provider.api_key.quota_renews_at')?.replace(' {{date}}', '') || 'Renews'}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.limitKey}>
                    <TableCell className="min-w-0">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium text-foreground">{row.providerName}</div>
                        <div className="truncate text-xs text-muted-foreground">{row.keyLabel}</div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <span className="text-xs text-muted-foreground">{TIER_LABELS[row.tier] ?? row.tier}</span>
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
                  </TableRow>
                ))}
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
                  <TableHead>Service</TableHead>
                  <TableHead className="text-right">{t('settings.usage.cards.totalRequests')}</TableHead>
                  <TableHead>Since</TableHead>
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
