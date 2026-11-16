import type { TFunction } from 'i18next'

import { CHERRY_CLOUD_PROVIDER_ID } from '@shared/data/presets/cherryai'
import { parseUniqueModelId } from '@shared/data/types/model'
import type { CherryCloudAccountPlans, CherryCloudAccountReceipt } from '@shared/ipc/schemas/cherryCloud'

export type CherryCloudEntitlement = CherryCloudAccountPlans['entitlements'][number]
export type CherryCloudQuotaPool = CherryCloudEntitlement['quota_pools'][number]
export type CherryCloudQuotaWindow = CherryCloudQuotaPool['windows'][number]

/** Server-reported remaining quota, rounded down to two decimal places. */
export function getQuotaRemainingPercent(window: CherryCloudQuotaWindow): number {
  if (window.limit_units <= 0) return 0
  const remaining = window.remaining_units / window.limit_units
  return Math.min(100, Math.max(0, Math.floor(remaining * 10_000) / 100))
}

export function formatQuotaPercent(percent: number): string {
  return percent.toFixed(2)
}

export function getQuotaPoolDisplay(
  entitlement: CherryCloudEntitlement,
  pool: CherryCloudQuotaPool,
  receipt: CherryCloudAccountReceipt
): {
  exhausted: boolean
  snapshotOutOfDate: boolean
  remainingPercent: number | undefined
} {
  const exhausted =
    entitlement.state === 'active' &&
    receipt.models.freshness === 'fresh' &&
    receipt.models.value.quotaExhaustedModelIds.some((id) => {
      const { providerId, modelId } = parseUniqueModelId(id)
      return providerId === CHERRY_CLOUD_PROVIDER_ID && pool.model_ids.includes(modelId)
    })
  const percents = pool.windows.map(getQuotaRemainingPercent)
  return {
    exhausted,
    snapshotOutOfDate: exhausted && pool.windows.some((window) => window.remaining_units > 0),
    remainingPercent: exhausted ? 0 : percents.length > 0 ? Math.min(...percents) : undefined
  }
}

/** The tightest pool decides how much of the plan is left. */
export function getLowestRemainingPercent(
  entitlement: CherryCloudEntitlement,
  receipt: CherryCloudAccountReceipt
): number | undefined {
  const percents = entitlement.quota_pools.flatMap((pool) => {
    const { remainingPercent } = getQuotaPoolDisplay(entitlement, pool, receipt)
    return remainingPercent === undefined ? [] : [remainingPercent]
  })
  return percents.length > 0 ? Math.min(...percents) : undefined
}

/** When the window's quota comes back on its own; a paid subscription month only renews after payment. */
export function getQuotaRecoveryTime(window: CherryCloudQuotaWindow): string | undefined {
  return window.next_recovery_at
}

export function getQuotaWindowLabel(window: CherryCloudQuotaWindow, t: TFunction): string {
  if (window.window_type === 'subscription_month') return t('settings.subscription.limit_subscription_month')
  if (window.window_type === 'calendar_day') return t('settings.subscription.limit_daily')
  if (window.duration_seconds === 7 * 24 * 60 * 60) return t('settings.subscription.limit_weekly')
  if (window.duration_seconds % (24 * 60 * 60) === 0) {
    return t('settings.subscription.limit_days', { count: window.duration_seconds / (24 * 60 * 60) })
  }
  return t('settings.subscription.limit_hours', { count: Math.max(1, Math.round(window.duration_seconds / 3600)) })
}

/** The line under a quota window, worded as the web account page words it. */
export function getQuotaWindowNote(window: CherryCloudQuotaWindow, t: TFunction, language: string): string {
  const format = (value: string) =>
    new Intl.DateTimeFormat(language, {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    }).format(new Date(value))
  if (window.window_type === 'subscription_month') {
    return window.period_end
      ? t('settings.subscription.subscription_month_ends', { time: format(window.period_end) })
      : t('settings.subscription.subscription_month_period')
  }
  if (window.window_type === 'calendar_day') return t('settings.subscription.daily_reset')
  if (window.next_recovery_at)
    return t('settings.subscription.next_recovery', { time: format(window.next_recovery_at) })
  return t('settings.subscription.no_recovery')
}
