import { useEffect, useRef, useState } from 'react'

import { dataApiService } from '@data/DataApiService'
import { useInvalidateCache } from '@renderer/data/hooks/useDataApi'
import { ipcApi } from '@renderer/ipc'
import { toast } from '@renderer/services/toast'
import type { InputFor } from '@shared/ipc/types'

import { AvatarPicker } from './AvatarPicker'
import { prepareAvatarImage } from './prepareAvatarImage'

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
  const invalidate = useInvalidateCache()
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState(false)
  const sessionRef = useRef({ active: true, pending: false })
  useEffect(() => {
    const session = { active: true, pending: false }
    sessionRef.current = session
    setPending(false)
    setOpen(false)
    return () => {
      session.active = false
    }
  }, [assistantId])

  // The picker closes itself on an emoji pick, and 🎲 stays open for another roll.
  const save = async (intent: InputFor<'assistant.set_avatar'>['avatar'] | File, keepOpen = false) => {
    const id = assistantId
    const session = sessionRef.current
    if (session.pending) return
    session.pending = true
    setPending(true)
    try {
      let avatar: InputFor<'assistant.set_avatar'>['avatar']
      if (intent instanceof File) {
        const data = await prepareAvatarImage(intent, () => session.active)
        if (!data) return
        avatar = { kind: 'image', data }
      } else {
        avatar = intent
      }
      if (!session.active) return
      await ipcApi.request('assistant.set_avatar', { assistantId: id, avatar })
      await invalidate([`/assistants/${id}`, '/assistants'])
      if (!session.active) return
      if (!keepOpen) setOpen(false)
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

  return (
    <AvatarPicker
      emoji={emoji}
      imageSrc={avatarSrc}
      open={open}
      onOpenChange={setOpen}
      onEmojiChange={(next) => void save({ kind: 'emoji', emoji: next }, true)}
      onUpload={(file) => void save(file)}
      onReset={() => void save({ kind: 'default' })}
      ariaLabel={ariaLabel}
      pending={pending}
      portalContainer={portalContainer}
      size={size}
    />
  )
}
