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
import { cacheService } from '@data/CacheService'
import { usePreference } from '@data/hooks/usePreference'
import DefaultAvatar from '@renderer/assets/images/avatar.png'
import useAvatar from '@renderer/hooks/useAvatar'
import ImageStorage from '@renderer/services/ImageStorage'
import { compressImage, isEmoji } from '@renderer/utils'
import React, { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import EmojiPicker from '../EmojiPicker'
import { TopView } from '../TopView'

const CLOSE_ANIMATION_MS = 200

interface Props {
  resolve: (data: any) => void
}

type AvatarPopoverView = 'menu' | 'emoji'

const PopupContainer: React.FC<Props> = ({ resolve }) => {
  const [userName, setUserName] = usePreference('app.user.name')

  const [open, setOpen] = useState(true)
  const [avatarPopoverOpen, setAvatarPopoverOpen] = useState(false)
  const [avatarPopoverView, setAvatarPopoverView] = useState<AvatarPopoverView>('menu')
  const fileInputRef = useRef<HTMLInputElement>(null)
  const { t } = useTranslation()
  const avatar = useAvatar()

  const closeDialog = () => {
    setOpen(false)
    window.setTimeout(() => {
      resolve({})
    }, CLOSE_ANIMATION_MS)
  }

  const onOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      closeDialog()
    }
  }

  const handleEmojiClick = async (emoji: string) => {
    try {
      // set emoji string
      await ImageStorage.set('avatar', emoji)
      // update avatar display
      cacheService.set('app.user.avatar', emoji)
      setAvatarPopoverOpen(false)
      setAvatarPopoverView('menu')
    } catch (error: any) {
      window.toast.error(error.message)
    }
  }

  const handleReset = async () => {
    try {
      await ImageStorage.set('avatar', DefaultAvatar)
      cacheService.set('app.user.avatar', DefaultAvatar)
      setAvatarPopoverOpen(false)
      setAvatarPopoverView('menu')
    } catch (error: any) {
      window.toast.error(error.message)
    }
  }

  const handleUploadAvatar = async (file: File) => {
    try {
      if (file.type === 'image/gif') {
        await ImageStorage.set('avatar', file)
      } else {
        const compressedFile = await compressImage(file)
        await ImageStorage.set('avatar', compressedFile)
      }
      cacheService.set('app.user.avatar', await ImageStorage.get('avatar'))
      setAvatarPopoverOpen(false)
      setAvatarPopoverView('menu')
    } catch (error: any) {
      window.toast.error(error.message)
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
                {isEmoji(avatar) ? (
                  <EmojiAvatar size={80} fontSize={40} className="cursor-pointer transition-opacity hover:opacity-80">
                    {avatar}
                  </EmojiAvatar>
                ) : (
                  <Avatar className="size-20 cursor-pointer rounded-[25%] transition-opacity hover:opacity-80">
                    <AvatarImage src={avatar} />
                  </Avatar>
                )}
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

export default class UserPopup {
  static topviewId = 0
  static hide() {
    TopView.hide('UserPopup')
  }
  static show() {
    return new Promise<any>((resolve) => {
      TopView.show(
        <PopupContainer
          resolve={(v) => {
            resolve(v)
            this.hide()
          }}
        />,
        'UserPopup'
      )
    })
  }
}
