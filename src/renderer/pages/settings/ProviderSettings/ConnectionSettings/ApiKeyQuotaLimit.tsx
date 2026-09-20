// Free tiers the provider never reports: the ceiling is declared here, and credential selection
// skips a key that already reached it. Empty means unlimited, which is the default.

import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { InputNumber } from '@cherrystudio/ui'
import { useQuery } from '@data/hooks/useDataApi'
import { usePreference } from '@data/hooks/usePreference'
import Selector from '@renderer/components/Selector'
import { useModels } from '@renderer/hooks/useModel'
import { useProvider } from '@renderer/hooks/useProvider'
import { AI_USAGE_RECORD_AGGREGATE_MAX_LIMIT } from '@shared/data/api/schemas/aiUsageRecords'
import type { ApiKeyLimitPeriod } from '@shared/data/preference/preferenceTypes'
import type { UniqueModelId } from '@shared/data/types/model'
import type { ApiKeyTier } from '@shared/data/types/provider'
import {
  apiKeyLimitId,
  apiKeyModelLimitId,
  collectKeyUsage,
  periodRenewsAt,
  periodStartOf,
  usageAgainstLimit
} from '@shared/utils/apiKeyLimit'

const ALL_MODELS = 'all' as const

interface Props {
  providerId: string
  keyId: string
  /** Pins the widget to one model instead of letting it be chosen here. */
  modelId?: UniqueModelId
}

export const ApiKeyQuotaLimit = ({ providerId, keyId, modelId }: Props) => {
  const { t } = useTranslation()
  const [storedLimits, setLimits] = usePreference('chat.routing.api_key_limits')
  // Preferences read as null until the store hydrates, and this drawer renders before that.
  const limits = storedLimits ?? {}

  // A free tier often meters each model separately, so the ceiling can be scoped to one of them.
  // Without this the model-scoped limit the runtime already honours had no way to be written.
  const { models } = useModels({ providerId })
  const [pickedModelId, setPickedModelId] = useState<UniqueModelId | typeof ALL_MODELS>(modelId ?? ALL_MODELS)
  const scopedModelId = modelId ?? (pickedModelId === ALL_MODELS ? undefined : pickedModelId)

  const limitKey = scopedModelId
    ? apiKeyModelLimitId(providerId, keyId, scopedModelId)
    : apiKeyLimitId(providerId, keyId)
  const entry = limits[limitKey]

  const { provider, updateApiKey } = useProvider(providerId)
  const apiKey = provider?.apiKeys.find((k) => k.id === keyId)
  const tier: ApiKeyTier = apiKey?.tier ?? 'free'
  const anchor = apiKey?.renewalAnchor
  const timezone = apiKey?.renewalTimezone

  const now = Date.now()
  const statsParams = useMemo(
    () =>
      // A key with no declared ceiling has nothing to count, and `useQuery` fetches unless told
      // otherwise — so the no-entry branch must disable rather than pass `undefined`.
      entry
        ? {
            query: {
              // Grouped per (key, model) so a model-scoped ceiling is measured against that
              // model's own traffic; the key-scoped total is the sum over its models.
              groupBy: 'apiKeyModel' as const,
              metric: 'requests' as const,
              from: periodStartOf(entry.period, anchor, timezone),
              to: now,
              limit: AI_USAGE_RECORD_AGGREGATE_MAX_LIMIT
            }
          }
        : { enabled: false },
    // Recompute only when the limit entry changes, not on every render tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [entry?.period, entry?.limit, anchor, timezone]
  )

  const { data: usageData } = useQuery('/ai-usage-records/stats', statsParams)
  // Unknown spend (the response was truncated) reads as 0 here: this widget shows what was counted,
  // and inventing a larger number would tell the user they have less room than anyone can prove.
  const usedCount = usageAgainstLimit(collectKeyUsage(usageData?.buckets, usageData?.other), keyId, scopedModelId) ?? 0

  const renewsAt = useMemo(() => {
    if (!entry) return null
    const ms = periodRenewsAt(entry.period, anchor, timezone)
    return ms !== null ? new Date(ms) : null
  }, [entry?.period, anchor, timezone])

  /** Stored as a full ISO date because only its day-of-month / weekday is read back. */
  const anchorDay = anchor ? new Date(anchor).getUTCDate() : null
  const setAnchorDay = (day: number | null) => {
    const iso = day ? new Date(Date.UTC(2024, 0, Math.min(day, 28))).toISOString().slice(0, 10) : ''
    void updateApiKey(keyId, { renewalAnchor: iso })
  }

  const update = (next: { limit: number; period: ApiKeyLimitPeriod } | undefined) => {
    const { [limitKey]: _removed, ...rest } = limits
    void setLimits(next ? { ...rest, [limitKey]: next } : rest)
  }

  return (
    <div className="flex flex-col gap-1 px-4 pb-2">
      {!modelId && models.length > 0 && (
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground text-xs">{t('settings.provider.api_key.quota_scope')}</span>
          <Selector
            value={pickedModelId}
            options={[
              { value: ALL_MODELS, label: t('settings.provider.api_key.quota_scope_all') },
              ...models.map((model) => ({ value: model.id, label: model.name }))
            ]}
            onChange={(next: UniqueModelId | typeof ALL_MODELS) => setPickedModelId(next)}
          />
        </div>
      )}
      <div className="flex items-center gap-2">
        <span className="text-muted-foreground text-xs">{t('settings.provider.api_key.quota_limit')}</span>
        <div className="w-[110px]">
          <InputNumber
            min={1}
            step={1}
            className="h-7 rounded-lg px-2"
            placeholder={t('settings.provider.api_key.quota_unlimited')}
            aria-label={t('settings.provider.api_key.quota_limit')}
            value={entry?.limit ?? null}
            onBlur={(value) => update(value ? { limit: value, period: entry?.period ?? 'daily' } : undefined)}
          />
        </div>
        <Selector
          value={entry?.period ?? 'daily'}
          options={[
            { value: 'daily', label: t('settings.provider.api_key.quota_daily') },
            { value: 'weekly', label: t('settings.provider.api_key.quota_weekly') },
            { value: 'monthly', label: t('settings.provider.api_key.quota_monthly') },
            { value: 'total', label: t('settings.provider.api_key.quota_total') }
          ]}
          onChange={(period: ApiKeyLimitPeriod) => entry && update({ limit: entry.limit, period })}
        />
      </div>
      <div className="flex items-center gap-2">
        <span className="text-muted-foreground text-xs">{t('settings.provider.api_key.tier_label')}</span>
        <Selector
          value={tier}
          options={[
            { value: 'free', label: t('settings.usage.quota.tier.free') },
            { value: 'paid', label: t('settings.usage.quota.tier.paid') },
            { value: 'trial', label: t('settings.usage.quota.tier.trial') }
          ]}
          onChange={(next: ApiKeyTier) => void updateApiKey(keyId, { tier: next })}
        />
        {entry && entry.period === 'monthly' && (
          <>
            <span className="text-muted-foreground text-xs">{t('settings.provider.api_key.renewal_day')}</span>
            <div className="w-[90px]">
              <InputNumber
                min={1}
                max={28}
                step={1}
                className="h-7 rounded-lg px-2"
                placeholder={t('settings.provider.api_key.renewal_day_placeholder')}
                aria-label={t('settings.provider.api_key.renewal_day')}
                value={anchorDay}
                onBlur={(value) => setAnchorDay(value)}
              />
            </div>
          </>
        )}
      </div>
      {entry && (
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground text-xs">
              {t('settings.provider.api_key.quota_used', { used: usedCount, limit: entry.limit })}
            </span>
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary transition-all"
                style={{ width: `${Math.min(100, (usedCount / entry.limit) * 100)}%` }}
              />
            </div>
          </div>
          {renewsAt && (
            <span className="text-muted-foreground text-xs">
              {t('settings.provider.api_key.quota_renews_at', {
                date: renewsAt.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
              })}
            </span>
          )}
        </div>
      )}
    </div>
  )
}
