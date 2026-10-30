import { useTranslation } from 'react-i18next'

import {
  type CherryCloudEntitlement,
  getQuotaRecoveryTime,
  getQuotaRemainingPercent,
  getQuotaWindowLabel
} from '@renderer/utils/cherryCloudQuota'

/** Remaining quota per window of a Cherry Cloud entitlement, as progress bars with recovery times. */
export function CherryCloudQuotaUsage({ entitlement }: { entitlement: CherryCloudEntitlement }) {
  const { t, i18n } = useTranslation()

  return entitlement.quota_pools.map((pool) => (
    <div key={pool.allocation_id} className="space-y-3 py-2">
      {pool.windows.map((window) => {
        const label = getQuotaWindowLabel(window, t)
        const remainingPercent = getQuotaRemainingPercent(window)
        const recoversAt = getQuotaRecoveryTime(window)
        return (
          <div key={`${pool.allocation_id}-${window.window_type}-${window.duration_seconds}`}>
            <div className="flex items-baseline justify-between gap-3 text-xs">
              <span className="font-medium">{label}</span>
              <span className="tabular-nums text-muted-foreground">
                {t('settings.subscription.remaining', { percent: remainingPercent })}
              </span>
            </div>
            <div
              className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted"
              role="progressbar"
              aria-label={label}
              aria-valuenow={remainingPercent}
              aria-valuemin={0}
              aria-valuemax={100}>
              <div className="h-full bg-primary" style={{ width: `${remainingPercent}%` }} />
            </div>
            {recoversAt && (
              <p className="mt-1 text-[11px] text-muted-foreground">
                {t('settings.subscription.next_recovery', {
                  time: new Date(recoversAt).toLocaleString(i18n.language)
                })}
              </p>
            )}
          </div>
        )
      })}
    </div>
  ))
}
