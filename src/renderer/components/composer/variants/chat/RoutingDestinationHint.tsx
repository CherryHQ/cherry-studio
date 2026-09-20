import { ArrowRight } from 'lucide-react'
import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { NormalTooltip } from '@cherrystudio/ui'
import { useSharedCacheValue } from '@data/hooks/useCache'
import { useQuery } from '@data/hooks/useDataApi'
import { usePreference } from '@data/hooks/usePreference'
import ModelAvatar from '@renderer/components/Avatar/ModelAvatar'
import { getProviderDisplayName, getRemainingQuota } from '@renderer/components/ModelSelector'
import { useModels } from '@renderer/hooks/useModel'
import type { Model, UniqueModelId } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import { EMPTY_DERIVED_ROUTING_TABLE } from '@shared/data/types/routing'
import { periodStartOf, usageStatsFrom } from '@shared/utils/apiKeyLimit'

import { computeRoutingPreview } from './routingPreview'

interface Props {
  promptText: string
  fallbackModel: Model | undefined
  hasMentionedModels: boolean
  providers: Provider[]
}

/**
 * Before-send readout of `routeDefaultModelId`'s decision: silent whenever routing would leave the
 * shown model alone, a compact "→ destination" chip when it would not. Hidden while a stream
 * mid-turn — this is only meaningful for the next message.
 */
export function RoutingDestinationHint({ promptText, fallbackModel, hasMentionedModels, providers }: Props) {
  const { t } = useTranslation()
  const [pinnedModelId] = usePreference('chat.routing.pinned_model')
  const [autoEnabled] = usePreference('chat.routing.auto_enabled')
  const [categoryModels] = usePreference('chat.routing.category_models')
  const [health] = usePreference('chat.retry.model_health')
  const derivedTable = useSharedCacheValue('routing.derived_table') ?? EMPTY_DERIVED_ROUTING_TABLE
  const { models } = useModels()

  const modelById = useMemo(() => new Map(models.map((model) => [model.id, model])), [models])
  const providerById = useMemo(() => new Map(providers.map((provider) => [provider.id, provider])), [providers])
  const modelExists = useCallback(
    (id: UniqueModelId) => providerById.get(modelById.get(id)?.providerId ?? '')?.isEnabled === true,
    [modelById, providerById]
  )

  const preview = useMemo(() => {
    if (!fallbackModel) return undefined
    return computeRoutingPreview({
      promptText,
      fallbackModelId: fallbackModel.id,
      hasMentionedModels,
      autoEnabled,
      pinnedModelId,
      categoryModels,
      derivedTable,
      health,
      modelExists
    })
  }, [
    fallbackModel,
    promptText,
    hasMentionedModels,
    autoEnabled,
    pinnedModelId,
    categoryModels,
    derivedTable,
    health,
    modelExists
  ])

  const destinationModel = preview ? modelById.get(preview.destinationModelId) : undefined
  const destinationProvider = destinationModel ? providerById.get(destinationModel.providerId) : undefined

  const [apiKeyLimits] = usePreference('chat.routing.api_key_limits')
  const quotaStatsParams = useMemo(() => {
    if (!destinationModel || !apiKeyLimits || Object.keys(apiKeyLimits).length === 0) return { enabled: false }
    const periods = [...new Set(Object.values(apiKeyLimits).map((limit) => limit.period))]
    return {
      query: {
        groupBy: 'apiKey' as const,
        metric: 'requests' as const,
        from: usageStatsFrom(periods.map((period) => periodStartOf(period))),
        to: Date.now(),
        limit: 100
      }
    }
  }, [destinationModel, apiKeyLimits])
  const { data: quotaUsageData } = useQuery('/ai-usage-records/stats', quotaStatsParams)

  const quotaUsageCounts = useMemo(() => {
    if (!Array.isArray(quotaUsageData?.buckets)) return undefined
    const counts = new Map<string, number>()
    for (const bucket of quotaUsageData.buckets) {
      if (bucket.groupBy === 'apiKey' && bucket.apiKeyId) counts.set(bucket.apiKeyId, bucket.requestCount)
    }
    return counts
  }, [quotaUsageData])

  const remainingQuota =
    destinationModel && destinationProvider
      ? getRemainingQuota(destinationProvider, destinationModel.id, apiKeyLimits, quotaUsageCounts)
      : undefined

  if (!preview || !destinationModel) return null

  const categoryLabel = preview.category ? t(`settings.models.routing.category.${preview.category}`) : undefined
  const reasonText =
    preview.reason === 'pinned'
      ? t('chat.routing_preview.reason_pinned')
      : preview.reason === 'health_rescue'
        ? t('chat.routing_preview.reason_health', { model: fallbackModel?.name ?? '' })
        : t('chat.routing_preview.reason_category', { category: categoryLabel })

  return (
    <NormalTooltip
      side="top"
      sideOffset={8}
      showArrow={false}
      contentProps={{
        className:
          'w-64 max-w-64 rounded-md border border-border bg-card p-3 text-card-foreground shadow-md dark:bg-card dark:text-card-foreground'
      }}
      content={
        <section className="space-y-1.5 text-xs">
          <h3 className="font-medium text-foreground">{t('chat.routing_preview.title')}</h3>
          <div className="flex items-center gap-1.5 text-foreground">
            <ModelAvatar model={destinationModel} size={16} />
            <span className="min-w-0 truncate">
              {t('chat.routing_preview.destination', {
                model: destinationModel.name,
                provider: destinationProvider ? getProviderDisplayName(destinationProvider) : ''
              })}
            </span>
          </div>
          <p className="text-muted-foreground">{reasonText}</p>
          {remainingQuota !== undefined && (
            <p className="text-muted-foreground">{t('models.quota.remaining', { count: remainingQuota })}</p>
          )}
        </section>
      }>
      <span
        role="status"
        aria-label={t('chat.routing_preview.aria_label', {
          from: fallbackModel?.name ?? '',
          to: destinationModel.name
        })}
        className="flex items-center gap-1 rounded-md px-1 text-muted-foreground text-xs">
        <ArrowRight size={12} aria-hidden />
        <span className="max-w-24 truncate">{destinationModel.name}</span>
      </span>
    </NormalTooltip>
  )
}
