import { ExternalLink, RefreshCw } from 'lucide-react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { Button, Skeleton } from '@cherrystudio/ui'
import { CherryCloudQuotaUsage } from '@renderer/components/CherryCloudQuotaUsage'
import { useCherryCloudPlans } from '@renderer/hooks/useCherryCloudPlans'
import { openCherryCloudAccountPortal } from '@renderer/services/cherryCloudAccountPortal'
import { startCherryCloudSubscription } from '@renderer/services/cherryCloudSubscription'

export function SubscriptionSettings() {
  const { t } = useTranslation()
  const {
    session: { status, loadState, login, cancelLogin, isAuthorizing, isCancellingLogin },
    plansQuery: { data: plans, error, isLoading: loading, mutate },
    activePaid
  } = useCherryCloudPlans()
  const failed = Boolean(error)

  const availablePlan = useMemo(() => plans?.available_plans.find((item) => !item.is_free), [plans])

  if (status?.phase !== 'signed-in') {
    // Placeholders until the first status arrives, so a signed-in user never sees the sign-in prompt flash.
    const statusPending = !status && loadState === 'loading'
    return (
      <div className="space-y-6">
        <h3 className="text-[15px] font-semibold">{t('settings.subscription.title')}</h3>
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="flex items-center justify-between gap-4">
            {statusPending ? (
              <>
                <div className="min-w-0 flex-1" aria-busy="true">
                  <div className="flex h-5 items-center">
                    <Skeleton className="h-3.5 w-24" />
                  </div>
                  <div className="mt-1 flex h-4 items-center">
                    <Skeleton className="h-3 w-64 max-w-full" />
                  </div>
                </div>
                <Skeleton className="h-7 w-16" />
              </>
            ) : (
              <>
                <div className="min-w-0">
                  <p className="text-sm font-medium">{t('settings.subscription.signed_out')}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{t('settings.subscription.sign_in_hint')}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {isAuthorizing && (
                    <Button variant="ghost" size="sm" disabled={isCancellingLogin} onClick={() => void cancelLogin()}>
                      {t('common.cancel')}
                    </Button>
                  )}
                  <Button variant="outline" size="sm" loading={isAuthorizing} onClick={() => void login()}>
                    {t(isAuthorizing ? 'settings.provider.cherry_cloud.signing_in' : 'settings.subscription.sign_in')}
                  </Button>
                </div>
              </>
            )}
          </div>
        </div>
        <div>
          <h3 className="mb-2 text-sm font-medium">{t('settings.subscription.usage')}</h3>
          <div className="rounded-xl border border-border bg-card p-4">
            <div className="flex items-center justify-center py-6">
              <div className="flex h-5 items-center text-sm text-muted-foreground">
                {statusPending ? <Skeleton className="h-3 w-36" /> : t('settings.subscription.sign_in_usage')}
              </div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <h3 className="text-[15px] font-semibold">{t('settings.subscription.title')}</h3>
      <div className="rounded-xl border border-border bg-card p-4">
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="text-sm font-medium">
              {activePaid?.plan.display_name ?? availablePlan?.display_name ?? t('settings.subscription.no_plan')}
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void (activePaid ? openCherryCloudAccountPortal() : startCherryCloudSubscription())}>
            {activePaid ? t('settings.subscription.manage') : t('settings.subscription.subscribe')}
            <ExternalLink />
          </Button>
        </div>
      </div>
      <div>
        <h3 className="mb-2 text-sm font-medium">{t('settings.subscription.usage')}</h3>
        <div className="rounded-xl border border-border bg-card p-4">
          {loading ? (
            <p className="py-6 text-center text-sm text-muted-foreground">{t('settings.subscription.loading')}</p>
          ) : failed ? (
            <div className="py-4 text-center">
              <p className="text-sm text-destructive">{t('settings.subscription.load_failed')}</p>
              <Button variant="outline" size="sm" className="mt-3" onClick={() => void mutate()}>
                <RefreshCw />
                {t('common.retry')}
              </Button>
            </div>
          ) : activePaid?.quota_pools.length ? (
            <CherryCloudQuotaUsage entitlement={activePaid} />
          ) : (
            <p className="py-6 text-center text-sm text-muted-foreground">
              {activePaid ? t('settings.subscription.no_quota') : t('settings.subscription.subscribe_hint')}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
