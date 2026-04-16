import { Button } from '@cherrystudio/ui'
import { resolveProviderIcon } from '@cherrystudio/ui/icons'
import { loggerService } from '@logger'
import { AiProvider } from '@renderer/aiCore'
import IcImageUp from '@renderer/assets/images/paintings/ic_ImageUp.svg'
import { PROVIDER_URLS } from '@renderer/config/providers'
import {
  getPaintingsBackgroundOptionsLabel,
  getPaintingsImageSizeOptionsLabel,
  getPaintingsModerationOptionsLabel,
  getPaintingsQualityOptionsLabel
} from '@renderer/i18n/label'
import FileManager from '@renderer/services/FileManager'
import type { PaintingCanvas } from '@renderer/types'
import { uuid } from '@renderer/utils'

import { SettingHelpLink } from '../../settings'
import type { BaseConfigItem } from '../components/PaintingConfigFieldRenderer'
import PaintingsSectionTitle from '../components/PaintingsSectionTitle'
import { DEFAULT_PAINTING, MODELS, SUPPORTED_MODELS } from '../config/NewApiConfig'
import { checkProviderEnabled } from '../utils'
import { processResult, runGeneration } from '../utils/runGeneration'
import type { GenerateContext, PaintingProviderDefinition } from './types'

const logger = loggerService.withContext('NewApiProvider')

// Module-level store for edit mode image files per provider instance
const editImageFilesStore = new Map<string, File[]>()

function getEditImageFiles(providerId: string): File[] {
  return editImageFilesStore.get(providerId) || []
}

function addEditImageFile(providerId: string, file: File): void {
  const current = getEditImageFiles(providerId)
  editImageFilesStore.set(providerId, [...current, file])
}

function removeEditImageFile(providerId: string, index: number): void {
  const current = getEditImageFiles(providerId)
  editImageFilesStore.set(
    providerId,
    current.filter((_, i) => i !== index)
  )
}

function getModelOptions(provider: {
  models: Array<{ id: string; name: string; endpoint_type?: string; group?: string }>
}) {
  return provider.models
    .filter((m) => m.endpoint_type && m.endpoint_type === 'image-generation')
    .map((m) => ({
      label: m.name,
      value: m.id,
      custom: !SUPPORTED_MODELS.includes(m.id),
      group: m.group || ''
    }))
}

function buildConfigFields(): Record<string, BaseConfigItem[]> {
  const generateFields: BaseConfigItem[] = [
    {
      type: 'select',
      key: 'size',
      title: 'paintings.image.size',
      condition: (painting) => {
        const modelConfig = MODELS.find((m) => m.name === painting.model)
        return !!(modelConfig?.imageSizes && modelConfig.imageSizes.length > 0)
      },
      options: (_config, painting) => {
        const modelConfig = MODELS.find((m) => m.name === painting.model)
        return (modelConfig?.imageSizes || []).map((s) => ({
          label: getPaintingsImageSizeOptionsLabel(s.value) ?? s.value,
          value: s.value
        }))
      }
    },
    {
      type: 'select',
      key: 'quality',
      title: 'paintings.quality',
      condition: (painting) => {
        const modelConfig = MODELS.find((m) => m.name === painting.model)
        return !!(modelConfig?.quality && modelConfig.quality.length > 0)
      },
      options: (_config, painting) => {
        const modelConfig = MODELS.find((m) => m.name === painting.model)
        return (modelConfig?.quality || []).map((q) => ({
          label: getPaintingsQualityOptionsLabel(q.value) ?? q.value,
          value: q.value
        }))
      }
    },
    {
      type: 'select',
      key: 'moderation',
      title: 'paintings.moderation',
      condition: (painting) => {
        const modelConfig = MODELS.find((m) => m.name === painting.model)
        return !!(modelConfig?.moderation && modelConfig.moderation.length > 0)
      },
      options: (_config, painting) => {
        const modelConfig = MODELS.find((m) => m.name === painting.model)
        return (modelConfig?.moderation || []).map((m) => ({
          label: getPaintingsModerationOptionsLabel(m.value) ?? m.value,
          value: m.value
        }))
      }
    },
    {
      type: 'inputNumber',
      key: 'n',
      title: 'paintings.number_images',
      min: 1,
      condition: (painting) => {
        const modelConfig = MODELS.find((m) => m.name === painting.model)
        return !!modelConfig?.max_images
      },
      max: 10
    }
  ]

  const editFields: BaseConfigItem[] = [
    {
      type: 'select',
      key: 'size',
      title: 'paintings.image.size',
      condition: (painting) => {
        const modelConfig = MODELS.find((m) => m.name === painting.model)
        return !!(modelConfig?.imageSizes && modelConfig.imageSizes.length > 0)
      },
      options: (_config, painting) => {
        const modelConfig = MODELS.find((m) => m.name === painting.model)
        return (modelConfig?.imageSizes || []).map((s) => ({
          label: getPaintingsImageSizeOptionsLabel(s.value) ?? s.value,
          value: s.value
        }))
      }
    },
    {
      type: 'select',
      key: 'quality',
      title: 'paintings.quality',
      condition: (painting) => {
        const modelConfig = MODELS.find((m) => m.name === painting.model)
        return !!(modelConfig?.quality && modelConfig.quality.length > 0)
      },
      options: (_config, painting) => {
        const modelConfig = MODELS.find((m) => m.name === painting.model)
        return (modelConfig?.quality || []).map((q) => ({
          label: getPaintingsQualityOptionsLabel(q.value) ?? q.value,
          value: q.value
        }))
      }
    },
    {
      type: 'select',
      key: 'background',
      title: 'paintings.background',
      condition: (painting) => {
        const modelConfig = MODELS.find((m) => m.name === painting.model)
        return !!(modelConfig?.background && modelConfig.background.length > 0)
      },
      options: (_config, painting) => {
        const modelConfig = MODELS.find((m) => m.name === painting.model)
        return (modelConfig?.background || []).map((b) => ({
          label: getPaintingsBackgroundOptionsLabel(b.value) ?? b.value,
          value: b.value
        }))
      }
    },
    {
      type: 'inputNumber',
      key: 'n',
      title: 'paintings.number_images',
      min: 1,
      condition: (painting) => {
        const modelConfig = MODELS.find((m) => m.name === painting.model)
        return !!modelConfig?.max_images
      },
      max: 10
    }
  ]

  return {
    generate: generateFields,
    edit: editFields
  }
}

const configFieldsByMode = buildConfigFields()

export function createNewApiProvider(providerId: string): PaintingProviderDefinition {
  return {
    providerId,

    modes: [
      { value: 'generate', labelKey: 'paintings.mode.generate' },
      { value: 'edit', labelKey: 'paintings.mode.edit' }
    ],
    defaultMode: 'generate',

    modeToDbMode: (mode: string) => mode as any,

    models: {
      type: 'dynamic',
      resolver: (provider) => getModelOptions(provider as any)
    },

    configFields: configFieldsByMode,

    getDefaultPainting: (_mode, models) => {
      const availableModels = models || []
      return {
        ...DEFAULT_PAINTING,
        id: uuid(),
        model: availableModels[0]?.value || '',
        providerId
      }
    },

    onModelChange: (modelId) => {
      const modelConfig = MODELS.find((m) => m.name === modelId)
      const updates: Partial<PaintingCanvas> = { model: modelId }

      if (modelConfig?.imageSizes?.length) {
        updates.size = modelConfig.imageSizes[0].value
      }
      if (modelConfig?.quality?.length) {
        updates.quality = modelConfig.quality[0].value
      }
      if (modelConfig?.moderation?.length) {
        updates.moderation = modelConfig.moderation[0].value
      }
      updates.n = 1
      return updates
    },

    showTranslate: true,

    providerHeaderExtra: (provider, t) => {
      const Icon = resolveProviderIcon(provider.id)
      return (
        <SettingHelpLink
          target="_blank"
          href={
            PROVIDER_URLS[provider.id as keyof typeof PROVIDER_URLS]?.websites?.docs ||
            'https://docs.newapi.pro/apps/cherry-studio/'
          }>
          {t('paintings.learn_more')}
          {Icon ? <Icon.Avatar size={16} className="ml-[5px]" /> : null}
        </SettingHelpLink>
      )
    },

    promptPlaceholder: (painting, t, isTranslating) => {
      if (isTranslating) return t('paintings.translating')
      if (painting.model?.startsWith('imagen-')) {
        return t('paintings.prompt_placeholder_en')
      }
      return t('paintings.prompt_placeholder_edit')
    },

    sidebarExtra: (state) => {
      const { painting, mode, modelOptions, t, patchPainting } = state
      const actualProviderId = painting.providerId || providerId

      // When no image-generation models are available, show guidance
      if (modelOptions.length === 0) {
        return (
          <div className="mt-6 rounded-md border border-border border-dashed bg-muted/10 p-6 text-center">
            <div className="mb-3 text-muted-foreground text-sm">
              {t('paintings.no_image_generation_model', {
                endpoint_type: t('endpoint_type.image-generation')
              })}
            </div>
            <Button
              variant="default"
              onClick={() => {
                window.location.hash = `/settings/provider?id=${actualProviderId}`
              }}>
              {t('paintings.go_to_settings')}
            </Button>
          </div>
        )
      }

      // Edit mode: image upload UI
      if (mode === 'edit') {
        const editFiles = getEditImageFiles(actualProviderId)
        return (
          <div className="mt-1">
            <PaintingsSectionTitle className="mt-0 mb-3">{t('paintings.input_image')}</PaintingsSectionTitle>
            <div className="flex flex-col gap-2">
              <label className="flex min-h-[60px] cursor-pointer items-center justify-center gap-2 rounded-md border border-border border-dashed bg-muted/20 hover:bg-muted/30">
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/gif"
                  multiple
                  className="hidden"
                  onChange={(event) => {
                    const files = Array.from(event.target.files || [])
                    files.forEach((file) => addEditImageFile(actualProviderId, file))
                    event.target.value = ''
                    // Force a re-render by touching painting state
                    patchPainting({} as Partial<PaintingCanvas>)
                  }}
                />
                <img src={IcImageUp} alt={t('common.upload_image')} className="h-5 w-5" />
                <span className="text-muted-foreground text-sm">{t('paintings.input_image')}</span>
              </label>

              {editFiles.length > 0 && (
                <div className="flex flex-col gap-2">
                  {editFiles.map((file, idx) => (
                    <div
                      key={`${file.name}-${idx}`}
                      className="flex items-center justify-between rounded-md border border-border bg-muted/10 px-3 py-2 text-sm">
                      <span className="truncate">{file.name || `image_${idx + 1}.png`}</span>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          removeEditImageFile(actualProviderId, idx)
                          patchPainting({} as Partial<PaintingCanvas>)
                        }}>
                        {t('common.delete')}
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )
      }

      return null
    },

    async onGenerate(ctx: GenerateContext) {
      const { painting, provider, abortController, patchPainting, t, mode } = ctx

      await checkProviderEnabled(provider, t)

      if (painting.files.length > 0) {
        const confirmed = await window.modal.confirm({
          content: t('paintings.regenerate.confirm'),
          centered: true
        })
        if (!confirmed) return
        await FileManager.deleteFiles(painting.files)
      }

      const prompt = painting.prompt || ''
      patchPainting({ prompt } as Partial<PaintingCanvas>)

      const AI = new AiProvider(provider)

      if (!AI.getApiKey()) {
        window.modal.error({
          content: t('error.no_api_key'),
          centered: true
        })
        return
      }

      if (!painting.model || !painting.prompt) return

      await runGeneration(ctx, async () => {
        let body: string | FormData = ''
        const headers: Record<string, string> = {
          Authorization: `Bearer ${AI.getApiKey()}`
        }

        let url = provider.apiHost.replace(/\/v1$/, '') + `/v1/images/generations`
        let editUrl = provider.apiHost.replace(/\/v1$/, '') + `/v1/images/edits`
        if (provider.id === 'aionly') {
          url = provider.apiHost.replace(/\/v1$/, '') + `/openai/v1/images/generations`
          editUrl = provider.apiHost.replace(/\/v1$/, '') + `/openai/v1/images/edits`
        }
        if (mode === 'generate') {
          const requestData = {
            prompt,
            model: painting.model,
            size: painting.size === 'auto' ? undefined : painting.size,
            background: painting.background === 'auto' ? undefined : painting.background,
            n: painting.n,
            quality: painting.quality === 'auto' ? undefined : painting.quality,
            moderation: painting.moderation === 'auto' ? undefined : painting.moderation
          }

          body = JSON.stringify(requestData)
          headers['Content-Type'] = 'application/json'
        } else if (mode === 'edit') {
          const editImages = getEditImageFiles(provider.id)

          if (editImages.length === 0) {
            window.toast.warning(t('paintings.image_file_required'))
            return
          }

          const formData = new FormData()
          formData.append('prompt', prompt)
          formData.append('model', painting.model)
          if (painting.background && painting.background !== 'auto') {
            formData.append('background', painting.background)
          }
          if (painting.size && painting.size !== 'auto') {
            formData.append('size', painting.size)
          }
          if (painting.quality && painting.quality !== 'auto') {
            formData.append('quality', painting.quality)
          }
          if (painting.moderation && painting.moderation !== 'auto') {
            formData.append('moderation', painting.moderation)
          }

          editImages.forEach((file) => {
            formData.append('image', file)
          })

          body = formData
        }

        const requestUrl = mode === 'edit' ? editUrl : url
        const response = await fetch(requestUrl, { method: 'POST', headers, body, signal: abortController.signal })

        if (!response.ok) {
          const errorData = await response.json()
          throw new Error(errorData.error?.message || t('paintings.generate_failed'))
        }

        const data = await response.json()
        const urls = data.data.filter((item: any) => item.url).map((item: any) => item.url)
        const base64s = data.data.filter((item: any) => item.b64_json).map((item: any) => item.b64_json)

        if (urls.length > 0) {
          await processResult(ctx, { urls })
        }

        if (base64s?.length > 0) {
          await processResult(ctx, { base64s })
        }
      })
    }
  }
}
