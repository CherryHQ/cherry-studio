import { useEffect, useRef, useState } from 'react'
import { type UseFormReturn, useWatch } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import { AvatarPicker } from '@renderer/components/resourceCatalog/dialogs/components/AvatarPicker'
import { prepareAvatarImage } from '@renderer/components/resourceCatalog/dialogs/components/prepareAvatarImage'
import { toast } from '@renderer/services/toast'
import { getErrorMessage } from '@renderer/utils/error'
import { blobToDataUrl } from '@renderer/utils/image'

import type { ResourceCreateWizardFormValues } from '../types'

type CreateAvatarPickerProps = {
  form: UseFormReturn<ResourceCreateWizardFormValues>
  fallbackAvatar: string
  portalContainer: HTMLElement | null
  disabled?: boolean
  size?: 'sm' | 'md' | 'lg'
  avatarClassName?: string
  avatarFontSize?: number
}

/** The create flow's avatar picker: every choice stays in the form until the resource is created. */
export function CreateAvatarPicker({ form, fallbackAvatar, ...display }: CreateAvatarPickerProps) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState(false)
  const [avatar, avatarImage] = useWatch({ control: form.control, name: ['avatar', 'avatarImage'] })
  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const upload = async (file: File) => {
    setPending(true)
    try {
      const data = await prepareAvatarImage(file, () => mountedRef.current)
      if (!data) return
      const previewUrl = await blobToDataUrl(new Blob([data], { type: 'image/webp' }))
      if (!mountedRef.current) return
      form.setValue('avatarImage', { data, previewUrl }, { shouldDirty: true })
      setOpen(false)
    } catch (error) {
      if (mountedRef.current) toast.error(getErrorMessage(error))
    } finally {
      if (mountedRef.current) setPending(false)
    }
  }

  return (
    <AvatarPicker
      {...display}
      emoji={avatar || fallbackAvatar}
      imageSrc={avatarImage?.previewUrl}
      open={open}
      onOpenChange={setOpen}
      onEmojiChange={(emoji) => {
        form.setValue('avatar', emoji, { shouldDirty: true })
        form.setValue('avatarImage', null, { shouldDirty: true })
      }}
      onUpload={(file) => void upload(file)}
      onReset={() => {
        form.setValue('avatarImage', null, { shouldDirty: true })
        setOpen(false)
      }}
      ariaLabel={t('library.config.dialogs.create.avatar_aria')}
      pending={pending}
    />
  )
}
