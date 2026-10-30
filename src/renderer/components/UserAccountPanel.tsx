import { ChevronRight, CreditCard, Gauge, LogIn, RotateCcw, Settings } from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import useSWR from 'swr'

import { Avatar, AvatarImage, Button, ColFlex, EmojiAvatar } from '@cherrystudio/ui'
import { usePreference } from '@data/hooks/usePreference'
import { CommandShortcut } from '@renderer/components/command'
import useAvatar from '@renderer/hooks/useAvatar'
import { useCherryAccountSession } from '@renderer/hooks/useCherryAccountSession'
import { ipcApi } from '@renderer/ipc'
import { openCherryCloudAccountPortal } from '@renderer/services/cherryCloudAccountPortal'
import { openSettingsTab } from '@renderer/services/mainWindowNavigation'
import { getAppEdition } from '@renderer/utils/appEdition'
import { isEmoji } from '@renderer/utils/naming'

import { AppearanceMenu } from './layout/AppearanceMenu'
import UserPopup from './UserPopup'

export function UserAccountPanel({ onRequestClose, children }: { onRequestClose?: () => void; children?: ReactNode }) {
  const [userName] = usePreference('app.user.name')
  const { t } = useTranslation()
  const avatar = useAvatar()
  const {
    status: cloudStatus,
    loadState: cloudStatusLoadState,
    reload: loadCloudStatus,
    login: handleCloudLogin,
    cancelLogin: handleCloudLoginCancel,
    isCancellingLogin,
    isAuthorizing
  } = useCherryAccountSession()
  const isGlobalEdition = getAppEdition() === 'global'
  const isCloudSignedIn = cloudStatus?.phase === 'signed-in'

  const accountId = isCloudSignedIn ? cloudStatus.accountId : null
  const {
    data: plans,
    error: plansError,
    mutate: reloadPlans
  } = useSWR(
    isGlobalEdition && accountId ? ['cherry-cloud/account-plans', accountId] : null,
    () => ipcApi.request('cherry_cloud.account_plans.get'),
    { shouldRetryOnError: false }
  )

  const handleOpenAccountDetails = () => {
    onRequestClose?.()
    if (isGlobalEdition) {
      openSettingsTab('/settings/profile')
    } else {
      void UserPopup.show()
    }
  }

  const handleOpenSettings = () => {
    onRequestClose?.()
    openSettingsTab()
  }

  const activePaidPlan = plans?.entitlements.find((item) => item.state === 'active' && !item.plan.is_free)
  const paidPlanName = activePaidPlan?.plan.display_name
  const quotaWindows = activePaidPlan?.quota_pools.flatMap((pool) => pool.windows) ?? []
  const remainingPercent = quotaWindows.length
    ? Math.min(
        ...quotaWindows.map((window) =>
          window.limit_units > 0 ? Math.min(100, Math.round((window.remaining_units / window.limit_units) * 100)) : 0
        )
      )
    : null
  const cloudSubtitle = isCloudSignedIn
    ? paidPlanName || cloudStatus.displayName || t('settings.provider.cherry_cloud.logged_in')
    : isAuthorizing
      ? t('settings.provider.cherry_cloud.signing_in')
      : cloudStatusLoadState === 'error'
        ? t('error.http.503')
        : null
  const cloudSubtitleRole =
    isCloudSignedIn || isAuthorizing ? 'status' : cloudStatusLoadState === 'error' ? 'alert' : undefined
  const accountDisplayName = userName || t('settings.profile.title')
  const subscriptionLoading =
    cloudStatusLoadState === 'loading' || isAuthorizing || (isCloudSignedIn && !plans && !plansError)
  const subscriptionFailed = cloudStatusLoadState === 'error' || (isCloudSignedIn && plansError && !plans)
  const subscriptionAction = subscriptionLoading
    ? t('common.loading')
    : subscriptionFailed
      ? t('common.retry')
      : paidPlanName
        ? remainingPercent === null
          ? t('settings.subscription.no_quota')
          : t('settings.subscription.remaining', { percent: remainingPercent })
        : t('settings.subscription.go_to_subscribe')
  const handleSubscriptionClick = () => {
    if (cloudStatusLoadState === 'error') {
      void loadCloudStatus()
    } else if (!isCloudSignedIn) {
      void handleCloudLogin()
    } else if (plansError && !plans) {
      void reloadPlans().catch(() => {})
    } else if (plans) {
      onRequestClose?.()
      if (paidPlanName) {
        openSettingsTab('/settings/profile')
      } else {
        void openCherryCloudAccountPortal()
      }
    }
  }
  const cloudHeaderAction: {
    label: string
    loading: boolean
    onClick: () => void | Promise<void>
    icon: ReactNode
  } | null = isCloudSignedIn
    ? null
    : isAuthorizing
      ? {
          label: t('common.cancel'),
          loading: isCancellingLogin,
          onClick: handleCloudLoginCancel,
          icon: null
        }
      : cloudStatusLoadState === 'error'
        ? {
            label: t('common.retry'),
            loading: false,
            onClick: loadCloudStatus,
            icon: <RotateCcw className="!text-muted-foreground size-4" aria-hidden />
          }
        : !isGlobalEdition
          ? {
              label: t('settings.provider.cherry_cloud.login'),
              loading: cloudStatusLoadState === 'loading',
              onClick: handleCloudLogin,
              icon: <LogIn className="!text-muted-foreground size-4" aria-hidden />
            }
          : null

  return (
    <ColFlex className="w-56 p-1.5">
      <ColFlex className="pb-1">
        <Button
          type="button"
          variant="ghost"
          aria-label={t('settings.general.user_name.label')}
          className="h-auto min-h-9 w-full items-center justify-start gap-2 px-2 py-1 text-left"
          onClick={handleOpenAccountDetails}
          size="sm">
          <span className="flex w-4 shrink-0 items-center justify-center">
            {isEmoji(avatar) ? (
              <EmojiAvatar size={20} fontSize={12} className="shrink-0">
                {avatar}
              </EmojiAvatar>
            ) : (
              <Avatar className="size-5 shrink-0 rounded-full">
                <AvatarImage src={avatar} className="object-cover" />
              </Avatar>
            )}
          </span>
          <ColFlex className="min-w-0 flex-1 gap-0">
            <span className="truncate font-medium text-[13px] text-foreground leading-[18px]">
              {accountDisplayName}
            </span>
            {cloudSubtitle && cloudSubtitle !== accountDisplayName ? (
              <span role={cloudSubtitleRole} className="truncate text-muted-foreground text-xs leading-4">
                {cloudSubtitle}
              </span>
            ) : null}
          </ColFlex>
        </Button>
      </ColFlex>
      <ColFlex className="border-border-subtle gap-0.5 border-t py-1">
        {isGlobalEdition ? (
          <Button
            type="button"
            className="h-8 min-h-8 w-full justify-start gap-2 rounded-md bg-transparent px-2 py-0 text-[13px] text-foreground leading-5"
            disabled={subscriptionLoading}
            onClick={handleSubscriptionClick}
            size="sm"
            variant="ghost">
            {paidPlanName ? (
              <Gauge className="!text-muted-foreground size-4 shrink-0" aria-hidden />
            ) : (
              <CreditCard className="!text-muted-foreground size-4 shrink-0" aria-hidden />
            )}
            <span className="shrink-0">
              {paidPlanName ? t('settings.subscription.usage') : t('settings.subscription.card_label')}
            </span>
            <span className="ml-auto flex min-w-0 items-center gap-1 text-muted-foreground">
              <span className="truncate">{subscriptionAction}</span>
              <ChevronRight className="size-4 shrink-0" aria-hidden />
            </span>
          </Button>
        ) : null}
        <AppearanceMenu onRequestClose={onRequestClose} />
        {children}
        {cloudHeaderAction ? (
          <Button
            type="button"
            className="h-8 min-h-8 w-full justify-start gap-2 rounded-md bg-transparent px-2 py-0 text-[13px] text-foreground leading-5"
            loading={cloudHeaderAction.loading}
            onClick={() => void cloudHeaderAction.onClick()}
            size="sm"
            variant="ghost">
            {!cloudHeaderAction.loading ? cloudHeaderAction.icon : null}
            {cloudHeaderAction.label}
          </Button>
        ) : null}
      </ColFlex>
      <ColFlex className="border-border-subtle border-t pt-1">
        <Button
          className="h-8 min-h-8 w-full justify-start gap-2 rounded-md bg-transparent px-2 py-0 text-[13px] text-foreground leading-5"
          onClick={handleOpenSettings}
          size="sm"
          variant="ghost">
          <Settings className="!text-muted-foreground size-4" aria-hidden />
          <span className="min-w-0 flex-1 text-left">{t('common.settings')}</span>
          <CommandShortcut
            command="app.settings.open"
            className="ml-auto h-auto min-w-0 rounded-none bg-transparent p-0 text-[13px] shadow-none"
          />
        </Button>
      </ColFlex>
    </ColFlex>
  )
}
