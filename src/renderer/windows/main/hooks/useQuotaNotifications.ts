import { useEffect, useEffectEvent } from 'react'
import { useTranslation } from 'react-i18next'

import { useQuery } from '@data/hooks/useDataApi'
import { usePreference } from '@data/hooks/usePreference'
import { useProviders } from '@renderer/hooks/useProvider'
import { toast } from '@renderer/services/toast'
import { AI_USAGE_RECORD_AGGREGATE_MAX_LIMIT } from '@shared/data/api/schemas/aiUsageRecords'
import { dueQuotaNotices, type QuotaNoticeInput, usageStatsFrom } from '@shared/utils/apiKeyLimit'

/** The smallest declared period is daily, so this only needs to catch a midnight rollover while
 *  the app sits open — reopening the app after being closed is covered by the immediate check below. */
const CHECK_INTERVAL_MS = 30 * 60 * 1000

/**
 * A `'total'`-period key never resets, so "used so far" has to mean "ever" — but the stats
 * endpoint caps any query to a 366-day span. A trial worth watching for exhaustion is used up
 * long before a year passes, so this window undercounts only in the one case (a key active for
 * over a year) where being late is harmless.
 */

/**
 * Surfaces two quota events the usage settings page otherwise only shows if you go looking for
 * them: a declared limit's period rolling over, and a one-shot trial key running dry. Main-only,
 * twin of useAutoBackupEvents — the already-announced bookkeeping lives in a synced Preference so
 * it survives a restart and never repeats for the same event.
 */
export function useQuotaNotifications(): void {
  const { t } = useTranslation()
  const { providers } = useProviders()
  const [limits] = usePreference('chat.routing.api_key_limits')
  const [noticeState, setNoticeState] = usePreference('chat.routing.quota_notice_state')
  const safeLimits = limits ?? {}
  const safeState = noticeState ?? {}

  const findKey = (limitKey: string) => {
    const [providerId, keyId] = limitKey.split('::')
    const provider = providers.find((p) => p.id === providerId)
    return { provider, providerId, keyId, key: provider?.apiKeys.find((k) => k.id === keyId) }
  }

  const hasTrialTotalEntry = Object.entries(safeLimits).some(
    ([limitKey, entry]) => entry.period === 'total' && findKey(limitKey).key?.tier === 'trial'
  )

  const { data: usageData } = useQuery(
    '/ai-usage-records/stats',
    hasTrialTotalEntry
      ? {
          query: {
            groupBy: 'apiKey' as const,
            metric: 'requests' as const,
            from: usageStatsFrom([]),
            to: Date.now(),
            limit: AI_USAGE_RECORD_AGGREGATE_MAX_LIMIT
          }
        }
      : { enabled: false }
  )

  const check = useEffectEvent(() => {
    const keys: QuotaNoticeInput[] = Object.entries(safeLimits).map(([limitKey, entry]) => {
      const { keyId, key } = findKey(limitKey)
      const used = usageData?.buckets.find((b) => b.groupBy === 'apiKey' && b.apiKeyId === keyId)?.requestCount ?? 0
      return {
        limitKey,
        period: entry.period,
        limit: entry.limit,
        used,
        tier: key?.tier ?? 'free',
        renewalAnchor: key?.renewalAnchor,
        renewalTimezone: key?.renewalTimezone
      }
    })

    const { notices, nextState } = dueQuotaNotices(keys, safeState)

    for (const notice of notices) {
      const { provider, providerId, keyId, key } = findKey(notice.limitKey)
      const label = t('settings.usage.quota.key_label', {
        provider: provider?.name ?? providerId,
        label: key?.label ?? keyId.slice(0, 8)
      })

      if (notice.kind === 'new_period') {
        toast.info({
          title: t('notification.quota.new_period.title'),
          description: t('notification.quota.new_period.description', { key: label })
        })
      } else {
        toast.warning({
          title: t('notification.quota.trial_exhausted.title'),
          description: t('notification.quota.trial_exhausted.description', { key: label })
        })
      }
    }

    if (JSON.stringify(nextState) !== JSON.stringify(safeState)) {
      void setNoticeState(nextState)
    }
  })

  useEffect(() => {
    check()
    const id = setInterval(check, CHECK_INTERVAL_MS)
    return () => clearInterval(id)
  }, [check])
}
