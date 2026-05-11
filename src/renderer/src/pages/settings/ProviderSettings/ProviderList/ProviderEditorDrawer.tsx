import { Button, Input, Popover, PopoverContent, PopoverTrigger, SelectDropdown } from '@cherrystudio/ui'
import { ProviderAvatarPrimitive } from '@renderer/components/ProviderAvatar'
import ProviderLogoPicker from '@renderer/components/ProviderLogoPicker'
import { compressImage, convertToBase64, generateColorFromChar, getForegroundColor } from '@renderer/utils'
import { ENDPOINT_TYPE, type EndpointType } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import { ImagePlus, RotateCcw } from 'lucide-react'
import { type ChangeEvent, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import ProviderSettingsDrawer from '../primitives/ProviderSettingsDrawer'

type ProviderEditorSubmit = {
  name: string
  defaultChatEndpoint: EndpointType
  logo?: string | null
}

interface ProviderEditorDrawerProps {
  open: boolean
  provider?: Provider | null
  initialLogo?: string
  onClose: () => void
  onSubmit: (providerInput: ProviderEditorSubmit) => Promise<void>
}

const endpointOptions = [
  { id: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS, label: 'OpenAI' },
  { id: ENDPOINT_TYPE.OPENAI_RESPONSES, label: 'OpenAI Responses' },
  { id: ENDPOINT_TYPE.ANTHROPIC_MESSAGES, label: 'Anthropic' },
  { id: ENDPOINT_TYPE.GOOGLE_GENERATE_CONTENT, label: 'Gemini' },
  { id: ENDPOINT_TYPE.OLLAMA_CHAT, label: 'Ollama' }
] as const

export default function ProviderEditorDrawer({
  open,
  provider,
  initialLogo,
  onClose,
  onSubmit
}: ProviderEditorDrawerProps) {
  const { t } = useTranslation()
  const uploadInputRef = useRef<HTMLInputElement | null>(null)
  const [name, setName] = useState('')
  const [selectedEndpoint, setSelectedEndpoint] = useState<EndpointType>(ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS)
  const [logo, setLogo] = useState<string | null>(null)
  const [logoDirty, setLogoDirty] = useState(false)
  const [logoPickerOpen, setLogoPickerOpen] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const previousOpenRef = useRef(false)

  const isEditing = provider != null

  useEffect(() => {
    const wasOpen = previousOpenRef.current
    previousOpenRef.current = open

    if (!open || wasOpen) {
      return
    }

    setName(provider?.name ?? '')
    setSelectedEndpoint(provider?.defaultChatEndpoint ?? ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS)
    setLogoDirty(false)
    setLogoPickerOpen(false)
  }, [open, provider])

  useEffect(() => {
    if (!open || logoDirty) {
      return
    }

    setLogo(initialLogo ?? null)
  }, [initialLogo, logoDirty, open])

  const previewName = name.trim()
  const avatarBackgroundColor = useMemo(
    () => (previewName ? generateColorFromChar(previewName) : undefined),
    [previewName]
  )
  const avatarForegroundColor = useMemo(
    () => (avatarBackgroundColor ? getForegroundColor(avatarBackgroundColor) : undefined),
    [avatarBackgroundColor]
  )

  const handleUploadChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''

    if (!file) {
      return
    }

    const processedFile = file.type === 'image/gif' ? file : await compressImage(file)
    const encoded = await convertToBase64(processedFile)
    if (typeof encoded === 'string') {
      setLogo(encoded)
      setLogoDirty(true)
    }
  }

  const handleSubmit = async () => {
    const trimmedName = name.trim()
    if (!trimmedName) {
      return
    }

    setIsSubmitting(true)
    try {
      await onSubmit({
        name: trimmedName,
        defaultChatEndpoint: selectedEndpoint,
        logo: isEditing ? (logoDirty ? logo : undefined) : (logo ?? undefined)
      })
    } catch {
      window.toast.error(t('blocks.edit.save.failed.label'))
    } finally {
      setIsSubmitting(false)
    }
  }

  const footer = (
    <div className="flex items-center justify-end gap-2">
      <Button variant="outline" onClick={onClose}>
        {t('common.cancel')}
      </Button>
      <Button disabled={!name.trim() || isSubmitting} loading={isSubmitting} onClick={() => void handleSubmit()}>
        {isEditing ? t('common.save') : t('button.add')}
      </Button>
    </div>
  )

  return (
    <ProviderSettingsDrawer
      open={open}
      onClose={onClose}
      title={t(isEditing ? 'common.edit' : 'settings.provider.add.title')}
      size="compact"
      footer={footer}>
      <div className="flex flex-col gap-5">
        <div className="flex flex-col items-center gap-3">
          <div
            className="flex h-[76px] w-[76px] items-center justify-center overflow-hidden rounded-full border border-border/70 bg-muted/50"
            style={
              avatarBackgroundColor && avatarForegroundColor
                ? { backgroundColor: avatarBackgroundColor, color: avatarForegroundColor }
                : undefined
            }>
            <ProviderAvatarPrimitive
              providerId={provider?.id ?? 'provider-editor-preview'}
              providerName={name || 'Provider'}
              logo={logo ?? undefined}
              size={76}
            />
          </div>
          <div className="flex flex-wrap items-center justify-center gap-2">
            <Button variant="outline" onClick={() => uploadInputRef.current?.click()}>
              <ImagePlus size={16} />
              {t('settings.general.image_upload')}
            </Button>
            <Popover open={logoPickerOpen} onOpenChange={setLogoPickerOpen}>
              <PopoverTrigger asChild>
                <Button variant="outline">{t('settings.general.avatar.builtin')}</Button>
              </PopoverTrigger>
              <PopoverContent
                align="center"
                sideOffset={8}
                className="w-auto border-none bg-transparent p-0 shadow-none">
                <ProviderLogoPicker
                  onProviderClick={(providerId) => {
                    setLogo(`icon:${providerId}`)
                    setLogoDirty(true)
                    setLogoPickerOpen(false)
                  }}
                />
              </PopoverContent>
            </Popover>
            <Button
              variant="outline"
              disabled={!logo && !initialLogo}
              onClick={() => {
                setLogo(null)
                setLogoDirty(true)
              }}>
              <RotateCcw size={16} />
              {t('settings.general.avatar.reset')}
            </Button>
          </div>
          <input
            ref={uploadInputRef}
            type="file"
            accept="image/png,image/jpeg,image/gif"
            className="hidden"
            onChange={(event) => void handleUploadChange(event)}
          />
        </div>

        <div className="space-y-2">
          <label className="font-medium text-[13px] text-foreground/85">{t('settings.provider.add.name.label')}</label>
          <Input
            value={name}
            placeholder={t('settings.provider.add.name.placeholder')}
            maxLength={32}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.nativeEvent.isComposing && !isSubmitting) {
                void handleSubmit()
              }
            }}
          />
        </div>

        <div className="space-y-2">
          <label className="font-medium text-[13px] text-foreground/85">{t('settings.provider.add.type')}</label>
          <SelectDropdown
            items={endpointOptions.map((option) => ({ id: option.id, label: option.label }))}
            selectedId={selectedEndpoint}
            onSelect={(value) => setSelectedEndpoint(value as EndpointType)}
            renderSelected={(item) => <span className="truncate">{item.label}</span>}
            renderItem={(item) => <span className="truncate">{item.label}</span>}
          />
        </div>
      </div>
    </ProviderSettingsDrawer>
  )
}
