import { ImageUp, RotateCcw, Smile } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button, ColFlex, EmojiAvatar, Popover, PopoverContent, PopoverTrigger } from '@cherrystudio/ui'
import { EmojiPicker } from '@renderer/components/EmojiPicker'
import { toast } from '@renderer/services/toast'

import { prepareAvatarImage } from '../components/prepareAvatarImage'

type Props = {
  emoji: string
  fallback: string
  image?: Uint8Array<ArrayBuffer>
  active: boolean
  disabled: boolean
  portalContainer: HTMLElement | null
  onChange: (emoji: string, image?: Uint8Array<ArrayBuffer>) => void
  onPendingChange: (pending: boolean) => void
}

export function DraftAgentAvatarPicker({
  emoji,
  fallback,
  image,
  active,
  disabled,
  portalContainer,
  onChange,
  onPendingChange
}: Props) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [view, setView] = useState<'menu' | 'emoji'>('menu')
  const [pending, setPending] = useState(false)
  const [preview, setPreview] = useState<string>()
  const inputRef = useRef<HTMLInputElement>(null)
  const sessionRef = useRef({ active: false, pending: false })

  useEffect(() => {
    const session = { active, pending: false }
    sessionRef.current = session
    setPending(false)
    setOpen(false)
    setView('menu')
    return () => {
      session.active = false
      onPendingChange(false)
    }
  }, [active, onPendingChange])

  useEffect(() => {
    if (!image) {
      setPreview(undefined)
      return
    }
    const url = URL.createObjectURL(new Blob([image], { type: 'image/webp' }))
    setPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [image])

  const chooseImage = async (file: File) => {
    const session = sessionRef.current
    if (!session.active || session.pending || disabled) return
    session.pending = true
    setPending(true)
    onPendingChange(true)
    try {
      const data = await prepareAvatarImage(file, () => session.active)
      if (!data) return
      onChange(emoji, data)
      setOpen(false)
    } catch (error) {
      if (session.active) toast.error((error as Error).message)
    } finally {
      session.pending = false
      if (session.active) {
        setPending(false)
        onPendingChange(false)
      }
    }
  }

  const chooseEmoji = (next: string) => {
    onChange(next)
    setOpen(false)
    setView('menu')
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) setView('menu')
      }}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          disabled={disabled || pending}
          aria-label={t('library.config.dialogs.create.avatar_aria')}
          className="size-8 shrink-0 rounded-lg p-0">
          {preview ? (
            <img src={preview} alt={t('common.avatar')} className="size-8 rounded-lg object-cover" />
          ) : (
            <EmojiAvatar size={32} fontSize={18} className="rounded-lg">
              {emoji}
            </EmojiAvatar>
          )}
        </Button>
      </PopoverTrigger>
      <input
        ref={inputRef}
        type="file"
        className="hidden"
        disabled={disabled || pending}
        aria-label={t('settings.general.image_upload')}
        accept="image/png, image/jpeg, image/gif, image/webp"
        onChange={(event) => {
          const file = event.target.files?.[0]
          event.target.value = ''
          if (file) void chooseImage(file)
        }}
      />
      <PopoverContent portalContainer={portalContainer} className="w-auto p-2" align="center" sideOffset={6}>
        {view === 'emoji' ? (
          <EmojiPicker onEmojiClick={chooseEmoji} />
        ) : (
          <ColFlex className="w-40 gap-1">
            <Button
              type="button"
              variant="ghost"
              className="w-full justify-start"
              disabled={disabled || pending}
              onClick={() => inputRef.current?.click()}>
              <ImageUp aria-hidden />
              {t('settings.general.image_upload')}
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="w-full justify-start"
              disabled={disabled || pending}
              onClick={() => setView('emoji')}>
              <Smile aria-hidden />
              {t('settings.general.emoji_picker')}
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="w-full justify-start"
              disabled={disabled || pending}
              onClick={() => chooseEmoji(fallback)}>
              <RotateCcw aria-hidden />
              {t('settings.general.avatar.reset')}
            </Button>
          </ColFlex>
        )}
      </PopoverContent>
    </Popover>
  )
}
