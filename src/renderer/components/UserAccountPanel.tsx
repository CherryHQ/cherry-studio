import {
  Camera,
  Check,
  CreditCard,
  ImageUp,
  LogIn,
  LogOut,
  Monitor,
  Moon,
  Pencil,
  RotateCcw,
  Settings,
  Smile,
  Sun,
  SunMoon,
  X
} from 'lucide-react'
import type { ReactNode } from 'react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  Avatar,
  AvatarImage,
  Button,
  ColFlex,
  ConfirmDialog,
  EmojiAvatar,
  Input,
  Popover,
  PopoverContent,
  PopoverTrigger,
  RowFlex,
  SegmentedControl,
  Tooltip
} from '@cherrystudio/ui'
import { usePreference } from '@data/hooks/usePreference'
import useAvatar from '@renderer/hooks/useAvatar'
import { useCherryAccountSession } from '@renderer/hooks/useCherryAccountSession'
import { useTheme } from '@renderer/hooks/useTheme'
import { ipcApi } from '@renderer/ipc'
import { openCherryCloudAccountPortal } from '@renderer/services/cherryCloudAccountPortal'
import { openSettingsTab } from '@renderer/services/mainWindowNavigation'
import { toast } from '@renderer/services/toast'
import { getAppEdition } from '@renderer/utils/appEdition'
import { checkEntityImageSize, prepareEntityImageBytes } from '@renderer/utils/image'
import { isEmoji } from '@renderer/utils/naming'
import { ThemeMode } from '@shared/data/preference/preferenceTypes'

import { EmojiPicker } from './EmojiPicker'

type AvatarPopoverView = 'menu' | 'emoji'
type SubscriptionLookup = { status: 'loading' } | { status: 'ready'; planName: string | null } | { status: 'error' }

export function UserAccountPanel({
  active = true,
  onEditingUserNameChange,
  onRequestClose
}: {
  active?: boolean
  onEditingUserNameChange?: (editing: boolean) => void
  onRequestClose?: () => void
}) {
  const [userName, setUserName] = usePreference('app.user.name')
  const [isEditingUserName, setIsEditingUserName] = useState(false)
  const [isSavingUserName, setIsSavingUserName] = useState(false)
  const [userNameDraft, setUserNameDraft] = useState(userName)
  const [avatarPopoverOpen, setAvatarPopoverOpen] = useState(false)
  const [avatarPopoverView, setAvatarPopoverView] = useState<AvatarPopoverView>('menu')
  const [logoutConfirmOpen, setLogoutConfirmOpen] = useState(false)
  const [subscriptionLookup, setSubscriptionLookup] = useState<SubscriptionLookup>({ status: 'loading' })
  const [planRequestVersion, setPlanRequestVersion] = useState(0)
  const fileInputRef = useRef<HTMLInputElement>(null)
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
  const isGlobalEdition = getAppEdition() === 'global'
  const isCloudSignedIn = cloudStatus?.phase === 'signed-in'

  useEffect(() => {
    if (!active || !isGlobalEdition || !isCloudSignedIn) return
    let cancelled = false
    setSubscriptionLookup({ status: 'loading' })
    void ipcApi
      .request('cherry_cloud.account_plans.get')
      .then((plans) => {
        if (cancelled) return
        const paidPlan = plans.entitlements.find((item) => item.state === 'active' && !item.plan.is_free)
        setSubscriptionLookup({ status: 'ready', planName: paidPlan?.plan.display_name ?? null })
      })
      .catch(() => {
        if (!cancelled) setSubscriptionLookup({ status: 'error' })
      })
    return () => {
      cancelled = true
    }
  }, [active, cloudStatus?.displayName, isCloudSignedIn, isGlobalEdition, planRequestVersion])

  const startEditingUserName = () => {
    setUserNameDraft(userName)
    setIsEditingUserName(true)
    onEditingUserNameChange?.(true)
  }

  const cancelEditingUserName = () => {
    setUserNameDraft(userName)
    setIsEditingUserName(false)
    onEditingUserNameChange?.(false)
  }

  const saveUserName = async () => {
    const nextUserName = userNameDraft.trim()
    setIsSavingUserName(true)
    try {
      await setUserName(nextUserName)
      setIsEditingUserName(false)
      onEditingUserNameChange?.(false)
    } catch (error: any) {
      toast.error(error.message)
    } finally {
      setIsSavingUserName(false)
    }
  }

  const handleEmojiClick = async (emoji: string) => {
    try {
      await ipcApi.request('profile.set_avatar', { kind: 'emoji', emoji })
      setAvatarPopoverOpen(false)
      setAvatarPopoverView('menu')
    } catch (error: any) {
      toast.error(error.message)
    }
  }

  const handleResetAvatar = async () => {
    try {
      await ipcApi.request('profile.set_avatar', { kind: 'default' })
      setAvatarPopoverOpen(false)
      setAvatarPopoverView('menu')
    } catch (error: any) {
      toast.error(error.message)
    }
  }

  const handleUploadAvatar = async (file: File) => {
    const sizeError = checkEntityImageSize(file)
    if (sizeError) {
      toast.error(sizeError)
      return
    }

    try {
      const data = await prepareEntityImageBytes(file)
      await ipcApi.request('profile.set_avatar', { kind: 'image', data })
      setAvatarPopoverOpen(false)
      setAvatarPopoverView('menu')
    } catch (error: any) {
      toast.error(error.message)
    }
  }

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
  const paidPlanName = isCloudSignedIn && subscriptionLookup.status === 'ready' ? subscriptionLookup.planName : null
  const subscriptionLoading =
    cloudStatusLoadState === 'loading' || isAuthorizing || (isCloudSignedIn && subscriptionLookup.status === 'loading')
  const subscriptionFailed =
    cloudStatusLoadState === 'error' || (isCloudSignedIn && subscriptionLookup.status === 'error')
  const subscriptionAction = subscriptionLoading
    ? t('common.loading')
    : subscriptionFailed
      ? t('common.retry')
      : paidPlanName
        ? t('settings.subscription.view_usage')
        : t('settings.subscription.go_to_subscribe')
  const handleSubscriptionClick = () => {
    if (cloudStatusLoadState === 'error') {
      void loadCloudStatus()
    } else if (!isCloudSignedIn) {
      void handleCloudLogin()
    } else if (subscriptionLookup.status === 'error') {
      setPlanRequestVersion((version) => version + 1)
    } else if (subscriptionLookup.status === 'ready') {
      onRequestClose?.()
      if (subscriptionLookup.planName) {
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

  return (
    <ColFlex className="w-56 p-1.5">
      <ColFlex className="pb-1">
        {isGlobalEdition ? (
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
        ) : (
          <RowFlex className="min-h-9 items-center gap-2 px-2 py-1">
            <Popover
              open={avatarPopoverOpen}
              onOpenChange={(visible) => {
                setAvatarPopoverOpen(visible)
                if (!visible) setAvatarPopoverView('menu')
              }}>
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  aria-label={t('common.avatar')}
                  className="group relative size-7 min-h-7 shrink-0 rounded-full p-0 text-foreground shadow-none hover:bg-transparent hover:text-foreground focus-visible:bg-transparent">
                  {isEmoji(avatar) ? (
                    <EmojiAvatar size={28} fontSize={14}>
                      {avatar}
                    </EmojiAvatar>
                  ) : (
                    <Avatar className="size-7 rounded-full">
                      <AvatarImage src={avatar} className="object-cover" />
                    </Avatar>
                  )}
                  <span className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-full bg-background/70 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
                    <Camera className="size-3.5" aria-hidden />
                  </span>
                </Button>
              </PopoverTrigger>
              <PopoverContent className="z-[90] w-auto p-2" align="start" sideOffset={6}>
                {avatarPopoverView === 'emoji' ? (
                  <EmojiPicker onEmojiClick={handleEmojiClick} />
                ) : (
                  <ColFlex className="w-40 gap-1">
                    <input
                      ref={fileInputRef}
                      className="hidden"
                      type="file"
                      accept="image/png, image/jpeg, image/gif, image/webp"
                      onChange={(event) => {
                        const file = event.target.files?.[0]
                        event.target.value = ''
                        if (file) void handleUploadAvatar(file)
                      }}
                    />
                    <Button
                      variant="ghost"
                      className="w-full justify-start"
                      onClick={() => fileInputRef.current?.click()}>
                      <ImageUp aria-hidden />
                      {t('settings.general.image_upload')}
                    </Button>
                    <Button
                      variant="ghost"
                      className="w-full justify-start"
                      onClick={() => setAvatarPopoverView('emoji')}>
                      <Smile aria-hidden />
                      {t('settings.general.emoji_picker')}
                    </Button>
                    <Button variant="ghost" className="w-full justify-start" onClick={() => void handleResetAvatar()}>
                      <RotateCcw aria-hidden />
                      {t('settings.general.avatar.reset')}
                    </Button>
                  </ColFlex>
                )}
              </PopoverContent>
            </Popover>
            {isEditingUserName ? (
              <RowFlex className="min-w-0 flex-1 items-center gap-1">
                <Input
                  autoFocus
                  aria-label={t('settings.general.user_name.label')}
                  placeholder={t('settings.general.user_name.placeholder')}
                  value={userNameDraft}
                  onChange={(event) => setUserNameDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                      event.preventDefault()
                      void saveUserName()
                    }
                    if (event.key === 'Escape') {
                      event.preventDefault()
                      event.stopPropagation()
                      cancelEditingUserName()
                    }
                  }}
                  className="h-8 min-w-0 flex-1"
                  maxLength={30}
                  disabled={isSavingUserName}
                />
                <Tooltip content={t('common.save')}>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t('common.save')}
                    loading={isSavingUserName}
                    onClick={() => void saveUserName()}>
                    {!isSavingUserName ? <Check aria-hidden /> : null}
                  </Button>
                </Tooltip>
                <Tooltip content={t('common.cancel')}>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t('common.cancel')}
                    disabled={isSavingUserName}
                    onClick={cancelEditingUserName}>
                    <X aria-hidden />
                  </Button>
                </Tooltip>
              </RowFlex>
            ) : (
              <Button
                type="button"
                aria-label={t('settings.general.user_name.label')}
                className="h-auto min-w-0 flex-1 justify-start px-0.5 py-0 text-left"
                onClick={startEditingUserName}
                size="sm"
                variant="ghost">
                <ColFlex className="min-w-0 flex-1 gap-0">
                  <RowFlex className="min-w-0 items-center gap-1">
                    <span
                      role={useCloudSubtitleAsTitle ? cloudSubtitleRole : undefined}
                      className="truncate font-medium text-[13px] text-foreground leading-[18px]">
                      {userName || cloudSubtitle}
                    </span>
                    <Pencil className="!text-muted-foreground size-3 shrink-0" aria-hidden />
                  </RowFlex>
                  {!useCloudSubtitleAsTitle && cloudSubtitle ? (
                    <span role={cloudSubtitleRole} className="truncate text-muted-foreground text-xs leading-4">
                      {cloudSubtitle}
                    </span>
                  ) : null}
                </ColFlex>
              </Button>
            )}
          </RowFlex>
        )}
      </ColFlex>
      <ColFlex className="border-border-subtle gap-0.5 border-t pt-1">
        {isGlobalEdition ? (
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
        ) : null}
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
        <div className="border-border-subtle border-t py-1">
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
