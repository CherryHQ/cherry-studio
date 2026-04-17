import { loggerService } from '@logger'
import { AiProvider } from '@renderer/aiCore'
import FileManager from '@renderer/services/FileManager'
import i18next from 'i18next'

import { createPaintingGenerateError } from '../../model/errors/paintingGenerateError'
import { processPaintingResult, runPainting } from '../../model/services/paintingGenerationService'
import type { GeneratePaintingData as PaintingData } from '../../model/types/paintingData'
import { checkProviderEnabled } from '../../utils'
import type { GenerateContext } from '../types'
import { getAihubmixUploadedFile } from './runtime'

const logger = loggerService.withContext('AihubmixProvider')

type AihubmixPaintingMode = 'generate' | 'remix' | 'upscale'

const MODE_TO_CONFIG: Record<AihubmixPaintingMode, string> = {
  generate: 'aihubmix_image_generate',
  remix: 'aihubmix_image_remix',
  upscale: 'aihubmix_image_upscale'
}

export async function generateWithAihubmix(ctx: GenerateContext) {
  const {
    input: { painting, provider, tab, abortController },
    writers: { patchPainting }
  } = ctx

  await checkProviderEnabled(provider)

  if (painting.files.length > 0) {
    const confirmed = await window.modal.confirm({
      content: i18next.t('paintings.regenerate.confirm'),
      centered: true
    })
    if (!confirmed) return
    await FileManager.deleteFiles(painting.files)
  }

  const prompt = painting.prompt || ''
  patchPainting({ prompt } as Partial<PaintingData>)

  if (!provider.apiKey) {
    throw createPaintingGenerateError('NO_API_KEY')
  }

  if (!painting.model || !painting.prompt) return
  const modelId = painting.model

  await runPainting(ctx, async () => {
    const mode = tab as AihubmixPaintingMode

    let body: string | FormData = ''
    let headers: Record<string, string> = {
      'Api-Key': provider.apiKey
    }
    let url = provider.apiHost + `/ideogram/` + MODE_TO_CONFIG[mode]
    if (mode === 'generate') {
      if (modelId.startsWith('imagen-')) {
        const AI = new AiProvider(provider)
        const base64s = await AI.generateImage({
          prompt,
          model: modelId,
          imageSize: painting.aspectRatio?.replace('ASPECT_', '').replace('_', ':') || '1:1',
          batchSize: modelId.startsWith('imagen-4.0-ultra-generate') ? 1 : painting.numberOfImages || 1,
          personGeneration: painting.personGeneration,
          signal: abortController.signal
        })
        if (base64s?.length > 0) {
          await processPaintingResult(ctx, { base64s })
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
          body: JSON.stringify(requestBody),
          signal: abortController.signal
        })

        if (!response.ok) {
          const errorData = await response.json()
          logger.error('Gemini API Error:', errorData)
          throw createPaintingGenerateError('REMOTE_ERROR', {
            message: errorData.error?.message || i18next.t('paintings.generate_failed')
          })
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
          await processPaintingResult(ctx, { base64s })
        }
        return
      } else if (painting.model === 'V_3') {
        const formData = new FormData()
        formData.append('prompt', prompt)

        const renderSpeed = painting.renderingSpeed || 'DEFAULT'
        formData.append('rendering_speed', renderSpeed)
        formData.append('num_images', String(painting.numImages || 1))

        if (painting.aspectRatio) {
          formData.append('aspect_ratio', painting.aspectRatio.replace('ASPECT_', '').replace('_', 'x').toLowerCase())
        }
        if (painting.styleType && painting.styleType !== 'AUTO') {
          formData.append('style_type', painting.styleType)
        } else {
          formData.append('style_type', 'AUTO')
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

        const response = await fetch(`${provider.apiHost}/ideogram/v1/ideogram-v3/generate`, {
          method: 'POST',
          headers: { 'Api-Key': provider.apiKey },
          body: formData,
          signal: abortController.signal
        })

        if (!response.ok) {
          const errorData = await response.json()
          logger.error('V3 API error:', errorData)
          throw createPaintingGenerateError('REMOTE_ERROR', {
            message: errorData.error?.message || i18next.t('paintings.generate_failed')
          })
        }

        const data = await response.json()
        const urls = data.data.map((item: any) => item.url)

        if (urls.length > 0) {
          await processPaintingResult(ctx, { urls, downloadOptions: { showProxyWarning: true } })
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
        throw createPaintingGenerateError('IMAGE_REQUIRED')
      }
      const file = getAihubmixUploadedFile(painting.imageFile)
      if (!file) {
        throw createPaintingGenerateError('IMAGE_RETRY_REQUIRED')
      }

      if (painting.model === 'V_3') {
        const formData = new FormData()
        formData.append('prompt', prompt)
        formData.append('rendering_speed', painting.renderingSpeed || 'DEFAULT')
        formData.append('num_images', String(painting.numImages || 1))

        if (painting.aspectRatio) {
          formData.append('aspect_ratio', painting.aspectRatio.replace('ASPECT_', '').replace('_', 'x').toLowerCase())
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
          body: formData,
          signal: abortController.signal
        })

        if (!response.ok) {
          const errorData = await response.json()
          logger.error('V3 Remix API error:', errorData)
          throw createPaintingGenerateError('REMOTE_ERROR', {
            message: errorData.error?.message || i18next.t('paintings.image_mix_failed')
          })
        }

        const data = await response.json()
        const urls = data.data.map((item: any) => item.url)

        if (urls.length > 0) {
          await processPaintingResult(ctx, { urls, downloadOptions: { showProxyWarning: true } })
        }
        return
      } else {
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
        throw createPaintingGenerateError('IMAGE_REQUIRED')
      }
      const file = getAihubmixUploadedFile(painting.imageFile)
      if (!file) {
        throw createPaintingGenerateError('IMAGE_RETRY_REQUIRED')
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

    if (!painting.model?.includes('V_3') || mode === 'upscale') {
      const response = await fetch(url, { method: 'POST', headers, body, signal: abortController.signal })

      if (!response.ok) {
        const errorData = await response.json()
        logger.error('API error:', errorData)
        throw createPaintingGenerateError('REMOTE_ERROR', {
          message: errorData.error?.message || i18next.t('paintings.generate_failed')
        })
      }

      const data = await response.json()
      if (data.output) {
        const base64s = data.output.b64_json.map((item: any) => item.bytesBase64)
        await processPaintingResult(ctx, { base64s })
        return
      }
      const urls = data.data.filter((item: any) => item.url).map((item: any) => item.url)
      const base64s = data.data.filter((item: any) => item.b64_json).map((item: any) => item.b64_json)

      if (urls.length > 0) {
        await processPaintingResult(ctx, { urls, downloadOptions: { showProxyWarning: true } })
      }

      if (base64s?.length > 0) {
        await processPaintingResult(ctx, { base64s })
      }
    }

    return undefined
  })
}
