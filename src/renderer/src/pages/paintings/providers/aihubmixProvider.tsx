import { resolveProviderIcon } from '@cherrystudio/ui/icons'
import { loggerService } from '@logger'
import { AiProvider } from '@renderer/aiCore'
import IcImageUp from '@renderer/assets/images/paintings/ic_ImageUp.svg'
import FileManager from '@renderer/services/FileManager'
import type { PaintingCanvas } from '@renderer/types'
import { uuid } from '@renderer/utils'

import { SettingHelpLink } from '../../settings'
import { type AihubmixMode, createModeConfigs, DEFAULT_PAINTING } from '../config/aihubmixConfig'
import { checkProviderEnabled } from '../utils'
import { processResult, runGeneration } from '../utils/runGeneration'
import type { GenerateContext, PaintingProviderDefinition } from './types'

const logger = loggerService.withContext('AihubmixProvider')

// Module-level store for File objects (object URL -> File)
// Needed because config renderer creates object URLs for preview,
// but onGenerate needs the actual File for FormData.
const fileStore = new Map<string, File>()

const modeConfigs = createModeConfigs()

type AihubmixPaintingMode = 'generate' | 'remix' | 'upscale'

const MODE_TO_CONFIG: Record<AihubmixPaintingMode, AihubmixMode> = {
  generate: 'aihubmix_image_generate',
  remix: 'aihubmix_image_remix',
  upscale: 'aihubmix_image_upscale'
}

// Build config fields keyed by UI mode name
const configFieldsByMode: Record<string, any[]> = {
  generate: modeConfigs.aihubmix_image_generate.filter((item) => item.key !== 'model') as any[],
  remix: modeConfigs.aihubmix_image_remix.filter((item) => item.key !== 'model') as any[],
  upscale: modeConfigs.aihubmix_image_upscale.filter((item) => item.key !== 'model') as any[]
}

// Build model options from the config's model select item per mode
function getStaticModelsForMode(mode: AihubmixPaintingMode) {
  const configKey = MODE_TO_CONFIG[mode]
  const modelItem = modeConfigs[configKey].find((item) => item.key === 'model')
  if (!modelItem || !Array.isArray(modelItem.options)) return []

  const result: Array<{ label: string; value: string; group?: string }> = []
  for (const opt of modelItem.options) {
    if (opt.options && Array.isArray(opt.options)) {
      // Grouped options
      for (const sub of opt.options) {
        result.push({
          label: sub.label || String(sub.value),
          value: String(sub.value),
          group: opt.label || opt.title
        })
      }
    } else if (opt.value !== undefined) {
      result.push({
        label: opt.label || String(opt.value),
        value: String(opt.value)
      })
    }
  }
  return result
}

export const aihubmixProvider: PaintingProviderDefinition = {
  providerId: 'aihubmix',

  modes: [
    { value: 'generate', labelKey: 'paintings.mode.generate' },
    { value: 'remix', labelKey: 'paintings.mode.remix' },
    { value: 'upscale', labelKey: 'paintings.mode.upscale' }
  ],
  defaultMode: 'generate',

  models: (mode: string) => ({
    type: 'static' as const,
    options: getStaticModelsForMode(mode as AihubmixPaintingMode)
  }),

  configFields: configFieldsByMode,

  getDefaultPainting: (mode) => {
    return {
      ...DEFAULT_PAINTING,
      model: mode === 'generate' ? 'gemini-3-pro-image-preview' : 'V_3',
      id: uuid()
    }
  },

  onModelChange: (modelId) => ({ model: modelId }),

  showTranslate: true,

  providerHeaderExtra: (provider, t) => {
    const Icon = resolveProviderIcon('aihubmix')
    return (
      <SettingHelpLink target="_blank" href={provider.apiHost}>
        {t('paintings.learn_more')}
        {Icon ? <Icon.Avatar size={16} className="ml-[5px]" /> : null}
      </SettingHelpLink>
    )
  },

  promptPlaceholder: (painting, t, isTranslating) => {
    if (isTranslating) return t('paintings.translating')
    if (painting.model?.startsWith('imagen-') || painting.model?.startsWith('FLUX')) {
      return t('paintings.prompt_placeholder_en')
    }
    return t('paintings.prompt_placeholder_edit')
  },

  // Image upload handling
  onImageUpload: (key, file, patchPainting) => {
    const path = URL.createObjectURL(file)
    fileStore.set(path, file)
    patchPainting({ [key]: path } as Partial<PaintingCanvas>)
  },

  getImagePreviewSrc: (key, painting) => {
    return painting[key as keyof PaintingCanvas] as string | undefined
  },

  imagePlaceholder: <img src={IcImageUp} className="mt-2" />,

  async onGenerate(ctx: GenerateContext) {
    const { painting, provider, abortController, patchPainting, t } = ctx

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

    if (!provider.apiKey) {
      window.modal.error({
        content: t('error.no_api_key'),
        centered: true
      })
      return
    }

    if (!painting.model || !painting.prompt) return

    await runGeneration(ctx, async () => {
      const mode = (ctx.mode || 'generate') as AihubmixPaintingMode

      let body: string | FormData = ''
      let headers: Record<string, string> = {
        'Api-Key': provider.apiKey
      }
      let url = provider.apiHost + `/ideogram/` + MODE_TO_CONFIG[mode]
      if (mode === 'generate') {
        if (painting.model.startsWith('imagen-')) {
          const AI = new AiProvider(provider)
          const base64s = await AI.generateImage({
            prompt,
            model: painting.model,
            imageSize: painting.aspectRatio?.replace('ASPECT_', '').replace('_', ':') || '1:1',
            batchSize: painting.model.startsWith('imagen-4.0-ultra-generate') ? 1 : painting.numberOfImages || 1,
            personGeneration: painting.personGeneration
          })
          if (base64s?.length > 0) {
            await processResult(ctx, { base64s })
          }
          return
        } else if (painting.model === 'gemini-3-pro-image-preview') {
          const geminiUrl = `${provider.apiHost}/gemini/v1beta/models/gemini-3-pro-image-preview:streamGenerateContent`
          const geminiHeaders = {
            'Content-Type': 'application/json',
            'x-goog-api-key': provider.apiKey
          }

          const requestBody = {
            contents: [
              {
                parts: [{ text: prompt }],
                role: 'user'
              }
            ],
            generationConfig: {
              responseModalities: ['TEXT', 'IMAGE'],
              imageConfig: {
                aspectRatio: painting.aspectRatio?.replace('ASPECT_', '').replace('_', ':') || '1:1',
                imageSize: painting.imageSize || '1k'
              }
            }
          }

          logger.silly(`Gemini Request: ${JSON.stringify(requestBody)}`)

          const response = await fetch(geminiUrl, {
            method: 'POST',
            headers: geminiHeaders,
            body: JSON.stringify(requestBody)
          })

          if (!response.ok) {
            const errorData = await response.json()
            logger.error('Gemini API Error:', errorData)
            throw new Error(errorData.error?.message || t('paintings.generate_failed'))
          }

          const data = await response.json()
          logger.silly(`Gemini API Response: ${JSON.stringify(data)}`)

          const responseItems = Array.isArray(data) ? data : [data]
          const base64s: string[] = []

          responseItems.forEach((item) => {
            item.candidates?.forEach((candidate: any) => {
              candidate.content?.parts?.forEach((part: any) => {
                if (part.inlineData?.data) {
                  base64s.push(part.inlineData.data)
                }
              })
            })
          })

          if (base64s.length > 0) {
            await processResult(ctx, { base64s })
          }
          return
        } else if (painting.model === 'V_3') {
          const formData = new FormData()
          formData.append('prompt', prompt)

          const renderSpeed = painting.renderingSpeed || 'DEFAULT'
          logger.silly(`Rendering speed: ${renderSpeed}`)
          formData.append('rendering_speed', renderSpeed)
          formData.append('num_images', String(painting.numImages || 1))

          if (painting.aspectRatio) {
            const aspectRatioValue = painting.aspectRatio.replace('ASPECT_', '').replace('_', 'x').toLowerCase()
            logger.silly(`Aspect ratio: ${aspectRatioValue}`)
            formData.append('aspect_ratio', aspectRatioValue)
          }

          if (painting.styleType && painting.styleType !== 'AUTO') {
            const styleType = painting.styleType
            logger.silly(`Style type: ${styleType}`)
            formData.append('style_type', styleType)
          } else {
            logger.silly('Using default style type: AUTO')
            formData.append('style_type', 'AUTO')
          }

          if (painting.seed) {
            logger.silly(`Seed: ${painting.seed}`)
            formData.append('seed', painting.seed)
          }

          if (painting.negativePrompt) {
            logger.silly(`Negative prompt: ${painting.negativePrompt}`)
            formData.append('negative_prompt', painting.negativePrompt)
          }

          if (painting.magicPromptOption !== undefined) {
            const magicPrompt = painting.magicPromptOption ? 'ON' : 'OFF'
            logger.silly(`Magic prompt: ${magicPrompt}`)
            formData.append('magic_prompt', magicPrompt)
          }

          logger.silly('FormData contents:')
          for (const pair of formData.entries()) {
            logger.silly(`${pair[0]}: ${pair[1]}`)
          }

          const response = await fetch(`${provider.apiHost}/ideogram/v1/ideogram-v3/generate`, {
            method: 'POST',
            headers: { 'Api-Key': provider.apiKey },
            body: formData
          })

          if (!response.ok) {
            const errorData = await response.json()
            logger.error('V3 API error:', errorData)
            throw new Error(errorData.error?.message || t('paintings.generate_failed'))
          }

          const data = await response.json()
          logger.silly(`V3 API response: ${data}`)
          const urls = data.data.map((item: any) => item.url)

          if (urls.length > 0) {
            await processResult(ctx, { urls, downloadOptions: { showProxyWarning: true } })
          }
          return
        } else {
          let requestData: any = {}
          if (painting.model === 'gpt-image-1') {
            requestData = {
              prompt,
              model: painting.model,
              size: painting.size === 'auto' ? undefined : painting.size,
              n: painting.n,
              quality: painting.quality,
              moderation: painting.moderation
            }
            url = provider.apiHost + `/v1/images/generations`
            headers = {
              Authorization: `Bearer ${provider.apiKey}`
            }
          } else if (painting.model === 'FLUX.1-Kontext-pro') {
            requestData = {
              prompt,
              model: painting.model,
              safety_tolerance: painting.safetyTolerance || 6
            }
            url = provider.apiHost + `/v1/images/generations`
            headers = {
              Authorization: `Bearer ${provider.apiKey}`
            }
          } else {
            // Existing V1/V2 ideogram API
            requestData = {
              image_request: {
                prompt,
                model: painting.model,
                aspect_ratio: painting.aspectRatio,
                num_images: painting.numImages,
                style_type: painting.styleType,
                seed: painting.seed ? +painting.seed : undefined,
                negative_prompt: painting.negativePrompt || undefined,
                magic_prompt_option: painting.magicPromptOption ? 'ON' : 'OFF'
              }
            }
          }
          body = JSON.stringify(requestData)
          headers['Content-Type'] = 'application/json'
        }
      } else if (mode === 'remix') {
        if (!painting.imageFile) {
          window.modal.error({
            content: t('paintings.image_file_required'),
            centered: true
          })
          return
        }
        const file = fileStore.get(painting.imageFile)
        if (!file) {
          window.modal.error({
            content: t('paintings.image_file_retry'),
            centered: true
          })
          return
        }

        if (painting.model === 'V_3') {
          const formData = new FormData()
          formData.append('prompt', prompt)
          formData.append('rendering_speed', painting.renderingSpeed || 'DEFAULT')
          formData.append('num_images', String(painting.numImages || 1))

          if (painting.aspectRatio) {
            const aspectRatioValue = painting.aspectRatio.replace('ASPECT_', '').replace('_', 'x').toLowerCase()
            formData.append('aspect_ratio', aspectRatioValue)
          }

          if (painting.styleType) {
            formData.append('style_type', painting.styleType)
          }

          if (painting.seed) {
            formData.append('seed', painting.seed)
          }

          if (painting.negativePrompt) {
            formData.append('negative_prompt', painting.negativePrompt)
          }

          if (painting.magicPromptOption !== undefined) {
            formData.append('magic_prompt', painting.magicPromptOption ? 'ON' : 'OFF')
          }

          if (painting.imageWeight) {
            formData.append('image_weight', String(painting.imageWeight))
          }

          formData.append('image', file as unknown as Blob)

          const response = await fetch(`${provider.apiHost}/ideogram/v1/ideogram-v3/remix`, {
            method: 'POST',
            headers: { 'Api-Key': provider.apiKey },
            body: formData
          })

          if (!response.ok) {
            const errorData = await response.json()
            logger.error('V3 Remix API error:', errorData)
            throw new Error(errorData.error?.message || t('paintings.image_mix_failed'))
          }

          const data = await response.json()
          logger.silly(`V3 Remix API response: ${data}`)
          const urls = data.data.map((item: any) => item.url)

          if (urls.length > 0) {
            await processResult(ctx, { urls, downloadOptions: { showProxyWarning: true } })
          }
          return
        } else {
          // Existing V1/V2 API for remix
          const form = new FormData()
          const imageRequest: Record<string, any> = {
            prompt,
            model: painting.model,
            aspect_ratio: painting.aspectRatio,
            image_weight: painting.imageWeight,
            style_type: painting.styleType,
            num_images: painting.numImages,
            seed: painting.seed ? +painting.seed : undefined,
            negative_prompt: painting.negativePrompt || undefined,
            magic_prompt_option: painting.magicPromptOption ? 'ON' : 'OFF'
          }
          form.append('image_request', JSON.stringify(imageRequest))
          form.append('image_file', file as unknown as Blob)
          body = form
        }
      } else if (mode === 'upscale') {
        if (!painting.imageFile) {
          window.modal.error({
            content: t('paintings.image_file_required'),
            centered: true
          })
          return
        }
        const file = fileStore.get(painting.imageFile)
        if (!file) {
          window.modal.error({
            content: t('paintings.image_file_retry'),
            centered: true
          })
          return
        }

        const form = new FormData()
        const imageRequest: Record<string, any> = {
          prompt,
          resemblance: painting.resemblance,
          detail: painting.detail,
          num_images: painting.numImages,
          seed: painting.seed ? +painting.seed : undefined,
          magic_prompt_option: painting.magicPromptOption ? 'AUTO' : 'OFF'
        }
        form.append('image_request', JSON.stringify(imageRequest))
        form.append('image_file', file as unknown as Blob)
        body = form
      }

      // Generic API call for non-V3 models and upscale
      if (!painting.model?.includes('V_3') || mode === 'upscale') {
        const response = await fetch(url, { method: 'POST', headers, body, signal: abortController.signal })

        if (!response.ok) {
          const errorData = await response.json()
          logger.error('API error:', errorData)
          throw new Error(errorData.error?.message || t('paintings.generate_failed'))
        }

        const data = await response.json()
        logger.silly(`API response: ${data}`)
        if (data.output) {
          const base64s = data.output.b64_json.map((item: any) => item.bytesBase64)
          await processResult(ctx, { base64s })
          return
        }
        const urls = data.data.filter((item: any) => item.url).map((item: any) => item.url)
        const base64s = data.data.filter((item: any) => item.b64_json).map((item: any) => item.b64_json)

        if (urls.length > 0) {
          await processResult(ctx, { urls, downloadOptions: { showProxyWarning: true } })
        }

        if (base64s?.length > 0) {
          await processResult(ctx, { base64s })
        }
      }
    })
  }
}
