import { ExternalLink, RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@cherrystudio/ui'
import { SettingsContentColumn } from '@renderer/components/SettingsPrimitives'
import { useCherryAccountSession } from '@renderer/hooks/useCherryAccountSession'
import { ipcApi } from '@renderer/ipc'
import { getAppEdition } from '@renderer/utils/appEdition'
import type { CherryCloudAccountPlans } from '@shared/ipc/schemas/cherryCloud'

function accountPortalUrl(): string {
  const configured = import.meta.env.MAIN_VITE_CHERRY_CLOUD_API_ORIGIN?.trim()
  const origin = configured || (import.meta.env.DEV ? 'http://localhost:9084' : 'https://cloud.cherryai.com')
  const url = new URL(origin)
  if (url.hostname === 'cloud-dev.cherryai.com') return 'https://accounts-dev.cherryai.com/account/plans'
  if (url.hostname === 'cloud.cherryai.com') return 'https://accounts.cherryai.com/account/plans'
  return `${url.origin}/account/plans`
}

function percent(used: number, limit: number): number {
  return limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0
}

function formatUnits(
  value: number,
  pool: CherryCloudAccountPlans['entitlements'][number]['quota_pools'][number],
  locale: string
): string {
  if (pool.measurement_kind === 'requests') return new Intl.NumberFormat(locale).format(value)
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: pool.currency ?? 'USD',
    maximumFractionDigits: 6
  }).format(value / 1_000_000)
}

export function SubscriptionSettings() {
  const { t, i18n } = useTranslation()
  const { status, login } = useCherryAccountSession(getAppEdition() === 'global')
  const [plans, setPlans] = useState<CherryCloudAccountPlans | null>(null)
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)

  const load = useCallback(async () => {
    if (status?.phase !== 'signed-in') return
    setLoading(true)
    setFailed(false)
    try {
      setPlans(await ipcApi.request('cherry_cloud.account_plans.get'))
    } catch {
      setFailed(true)
    } finally {
      setLoading(false)
    }
  }, [status?.phase])

  useEffect(() => {
    setPlans(null)
    if (status?.phase === 'signed-in') void load()
  }, [load, status?.phase])

  const activePaid = useMemo(
    () => plans?.entitlements.find((item) => item.state === 'active' && !item.plan.is_free),
    [plans]
  )
  const availablePlan = useMemo(() => plans?.available_plans.find((item) => !item.is_free), [plans])
  const portalUrl = accountPortalUrl()
  const openPortal = () => void ipcApi.request('system.shell.open_website', portalUrl)

  if (status?.phase !== 'signed-in') {
    return (
      <SettingsContentColumn>
        <div className="space-y-4">
          <h2 className="text-[15px] font-semibold">{t('settings.subscription.title')}</h2>
          <div className="rounded-xl border border-border bg-card p-5 text-sm text-muted-foreground">
            <p>{t('settings.subscription.sign_in_required')}</p>
            <Button className="mt-4" onClick={() => void login()}>
              {t('settings.subscription.sign_in')}
            </Button>
          </div>
        </div>
      </SettingsContentColumn>
    )
  }

  return (
    <SettingsContentColumn>
      <div className="space-y-6">
        <h2 className="text-[15px] font-semibold">{t('settings.subscription.title')}</h2>
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <p className="text-sm font-medium">
                {activePaid?.plan.display_name ?? availablePlan?.display_name ?? t('settings.subscription.no_plan')}
              </p>
              {activePaid?.plan.subscription_price && (
                <p className="mt-1 text-xs text-muted-foreground">
                  {activePaid.plan.subscription_price.product_name} ·{' '}
                  {activePaid.plan.subscription_price.currency.toUpperCase()}{' '}
                  {activePaid.plan.subscription_price.unit_amount / 100} / {activePaid.plan.subscription_price.interval}
                </p>
              )}
            </div>
            <Button variant="outline" size="sm" onClick={openPortal}>
              {activePaid ? t('settings.subscription.manage') : t('settings.subscription.subscribe')}
              <ExternalLink />
            </Button>
          </div>
        </div>
        <div>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-medium">{t('settings.subscription.usage')}</h3>
            <button type="button" className="text-xs text-link hover:underline" onClick={openPortal}>
              {t('settings.subscription.details')} ↗
            </button>
          </div>
          <div className="rounded-xl border border-border bg-card p-4">
            {loading ? (
              <p className="py-6 text-center text-sm text-muted-foreground">{t('settings.subscription.loading')}</p>
            ) : failed ? (
              <div className="py-4 text-center">
                <p className="text-sm text-destructive">{t('settings.subscription.load_failed')}</p>
                <Button variant="outline" size="sm" className="mt-3" onClick={() => void load()}>
                  <RefreshCw />
                  {t('common.retry')}
                </Button>
              </div>
            ) : activePaid?.quota_pools.length ? (
              activePaid.quota_pools.map((pool) => (
                <div key={pool.allocation_id} className="space-y-3 py-2">
                  {pool.windows.map((window) => {
                    const used = window.used_units + window.active_reserved_units
                    const value = percent(used, window.limit_units)
                    return (
                      <div key={`${pool.allocation_id}-${window.window_type}-${window.duration_seconds}`}>
                        <div className="flex items-baseline justify-between gap-3 text-xs">
                          <span>
                            {pool.display_name} ·{' '}
                            {window.window_type === 'calendar_day'
                              ? t('settings.subscription.daily')
                              : t('settings.subscription.duration', {
                                  duration: Math.round(window.duration_seconds / 3600)
                                })}
                          </span>
                          <span className="tabular-nums text-muted-foreground">
                            {formatUnits(used, pool, i18n.language)} /{' '}
                            {formatUnits(window.limit_units, pool, i18n.language)} ({value}%)
                          </span>
                        </div>
                        <div
                          className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted"
                          role="progressbar"
                          aria-valuenow={value}
                          aria-valuemin={0}
                          aria-valuemax={100}>
                          <div className="h-full bg-primary" style={{ width: `${value}%` }} />
                        </div>
                        {window.next_recovery_at && (
                          <p className="mt-1 text-[11px] text-muted-foreground">
                            {t('settings.subscription.next_recovery', {
                              time: new Date(window.next_recovery_at).toLocaleString(i18n.language)
                            })}
                          </p>
                        )}
                      </div>
                    )
                  })}
                </div>
              ))
            ) : (
              <p className="py-6 text-center text-sm text-muted-foreground">
                {activePaid ? t('settings.subscription.no_quota') : t('settings.subscription.subscribe_hint')}
              </p>
            )}
          </div>
        </div>
      </div>
    </SettingsContentColumn>
  )
}
