import {
  Avatar,
  AvatarImage,
  Badge,
  Button,
  ColFlex,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  EmojiAvatar,
  Input,
  Popover,
  PopoverContent,
  PopoverTrigger,
  RowFlex,
  Tooltip
} from '@cherrystudio/ui'
import { usePreference } from '@data/hooks/usePreference'
import useAvatar from '@renderer/hooks/useAvatar'
import { useCherryAccountSession } from '@renderer/hooks/useCherryAccountSession'
import { ipcApi } from '@renderer/ipc'
import { createPopup, type PopupInjectedProps } from '@renderer/services/popup'
import { toast } from '@renderer/services/toast'
import { getAppEdition } from '@renderer/utils/appEdition'
import { checkEntityImageSize, prepareEntityImageBytes } from '@renderer/utils/image'
import { isEmoji } from '@renderer/utils/naming'
import { Check, Cloud, ImageUp, LogIn, LogOut, Pencil, RefreshCw, RotateCcw, Smile, X } from 'lucide-react'
import React, { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { EmojiPicker } from './EmojiPicker'

type Props = PopupInjectedProps<Record<string, never>>

type AvatarPopoverView = 'menu' | 'emoji'

export function UserAccountPanel({ active = true }: { active?: boolean }) {
  const [userName, setUserName] = usePreference('app.user.name')
  const [isEditingUserName, setIsEditingUserName] = useState(false)
  const [isSavingUserName, setIsSavingUserName] = useState(false)
  const [userNameDraft, setUserNameDraft] = useState(userName)
  const [avatarPopoverOpen, setAvatarPopoverOpen] = useState(false)
  const [avatarPopoverView, setAvatarPopoverView] = useState<AvatarPopoverView>('menu')
  const fileInputRef = useRef<HTMLInputElement>(null)
  const { t } = useTranslation()
  const avatar = useAvatar()
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
  }

  const cancelEditingUserName = () => {
    setUserNameDraft(userName)
    setIsEditingUserName(false)
  }

  const saveUserName = async () => {
    const nextUserName = userNameDraft.trim()
    setIsSavingUserName(true)
    try {
      await setUserName(nextUserName)
      setUserNameDraft(nextUserName)
      setIsEditingUserName(false)
    } catch (error: any) {
      toast.error(error.message)
    } finally {
      setIsSavingUserName(false)
    }
  }

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
    <ColFlex className="w-80">
      <RowFlex className="items-center gap-3 p-4">
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
              className="group relative size-14 shrink-0 rounded-full p-0 text-foreground shadow-none hover:bg-transparent hover:text-foreground focus-visible:bg-transparent">
              {isEmoji(avatar) ? (
                <EmojiAvatar size={56} fontSize={28}>
                  {avatar}
                </EmojiAvatar>
              ) : (
                <Avatar className="size-14 rounded-full">
                  <AvatarImage src={avatar} className="object-cover" />
                </Avatar>
              )}
              <span className="absolute right-0 bottom-0 flex size-5 items-center justify-center rounded-full border border-background bg-foreground text-background shadow-xs transition-transform group-hover:scale-105">
                <Pencil className="size-2.5" aria-hidden />
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
        <ColFlex className="min-w-0 flex-1 gap-1">
          <span className="text-muted-foreground text-xs">{t('settings.general.user_name.label')}</span>
          {isEditingUserName ? (
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
            <RowFlex className="min-w-0 items-center gap-1">
              <span className="min-w-0 flex-1 truncate font-medium text-foreground text-sm">
                {userName || t('settings.general.user_name.placeholder')}
              </span>
              <Tooltip content={t('common.edit')}>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t('common.edit')}
                  className="shrink-0 text-muted-foreground hover:text-foreground"
                  onClick={startEditingUserName}>
                  <Pencil aria-hidden />
                </Button>
              </Tooltip>
            </RowFlex>
          )}
        </ColFlex>
      </RowFlex>
      {isCnEdition || cloudStatus?.phase === 'signed-in' ? (
        <ColFlex className="gap-3 border-border-subtle border-t px-4 py-3.5">
          <RowFlex className="items-start gap-3">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-background-subtle text-muted-foreground">
              <Cloud className="size-4" aria-hidden />
            </span>
            <ColFlex className="min-w-0 flex-1 gap-1">
              <RowFlex className="min-w-0 items-center justify-between gap-2">
                <span className="truncate font-medium text-foreground text-sm">Cherry Cloud</span>
                {cloudStatus?.phase === 'signed-in' ? (
                  <Badge className="border-success-border bg-success-subtle px-1.5 py-0 text-[10px] text-success-subtle-foreground leading-4">
                    {t('settings.provider.cherry_cloud.logged_in')}
                  </Badge>
                ) : null}
              </RowFlex>
              {cloudStatus?.phase === 'signed-in' && cloudStatus.displayName ? (
                <span role="status" className="truncate text-muted-foreground text-xs">
                  {cloudStatus.displayName}
                </span>
              ) : null}
            </ColFlex>
          </RowFlex>
          {cloudStatusLoadState === 'error' ? (
            <>
              <div role="alert" className="rounded-md bg-error-subtle px-3 py-2 text-error-subtle-foreground text-xs">
                {t('error.http.503')}
              </div>
              <Button className="w-full" onClick={() => void loadCloudStatus()} variant="outline">
                <RefreshCw aria-hidden />
                {t('common.retry')}
              </Button>
            </>
          ) : cloudStatus?.phase === 'signed-in' ? (
            <Button
              className="w-full justify-start px-2 text-muted-foreground hover:text-foreground"
              loading={isRevokingSession}
              onClick={() => void handleCloudLogout()}
              variant="ghost">
              {!isRevokingSession ? <LogOut aria-hidden /> : null}
              {t('settings.provider.cherry_cloud.logout')}
            </Button>
          ) : (
            <ColFlex className="gap-2">
              <Button
                className="w-full"
                loading={cloudStatusLoadState === 'loading' || isAuthorizing}
                onClick={() => void handleCloudLogin()}
                variant="outline">
                {!isAuthorizing && cloudStatusLoadState !== 'loading' ? <LogIn aria-hidden /> : null}
                {isAuthorizing
                  ? t('settings.provider.cherry_cloud.signing_in')
                  : t('settings.provider.cherry_cloud.login')}
              </Button>
              {isAuthorizing ? (
                <Button
                  className="w-full"
                  loading={isCancellingLogin}
                  onClick={() => void handleCloudLoginCancel()}
                  variant="ghost">
                  {!isCancellingLogin ? <X aria-hidden /> : null}
                  {t('common.cancel')}
                </Button>
              ) : null}
            </ColFlex>
          )}
        </ColFlex>
      ) : null}
    </ColFlex>
  )
}

const PopupContainer: React.FC<Props> = ({ open, resolve }) => {
  const { t } = useTranslation()

  const onOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) resolve({})
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-80 gap-0 p-0 sm:max-w-80">
        <DialogHeader className="sr-only">
          <DialogTitle>{t('settings.general.user_name.label')}</DialogTitle>
        </DialogHeader>
        <UserAccountPanel active={open} />
      </DialogContent>
    </Dialog>
  )
}

const UserPopup = createPopup<Record<string, never>, Record<string, never>>(PopupContainer, { dismissResult: {} })

export default UserPopup
