import { useTranslation } from 'react-i18next'

import {
  type CherryCloudEntitlement,
  formatQuotaPercent,
  getQuotaPoolDisplay,
  getQuotaRemainingPercent,
  getQuotaWindowLabel,
  getQuotaWindowNote
} from '@renderer/utils/cherryCloudQuota'
import type { CherryCloudAccountReceipt } from '@shared/ipc/schemas/cherryCloud'

/** Remaining quota per window of a Cherry Cloud entitlement, as progress bars with recovery times. */
export function CherryCloudQuotaUsage({
  entitlement,
  receipt
}: {
  entitlement: CherryCloudEntitlement
  receipt: CherryCloudAccountReceipt
}) {
  const { t, i18n } = useTranslation()

  return entitlement.quota_pools.map((pool) => {
    const display = getQuotaPoolDisplay(entitlement, pool, receipt)
    return (
      <div key={pool.allocation_id} className="space-y-3 py-2">
        {display.exhausted && <p className="text-xs text-destructive">{t('models.detail.quota_exhausted')}</p>}
        {display.snapshotOutOfDate && (
          <p className="text-xs text-muted-foreground">{t('settings.subscription.quota_out_of_date')}</p>
        )}
        {pool.windows.map((window) => {
          const label = getQuotaWindowLabel(window, t)
          const remainingPercent = display.exhausted ? 0 : getQuotaRemainingPercent(window)
          return (
            <div key={`${pool.allocation_id}-${window.window_type}-${window.duration_seconds}`}>
              <div className="flex items-baseline justify-between gap-3 text-xs">
                <span className="font-medium">{label}</span>
                <span className="tabular-nums text-muted-foreground">
                  {t('settings.subscription.remaining', { percent: formatQuotaPercent(remainingPercent) })}
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
              <p className="mt-1 text-[11px] text-muted-foreground">{getQuotaWindowNote(window, t, i18n.language)}</p>
            </div>
          )
        })}
      </div>
    )
  })
}
