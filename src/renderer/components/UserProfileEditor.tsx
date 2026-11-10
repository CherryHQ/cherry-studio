import { Camera, Check, ImageUp, Pencil, RotateCcw, Smile, X } from 'lucide-react'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  Avatar,
  AvatarImage,
  Button,
  ColFlex,
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
import { ipcApi } from '@renderer/ipc'
import { toast } from '@renderer/services/toast'
import { checkEntityImageSize, prepareEntityImageBytes } from '@renderer/utils/image'
import { isEmoji } from '@renderer/utils/naming'

import { EmojiPicker } from './EmojiPicker'

type AvatarPopoverView = 'menu' | 'emoji'

const PROFILE_AVATAR_SIZE = 80

export function UserProfileEditor() {
  const [userName, setUserName] = usePreference('app.user.name')
  const [isEditingUserName, setIsEditingUserName] = useState(false)
  const [isSavingUserName, setIsSavingUserName] = useState(false)
  const [userNameDraft, setUserNameDraft] = useState(userName)
  const [avatarPopoverOpen, setAvatarPopoverOpen] = useState(false)
  const [avatarPopoverView, setAvatarPopoverView] = useState<AvatarPopoverView>('menu')
  const fileInputRef = useRef<HTMLInputElement>(null)
  const { t } = useTranslation()
  const avatar = useAvatar()

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

  return (
    <ColFlex className="items-center gap-3 py-4">
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
            className="group relative size-20 min-h-20 shrink-0 rounded-full p-0 text-foreground shadow-none hover:bg-transparent hover:text-foreground focus-visible:bg-transparent">
            {isEmoji(avatar) ? (
              <EmojiAvatar size={PROFILE_AVATAR_SIZE} fontSize={40} className="rounded-full">
                {avatar}
              </EmojiAvatar>
            ) : (
              <Avatar className="size-20 rounded-full">
                <AvatarImage src={avatar} className="object-cover" />
              </Avatar>
            )}
            <span className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-full bg-background/70 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
              <Camera className="size-5" aria-hidden />
            </span>
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-2" align="center" sideOffset={6}>
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
        <RowFlex className="min-w-0 max-w-sm items-center gap-1">
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
            className="h-9 min-w-0 flex-1 text-center"
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
          className="h-auto min-w-0 justify-center px-1 py-0"
          onClick={startEditingUserName}
          size="sm"
          variant="ghost">
          <RowFlex className="min-w-0 items-center gap-1.5">
            <span className="truncate font-semibold text-lg text-foreground leading-7">
              {userName || t('settings.general.user_name.placeholder')}
            </span>
            <Pencil className="!text-muted-foreground size-3.5 shrink-0" aria-hidden />
          </RowFlex>
        </Button>
      )}
    </ColFlex>
  )
}
