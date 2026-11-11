import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { Skeleton } from '@cherrystudio/ui'
import {
  AI_USAGE_CACHE_RATES_DEFAULT_LIMIT_PER_GROUP,
  type AiUsageRecordCacheRateGroup
} from '@shared/data/api/schemas/aiUsageRecords'
import { getPromptCacheUsage } from '@shared/utils/promptCacheUsage'

import { displayModelId } from './usageAnalytics'
import {
  UsageModelAvatar,
  UsagePanel,
  UsagePanelHeader,
  UsagePanelTitle,
  UsageSection,
  UsageSectionHeader,
  UsageSectionTitle
} from './UsageSettingsPrimitives'

export function UsageCacheRatesPanel({
  groups,
  isLoading,
  error
}: {
  groups: AiUsageRecordCacheRateGroup[]
  isLoading: boolean
  error: unknown
}) {
  const { t, i18n } = useTranslation()
  const percent = useMemo(
    () => new Intl.NumberFormat(i18n.resolvedLanguage, { style: 'percent', maximumFractionDigits: 1 }),
    [i18n.resolvedLanguage]
  )
  if (!isLoading && !error && groups.length === 0) return null
  const formatRate = (rate: number | null) => (rate === null ? '—' : percent.format(rate))
  return (
    <UsageSection>
      <UsageSectionHeader>
        <div>
          <UsageSectionTitle>{t('settings.usage.cacheRates.title')}</UsageSectionTitle>
          <p className="mt-1 text-muted-foreground text-xs">
            {t('settings.usage.cacheRates.description', { count: AI_USAGE_CACHE_RATES_DEFAULT_LIMIT_PER_GROUP })}
          </p>
        </div>
      </UsageSectionHeader>
      <UsagePanel>
        <UsagePanelHeader>
          <UsagePanelTitle>
            {t('settings.usage.cacheRates.latestRequests', { count: AI_USAGE_CACHE_RATES_DEFAULT_LIMIT_PER_GROUP })}
          </UsagePanelTitle>
        </UsagePanelHeader>
        {isLoading ? (
          <Skeleton className="m-3 h-20" />
        ) : error ? (
          <p className="p-3 text-error text-sm">{t('common.error')}</p>
        ) : (
          groups.map((group) => (
            <div
              key={`${group.providerId}:${group.modelId}`}
              className="flex flex-col gap-2 border-border border-b p-3 last:border-b-0">
              <div className="flex items-center gap-2">
                <UsageModelAvatar modelId={group.modelId} providerId={group.providerId} />
                <span className="font-medium text-sm">{group.modelName || displayModelId(group.modelId)}</span>
                <span className="text-muted-foreground text-xs">{group.providerName || group.providerId}</span>
              </div>
              <div className="flex flex-wrap gap-1">
                {group.requests.map((request) => {
                  const cacheUsage = getPromptCacheUsage(request)
                  const detail = cacheUsage ? `${cacheUsage.cacheReadTokens}/${cacheUsage.inputTokens}` : '—'
                  return (
                    <span
                      key={request.id}
                      className="rounded bg-background-subtle px-2 py-1 text-xs tabular-nums"
                      title={`${new Date(request.createdAt).toLocaleString(i18n.resolvedLanguage)} · ${formatRate(request.hitRate)} · ${detail}`}>
                      {formatRate(request.hitRate)}
                    </span>
                  )
                })}
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground text-xs">
                <span>
                  {t('settings.usage.cacheRates.average')}: {formatRate(group.averageHitRate)}
                </span>
                <span>
                  {t('settings.usage.cacheRates.averageExcludingZeroHit')}:{' '}
                  {formatRate(group.averageHitRateExcludingZeroHit)}
                </span>
                <span>
                  {t('settings.usage.cacheRates.zeroHitRequests')}: {group.zeroHitRequestCount}
                </span>
              </div>
            </div>
          ))
        )}
      </UsagePanel>
    </UsageSection>
  )
}
