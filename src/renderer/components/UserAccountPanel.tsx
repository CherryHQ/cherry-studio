import { ChevronRight, CreditCard, LogIn, RotateCcw, Settings } from 'lucide-react'
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

export function UserAccountPanel({
  active = true,
  onRequestClose,
  children
}: {
  active?: boolean
  onRequestClose?: () => void
  children?: ReactNode
}) {
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
  } = useCherryAccountSession(active)
  const isGlobalEdition = getAppEdition() === 'global'
  const isCloudSignedIn = cloudStatus?.phase === 'signed-in'

  const accountId = isCloudSignedIn ? cloudStatus.accountId : null
  const {
    data: plans,
    error: plansError,
    mutate: reloadPlans
  } = useSWR(
    active && isGlobalEdition && accountId ? ['cherry-cloud/account-plans', accountId] : null,
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

  const cloudSubtitle = isCloudSignedIn
    ? cloudStatus.displayName || t('settings.provider.cherry_cloud.logged_in')
    : isAuthorizing
      ? t('settings.provider.cherry_cloud.signing_in')
      : cloudStatusLoadState === 'error'
        ? t('error.http.503')
        : t('settings.provider.cherry_cloud.title')
  const cloudSubtitleRole =
    isCloudSignedIn || isAuthorizing ? 'status' : cloudStatusLoadState === 'error' ? 'alert' : undefined
  const useCloudSubtitleAsTitle = !userName
  const paidPlanName = plans?.entitlements.find((item) => item.state === 'active' && !item.plan.is_free)?.plan
    .display_name
  const subscriptionLoading =
    cloudStatusLoadState === 'loading' || isAuthorizing || (isCloudSignedIn && !plans && !plansError)
  const subscriptionFailed = cloudStatusLoadState === 'error' || (isCloudSignedIn && plansError && !plans)
  const subscriptionAction = subscriptionLoading
    ? t('common.loading')
    : subscriptionFailed
      ? t('common.retry')
      : paidPlanName
        ? paidPlanName
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
        : {
            label: t('settings.provider.cherry_cloud.login'),
            loading: cloudStatusLoadState === 'loading',
            onClick: handleCloudLogin,
            icon: <LogIn className="!text-muted-foreground size-4" aria-hidden />
          }

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
          {isEmoji(avatar) ? (
            <EmojiAvatar size={28} fontSize={14} className="shrink-0">
              {avatar}
            </EmojiAvatar>
          ) : (
            <Avatar className="size-7 shrink-0 rounded-full">
              <AvatarImage src={avatar} className="object-cover" />
            </Avatar>
          )}
          <ColFlex className="min-w-0 flex-1 gap-0">
            <span
              role={useCloudSubtitleAsTitle ? cloudSubtitleRole : undefined}
              className="truncate font-medium text-[13px] text-foreground leading-[18px]">
              {userName || (useCloudSubtitleAsTitle ? cloudSubtitle : t('settings.general.user_name.placeholder'))}
            </span>
            {!useCloudSubtitleAsTitle && cloudSubtitle ? (
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
            <CreditCard className="!text-muted-foreground size-4 shrink-0" aria-hidden />
            <span className="shrink-0">{t('settings.subscription.card_label')}</span>
            <span className="ml-auto min-w-0 truncate text-muted-foreground" title={paidPlanName}>
              {subscriptionAction}
            </span>
            <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
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
