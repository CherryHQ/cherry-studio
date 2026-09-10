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
import { openSettingsTab } from '@renderer/services/mainWindowNavigation'
import { toast } from '@renderer/services/toast'
import { getAppEdition } from '@renderer/utils/appEdition'
import { checkEntityImageSize, prepareEntityImageBytes } from '@renderer/utils/image'
import { isEmoji } from '@renderer/utils/naming'
import { ThemeMode } from '@shared/data/preference/preferenceTypes'
import {
  Camera,
  Check,
  ImageUp,
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
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { EmojiPicker } from './EmojiPicker'

type AvatarPopoverView = 'menu' | 'emoji'

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
  const fileInputRef = useRef<HTMLInputElement>(null)
  const { t } = useTranslation()
  const avatar = useAvatar()
  const { settedTheme, setTheme } = useTheme()
  const isCnEdition = getAppEdition() === 'cn'
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
      setUserNameDraft(nextUserName)
      setIsEditingUserName(false)
      onEditingUserNameChange?.(false)
    } catch (error: any) {
      toast.error(error.message)
    } finally {
      setIsSavingUserName(false)
    }
  }

  const handleOpenSettings = () => {
    onRequestClose?.()
    openSettingsTab()
  }

  const isCloudSignedIn = cloudStatus?.phase === 'signed-in'
  const cloudSubtitle = isCloudSignedIn
    ? cloudStatus.displayName || t('settings.provider.cherry_cloud.logged_in')
    : !isCnEdition
      ? null
      : isAuthorizing
        ? t('settings.provider.cherry_cloud.signing_in')
        : cloudStatusLoadState === 'error'
          ? t('error.http.503')
          : t('settings.provider.cherry_cloud.title')
  const cloudSubtitleRole =
    isCloudSignedIn || isAuthorizing ? 'status' : cloudStatusLoadState === 'error' ? 'alert' : undefined
  const cloudHeaderAction =
    !isCnEdition || isCloudSignedIn
      ? null
      : isAuthorizing
        ? {
            label: t('common.cancel'),
            loading: isCancellingLogin,
            onClick: handleCloudLoginCancel
          }
        : cloudStatusLoadState === 'error'
          ? {
              label: t('common.retry'),
              loading: false,
              onClick: loadCloudStatus
            }
          : {
              label: t('settings.provider.cherry_cloud.login'),
              loading: cloudStatusLoadState === 'loading',
              onClick: handleCloudLogin
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

  // The handler owns the app.user.avatar Preference write, which auto-syncs back to useAvatar.
  // Superseded file_entry rows are left for the orphan sweep rather than pruned here.
  const handleEmojiClick = async (emoji: string) => {
    try {
      await ipcApi.request('profile.set_avatar', { kind: 'emoji', emoji })
      setAvatarPopoverOpen(false)
      setAvatarPopoverView('menu')
    } catch (error: any) {
      toast.error(error.message)
    }
  }

  const handleReset = async () => {
    try {
      // Reset falls back to the bundled default avatar (see useAvatar).
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
      // Normalize to 128x128 WebP; the handler creates file_entry and stores a file:<id> Preference ref.
      // Avatars have no file_ref row, and processing failures surface as a localized retry error.
      const data = await prepareEntityImageBytes(file)
      await ipcApi.request('profile.set_avatar', { kind: 'image', data })
      setAvatarPopoverOpen(false)
      setAvatarPopoverView('menu')
    } catch (error: any) {
      toast.error(error.message)
    }
  }

  return (
    <ColFlex className="w-56">
      <RowFlex className="min-h-12 items-center gap-2 px-2.5 py-1.5">
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
          <PopoverContent className="w-auto p-2" align="start" sideOffset={6}>
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
                <Button variant="ghost" className="w-full justify-start" onClick={() => fileInputRef.current?.click()}>
                  <ImageUp aria-hidden />
                  {t('settings.general.image_upload')}
                </Button>
                <Button variant="ghost" className="w-full justify-start" onClick={() => setAvatarPopoverView('emoji')}>
                  <Smile aria-hidden />
                  {t('settings.general.emoji_picker')}
                </Button>
                <Button variant="ghost" className="w-full justify-start" onClick={() => void handleReset()}>
                  <RotateCcw aria-hidden />
                  {t('settings.general.avatar.reset')}
                </Button>
              </ColFlex>
            )}
          </PopoverContent>
        </Popover>
        {isEditingUserName ? (
          <ColFlex className="min-w-0 flex-1 gap-0.5">
            <RowFlex className="min-w-0 items-center gap-1">
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
          </ColFlex>
        ) : (
          <>
            <Button
              type="button"
              aria-label={t('settings.general.user_name.label')}
              className="h-auto min-w-0 flex-1 justify-start px-0.5 py-0 text-left"
              onClick={startEditingUserName}
              size="sm"
              variant="ghost">
              <ColFlex className="min-w-0 flex-1 gap-0">
                <RowFlex className="min-w-0 items-center gap-1">
                  <span className="truncate font-medium text-[13px] text-foreground leading-[18px]">
                    {userName || t('settings.general.user_name.placeholder')}
                  </span>
                  <Pencil className="!text-muted-foreground size-3 shrink-0" aria-hidden />
                </RowFlex>
                {cloudSubtitle ? (
                  <span role={cloudSubtitleRole} className="truncate text-muted-foreground text-xs leading-4">
                    {cloudSubtitle}
                  </span>
                ) : null}
              </ColFlex>
            </Button>
            {cloudHeaderAction ? (
              <Button
                type="button"
                className="h-7 shrink-0 px-2 text-xs"
                loading={cloudHeaderAction.loading}
                onClick={() => void cloudHeaderAction.onClick()}
                size="sm"
                variant="ghost">
                {cloudHeaderAction.label}
              </Button>
            ) : null}
          </>
        )}
      </RowFlex>
      <ColFlex className="border-border-subtle border-t py-1">
        <Button
          className="min-h-8 w-full justify-start gap-2 px-2.5 text-[13px] text-foreground leading-5"
          onClick={handleOpenSettings}
          size="sm"
          variant="ghost">
          <Settings className="!text-muted-foreground size-4" aria-hidden />
          {t('common.settings')}
        </Button>
        <RowFlex className="min-h-8 items-center gap-2 px-2.5">
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
      </ColFlex>
      {isCloudSignedIn ? (
        <div className="border-border-subtle border-t py-1">
          <Button
            className="min-h-8 w-full justify-start gap-2 px-2.5 text-[13px] text-foreground leading-5"
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
