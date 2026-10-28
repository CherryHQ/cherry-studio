import {
  ChevronRight,
  CreditCard,
  Gauge,
  LogIn,
  LogOut,
  Monitor,
  Moon,
  RotateCcw,
  Settings,
  Sun,
  SunMoon
} from 'lucide-react'
import type { ReactNode } from 'react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  Avatar,
  AvatarImage,
  Button,
  ColFlex,
  ConfirmDialog,
  EmojiAvatar,
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
  RowFlex,
  SegmentedControl
} from '@cherrystudio/ui'
import { usePreference } from '@data/hooks/usePreference'
import { CherryCloudQuotaUsage } from '@renderer/components/CherryCloudQuotaUsage'
import useAvatar from '@renderer/hooks/useAvatar'
import { useCherryAccountSession } from '@renderer/hooks/useCherryAccountSession'
import { useTheme } from '@renderer/hooks/useTheme'
import { ipcApi } from '@renderer/ipc'
import { startCherryCloudSubscription } from '@renderer/services/cherryCloudSubscription'
import { openSettingsTab } from '@renderer/services/mainWindowNavigation'
import { type CherryCloudEntitlement, getLowestRemainingPercent } from '@renderer/utils/cherryCloudQuota'
import { isEmoji } from '@renderer/utils/naming'
import { ThemeMode } from '@shared/data/preference/preferenceTypes'

type SubscriptionLookup =
  | { status: 'loading' }
  | { status: 'ready'; paid: CherryCloudEntitlement | null }
  | { status: 'error' }

export function UserAccountPanel({ active = true, onRequestClose }: { active?: boolean; onRequestClose?: () => void }) {
  const [userName] = usePreference('app.user.name')
  const [logoutConfirmOpen, setLogoutConfirmOpen] = useState(false)
  const [subscriptionLookup, setSubscriptionLookup] = useState<SubscriptionLookup>({ status: 'loading' })
  const [planRequestVersion, setPlanRequestVersion] = useState(0)
  const { t } = useTranslation()
  const avatar = useAvatar()
  const { settedTheme, setTheme } = useTheme()
  const {
    status: cloudStatus,
    loadState: cloudStatusLoadState,
    reload: loadCloudStatus,
    login: handleCloudLogin,
    cancelLogin: handleCloudLoginCancel,
    revokeSession: handleCloudLogout,
    isCancellingLogin,
    isRevokingSession,
    isAuthorizing
  } = useCherryAccountSession(active)
  const isCloudSignedIn = cloudStatus?.phase === 'signed-in'

  useEffect(() => {
    if (!active || !isCloudSignedIn) return
    let cancelled = false
    setSubscriptionLookup({ status: 'loading' })
    void ipcApi
      .request('cherry_cloud.account_plans.get')
      .then((plans) => {
        if (cancelled) return
        const paid = plans.entitlements.find((item) => item.state === 'active' && !item.plan.is_free)
        setSubscriptionLookup({ status: 'ready', paid: paid ?? null })
      })
      .catch(() => {
        if (!cancelled) setSubscriptionLookup({ status: 'error' })
      })
    return () => {
      cancelled = true
    }
  }, [active, cloudStatus?.displayName, isCloudSignedIn, planRequestVersion])

  const handleOpenAccountDetails = () => {
    onRequestClose?.()
    openSettingsTab('/settings/profile')
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
  const paidEntitlement = isCloudSignedIn && subscriptionLookup.status === 'ready' ? subscriptionLookup.paid : null
  const paidPlanName = paidEntitlement?.plan.display_name ?? null
  const remainingPercent = paidEntitlement ? getLowestRemainingPercent(paidEntitlement) : undefined
  const subscriptionLoading =
    cloudStatusLoadState === 'loading' || isAuthorizing || (isCloudSignedIn && subscriptionLookup.status === 'loading')
  const subscriptionFailed =
    cloudStatusLoadState === 'error' || (isCloudSignedIn && subscriptionLookup.status === 'error')
  const subscriptionAction = subscriptionLoading ? (
    t('common.loading')
  ) : subscriptionFailed ? (
    t('common.retry')
  ) : !paidPlanName ? (
    <span className="text-link">{t('settings.subscription.go_to_subscribe')}</span>
  ) : remainingPercent === undefined ? (
    t('settings.subscription.view_usage')
  ) : (
    <span className="inline-flex items-center gap-1 tabular-nums">
      <Gauge className="!text-muted-foreground size-3.5" aria-hidden />
      {remainingPercent}%
    </span>
  )
  const openUsage = () => {
    onRequestClose?.()
    openSettingsTab('/settings/profile')
  }
  const handleSubscriptionClick = () => {
    if (cloudStatusLoadState === 'error') {
      void loadCloudStatus()
    } else if (!isCloudSignedIn) {
      void startCherryCloudSubscription()
    } else if (subscriptionLookup.status === 'error') {
      setPlanRequestVersion((version) => version + 1)
    } else if (subscriptionLookup.status === 'ready') {
      onRequestClose?.()
      if (subscriptionLookup.paid) {
        openSettingsTab('/settings/profile')
      } else {
        void startCherryCloudSubscription()
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
  const themeOptions = [
    {
      value: ThemeMode.light,
      label: (
        <>
          <Sun className="size-3" aria-hidden />
          <span className="sr-only">{t('settings.theme.light')}</span>
        </>
      )
    },
    {
      value: ThemeMode.dark,
      label: (
        <>
          <Moon className="size-3" aria-hidden />
          <span className="sr-only">{t('settings.theme.dark')}</span>
        </>
      )
    },
    {
      value: ThemeMode.system,
      label: (
        <>
          <Monitor className="size-3" aria-hidden />
          <span className="sr-only">{t('settings.theme.system')}</span>
        </>
      )
    }
  ]

  const subscriptionRow = (
    <Button
      type="button"
      className="min-h-7 w-full justify-start gap-2 px-2 text-[13px] text-foreground leading-5"
      disabled={subscriptionLoading}
      onClick={handleSubscriptionClick}
      size="sm"
      variant="ghost">
      <CreditCard className="!text-muted-foreground size-4 shrink-0" aria-hidden />
      <span className="min-w-0 flex-1 truncate text-left" title={paidPlanName ?? undefined}>
        {paidPlanName ?? t('settings.subscription.card_label')}
      </span>
      <span className="shrink-0 text-muted-foreground">{subscriptionAction}</span>
    </Button>
  )

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
      <ColFlex className="border-border-subtle gap-0.5 border-t pt-1 pb-2">
        {paidEntitlement ? (
          <HoverCard openDelay={150} closeDelay={120}>
            <HoverCardTrigger asChild>{subscriptionRow}</HoverCardTrigger>
            <HoverCardContent side="right" align="start" sideOffset={8} className="w-64">
              <div className="truncate font-medium text-sm">{paidEntitlement.plan.display_name}</div>
              <div className="mt-2 border-border border-t pt-1">
                <CherryCloudQuotaUsage entitlement={paidEntitlement} />
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="mt-1 w-full justify-between px-0 text-muted-foreground text-xs hover:bg-transparent hover:text-foreground"
                onClick={openUsage}>
                {t('settings.subscription.view_usage_details')}
                <ChevronRight className="size-3.5" aria-hidden />
              </Button>
            </HoverCardContent>
          </HoverCard>
        ) : (
          subscriptionRow
        )}
        <Button
          className="min-h-7 w-full justify-start gap-2 px-2 text-[13px] text-foreground leading-5"
          onClick={handleOpenSettings}
          size="sm"
          variant="ghost">
          <Settings className="!text-muted-foreground size-4" aria-hidden />
          {t('common.settings')}
        </Button>
        <RowFlex className="min-h-7 items-center gap-2 px-2">
          <SunMoon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <span className="min-w-0 flex-1 truncate text-[13px] text-foreground leading-5">
            {t('settings.appearance.title')}
          </span>
          <SegmentedControl
            aria-label={t('settings.appearance.title')}
            className="p-px [&_[role=radio]]:h-6 [&_[role=radio]]:px-1.5"
            options={themeOptions}
            size="sm"
            value={settedTheme}
            onValueChange={setTheme}
          />
        </RowFlex>
        {cloudHeaderAction ? (
          <Button
            type="button"
            className="min-h-7 w-full justify-start gap-2 px-2 text-[13px] text-foreground leading-5"
            loading={cloudHeaderAction.loading}
            onClick={() => void cloudHeaderAction.onClick()}
            size="sm"
            variant="ghost">
            {!cloudHeaderAction.loading ? cloudHeaderAction.icon : null}
            {cloudHeaderAction.label}
          </Button>
        ) : null}
      </ColFlex>
      {isCloudSignedIn ? (
        <div className="border-border-subtle border-t pt-1">
          <Button
            className="min-h-8 w-full justify-start gap-2 px-2 text-[13px] text-foreground leading-5"
            loading={isRevokingSession}
            onClick={() => setLogoutConfirmOpen(true)}
            size="sm"
            variant="ghost">
            {!isRevokingSession ? <LogOut className="!text-muted-foreground size-4" aria-hidden /> : null}
            {t('settings.provider.cherry_cloud.logout')}
          </Button>
        </div>
      ) : null}
      <ConfirmDialog
        contentClassName="gap-3 p-4 sm:max-w-sm"
        open={logoutConfirmOpen}
        onOpenChange={setLogoutConfirmOpen}
        title={t('settings.provider.cherry_cloud.logout_confirm_title')}
        description={
          cloudStatus?.displayName
            ? t('settings.provider.cherry_cloud.logout_confirm_account', { displayName: cloudStatus.displayName })
            : undefined
        }
        content={
          <p className="text-foreground text-sm">{t('settings.provider.cherry_cloud.logout_confirm_description')}</p>
        }
        cancelText={t('common.cancel')}
        confirmText={t('settings.provider.cherry_cloud.logout')}
        confirmLoading={isRevokingSession}
        destructive
        onConfirm={handleCloudLogout}
      />
    </ColFlex>
  )
}
