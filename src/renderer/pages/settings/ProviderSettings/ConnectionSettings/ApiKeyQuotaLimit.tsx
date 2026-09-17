// Free tiers the provider never reports: the ceiling is declared here, and credential selection
// skips a key that already reached it. Empty means unlimited, which is the default.

import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { InputNumber } from '@cherrystudio/ui'
import { useQuery } from '@data/hooks/useDataApi'
import { usePreference } from '@data/hooks/usePreference'
import Selector from '@renderer/components/Selector'
import { apiKeyLimitId } from '@shared/utils/apiKeyLimit'

const DAY_MS = 24 * 60 * 60 * 1000
const PERIOD_TO_MS = { daily: DAY_MS, monthly: 30 * DAY_MS } as const

interface Props {
  providerId: string
  keyId: string
}

export const ApiKeyQuotaLimit = ({ providerId, keyId }: Props) => {
  const { t } = useTranslation()
  const [storedLimits, setLimits] = usePreference('chat.routing.api_key_limits')
  // Preferences read as null until the store hydrates, and this drawer renders before that.
  const limits = storedLimits ?? {}
  const entry = limits[apiKeyLimitId(providerId, keyId)]

  const now = Date.now()
  const statsParams = useMemo(
    () =>
      entry
        ? {
            query: {
              groupBy: 'apiKey' as const,
              metric: 'requests' as const,
              from: now - PERIOD_TO_MS[entry.period],
              to: now,
              limit: 50
            }
          }
        : undefined,
    // Recompute only when the limit entry changes, not on every render tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [entry?.period, entry?.limit]
  )

  const { data: usageData } = useQuery('/ai-usage-records/stats', statsParams)
  const usedCount = usageData?.buckets.find((b) => b.groupBy === 'apiKey' && b.apiKeyId === keyId)?.requestCount ?? 0

  const update = (next: { limit: number; period: 'daily' | 'monthly' } | undefined) => {
    const id = apiKeyLimitId(providerId, keyId)
    const { [id]: _removed, ...rest } = limits
    void setLimits(next ? { ...rest, [id]: next } : rest)
  }

  return (
    <div className="flex flex-col gap-1 px-4 pb-2">
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
            { value: 'monthly', label: t('settings.provider.api_key.quota_monthly') }
          ]}
          onChange={(period: 'daily' | 'monthly') => entry && update({ limit: entry.limit, period })}
        />
      </div>
      {entry && (
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
      )}
    </div>
  )
}
