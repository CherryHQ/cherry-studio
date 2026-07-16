import {
  Avatar,
  AvatarImage,
  Button,
  Center,
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
  RowFlex
} from '@cherrystudio/ui'
import { usePreference } from '@data/hooks/usePreference'
import useAvatar from '@renderer/hooks/useAvatar'
import { ipcApi } from '@renderer/ipc'
import { createPopup, type PopupInjectedProps } from '@renderer/services/popup'
import { toast } from '@renderer/services/toast'
import { checkEntityImageSize, prepareEntityImageBytes } from '@renderer/utils/image'
import { isEmoji } from '@renderer/utils/naming'
import React, { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { EmojiPicker } from './EmojiPicker'

type Props = PopupInjectedProps<Record<string, never>>

type AvatarPopoverView = 'menu' | 'emoji'

const PopupContainer: React.FC<Props> = ({ open, resolve }) => {
  const [userName, setUserName] = usePreference('app.user.name')

  const [avatarPopoverOpen, setAvatarPopoverOpen] = useState(false)
  const [avatarPopoverView, setAvatarPopoverView] = useState<AvatarPopoverView>('menu')
  const fileInputRef = useRef<HTMLInputElement>(null)
  const { t } = useTranslation()
  const avatar = useAvatar()

  const onOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      resolve({})
    }
  }

  // The `profile.set_avatar` handler owns the `app.user.avatar` Preference write;
  // the Preference auto-syncs back to `useAvatar`, so these flows don't write the
  // value themselves. A superseded file_entry is left for the orphan sweep, not
  // pruned here.
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
      // Normalize to a 128² WebP in the renderer, then send the small payload; the
      // handler creates the file_entry and stores a `file:<id>` ref in the Preference
      // (the avatar has no file_ref table). A processing failure throws a localized
      // retry message.
      const data = await prepareEntityImageBytes(file)
      await ipcApi.request('profile.set_avatar', { kind: 'image', data })
      setAvatarPopoverOpen(false)
      setAvatarPopoverView('menu')
    } catch (error: any) {
      toast.error(error.message)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[300px] gap-0 p-0 sm:max-w-[300px]">
        <DialogHeader className="sr-only">
          <DialogTitle>{t('settings.general.user_name.label')}</DialogTitle>
        </DialogHeader>
        <Center className="mt-[30px]">
          <ColFlex className="items-center gap-2.5">
            <Popover
              open={avatarPopoverOpen}
              onOpenChange={(visible) => {
                setAvatarPopoverOpen(visible)
                if (!visible) {
                  setAvatarPopoverView('menu')
                }
              }}>
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  aria-label={t('common.avatar')}
                  className="size-20 rounded-[25%] p-0 text-foreground shadow-none transition-opacity hover:bg-transparent hover:text-foreground hover:opacity-80 focus-visible:ring-2 focus-visible:ring-ring/50">
                  {isEmoji(avatar) ? (
                    <EmojiAvatar size={80} fontSize={40}>
                      {avatar}
                    </EmojiAvatar>
                  ) : (
                    <Avatar className="size-20 rounded-[25%]">
                      <AvatarImage src={avatar} className="object-cover" />
                    </Avatar>
                  )}
                </Button>
              </PopoverTrigger>
              <PopoverContent
                className="w-auto border border-border bg-popover p-2 text-popover-foreground shadow-lg"
                align="center"
                sideOffset={6}>
                {avatarPopoverView === 'emoji' ? (
                  <EmojiPicker onEmojiClick={handleEmojiClick} />
                ) : (
                  <ColFlex className="w-40 gap-1">
                    <input
                      ref={fileInputRef}
                      className="hidden"
                      type="file"
                      accept="image/png, image/jpeg, image/gif"
                      onChange={(event) => {
                        const file = event.target.files?.[0]
                        event.target.value = ''
                        if (file) {
                          void handleUploadAvatar(file)
                        }
                      }}
                    />
                    <Button
                      variant="ghost"
                      className="w-full justify-center"
                      onClick={() => fileInputRef.current?.click()}>
                      {t('settings.general.image_upload')}
                    </Button>
                    <Button
                      variant="ghost"
                      className="w-full justify-center"
                      onClick={() => setAvatarPopoverView('emoji')}>
                      {t('settings.general.emoji_picker')}
                    </Button>
                    <Button variant="ghost" className="w-full justify-center" onClick={() => void handleReset()}>
                      {t('settings.general.avatar.reset')}
                    </Button>
                  </ColFlex>
                )}
              </PopoverContent>
            </Popover>
          </ColFlex>
        </Center>
        <RowFlex className="items-center gap-2.5 p-5">
          <Input
            placeholder={t('settings.general.user_name.placeholder')}
            value={userName}
            onChange={(e) => setUserName(e.target.value.trim())}
            className="w-full flex-1 text-center"
            maxLength={30}
          />
        </RowFlex>
      </DialogContent>
    </Dialog>
  )
}

const UserPopup = createPopup<Record<string, never>, Record<string, never>>(PopupContainer, { dismissResult: {} })

export default UserPopup
