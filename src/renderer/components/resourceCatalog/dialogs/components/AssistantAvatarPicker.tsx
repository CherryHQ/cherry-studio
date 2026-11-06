import { ImageUp, RotateCcw, Smile } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button, ColFlex, EmojiAvatar, Popover, PopoverContent, PopoverTrigger } from '@cherrystudio/ui'
import { dataApiService } from '@data/DataApiService'
import { AssistantAvatarImage } from '@renderer/components/Avatar/AssistantAvatarImage'
import { EmojiPicker } from '@renderer/components/EmojiPicker'
import { useInvalidateCache } from '@renderer/data/hooks/useDataApi'
import { ipcApi } from '@renderer/ipc'
import { toast } from '@renderer/services/toast'
import { checkEntityImageSize, prepareEntityImageBytes } from '@renderer/utils/image'
import type { InputFor } from '@shared/ipc/types'

type Props = {
  assistantId: string
  emoji: string
  avatarSrc?: string
  ariaLabel: string
  portalContainer: HTMLElement | null
  size?: 'sm' | 'md'
  onChanged?: (next: { avatarSrc?: string; emoji: string }) => void
}

export function AssistantAvatarPicker({
  assistantId,
  emoji,
  avatarSrc,
  ariaLabel,
  portalContainer,
  size = 'md',
  onChanged
}: Props) {
  const { t } = useTranslation()
  const invalidate = useInvalidateCache()
  const [open, setOpen] = useState(false)
  const [view, setView] = useState<'menu' | 'emoji'>('menu')
  const [pending, setPending] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const sessionRef = useRef({ active: true, pending: false })
  useEffect(() => {
    const session = { active: true, pending: false }
    sessionRef.current = session
    setPending(false)
    setOpen(false)
    setView('menu')
    return () => {
      session.active = false
    }
  }, [assistantId])

  const save = async (intent: InputFor<'assistant.set_avatar'>['avatar'] | File) => {
    const id = assistantId
    const session = sessionRef.current
    if (session.pending) return
    session.pending = true
    setPending(true)
    try {
      let avatar: InputFor<'assistant.set_avatar'>['avatar']
      if (intent instanceof File) {
        const sizeError = checkEntityImageSize(intent)
        if (sizeError) {
          toast.error(sizeError)
          return
        }
        avatar = { kind: 'image', data: await prepareEntityImageBytes(intent) }
      } else {
        avatar = intent
      }
      if (!session.active) return
      await ipcApi.request('assistant.set_avatar', { assistantId: id, avatar })
      await invalidate([`/assistants/${id}`, '/assistants'])
      if (!session.active) return
      setOpen(false)
      setView('menu')
      if (onChanged) {
        const data = await dataApiService.get(`/assistants/${id}`)
        if (session.active) onChanged({ avatarSrc: data.avatarSrc, emoji: data.emoji })
      }
    } catch (error: any) {
      if (session.active) toast.error(error.message)
    } finally {
      session.pending = false
      if (session.active) setPending(false)
    }
  }

  const avatarSize = size === 'sm' ? 36 : 32
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
          disabled={pending}
          aria-label={ariaLabel}
          className={`shrink-0 rounded-lg p-0 ${size === 'sm' ? 'size-9' : 'size-8'}`}>
          <AssistantAvatarImage
            src={avatarSrc}
            alt={ariaLabel}
            size={avatarSize}
            className="rounded-lg object-cover"
            fallback={
              <EmojiAvatar
                size={avatarSize}
                fontSize={size === 'sm' ? 18 : 16}
                className="rounded-lg border border-border">
                {emoji}
              </EmojiAvatar>
            }
          />
        </Button>
      </PopoverTrigger>
      <PopoverContent portalContainer={portalContainer} className="w-auto p-2" align="center" sideOffset={6}>
        {view === 'emoji' ? (
          <fieldset disabled={pending} aria-busy={pending}>
            <EmojiPicker onEmojiClick={(next) => void save({ kind: 'emoji', emoji: next })} />
          </fieldset>
        ) : (
          <ColFlex className="w-40 gap-1">
            <input
              ref={inputRef}
              type="file"
              className="hidden"
              disabled={pending}
              aria-label={t('settings.general.image_upload')}
              accept="image/png, image/jpeg, image/gif, image/webp"
              onChange={(event) => {
                const file = event.target.files?.[0]
                event.target.value = ''
                if (file) void save(file)
              }}
            />
            <Button
              type="button"
              variant="ghost"
              className="w-full justify-start"
              disabled={pending}
              onClick={() => inputRef.current?.click()}>
              <ImageUp aria-hidden />
              {t('settings.general.image_upload')}
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="w-full justify-start"
              disabled={pending}
              onClick={() => setView('emoji')}>
              <Smile aria-hidden />
              {t('settings.general.emoji_picker')}
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="w-full justify-start"
              disabled={pending}
              onClick={() => void save({ kind: 'default' })}>
              <RotateCcw aria-hidden />
              {t('settings.general.avatar.reset')}
            </Button>
          </ColFlex>
        )}
      </PopoverContent>
    </Popover>
  )
}
