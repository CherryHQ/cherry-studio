/**
 * Composed AiHubMix `ImageModelV3`.
 *
 * Upgrades the in-place `createAihubmix().imageModel` from a plain
 * `OpenAICompatibleImageModel` to a model that branches by model id / mode.
 * Special branches (gemini stream, Ideogram V_3 FormData, Ideogram V_1/V_2
 * JSON) are relocated VERBATIM from the bespoke
 * `pages/paintings/providers/aihubmix/generate.ts`. The DEFAULT branch
 * (gpt-image-1/2, FLUX.1-Kontext-pro, imagen-*, and any unknown id)
 * reconstructs the exact inner `OpenAICompatibleImageModel` this provider
 * built before and delegates to it byte-identically — so chat /
 * `ApiService.fetchImageGeneration` is a strict, byte-identical superset
 * regardless of the paintings-page flag.
 *
 * Painting-specific fields and upload blobs are read from
 * `options.providerOptions.aihubmix`. That key is also exactly what the inner
 * `OpenAICompatibleImageModel` reads (`providerOptionsKey` =
 * `'aihubmix.image'.split('.')[0]` = `'aihubmix'`), so a single bag feeds both
 * the special branches and the default delegate.
 */
import { OpenAICompatibleImageModel } from '@ai-sdk/openai-compatible'
import type { ImageModelV3, ImageModelV3CallOptions } from '@ai-sdk/provider'
import type { FetchFunction } from '@ai-sdk/provider-utils'
import { withoutTrailingSlash } from '@ai-sdk/provider-utils'
import { loggerService } from '@logger'
import { createPaintingGenerateError } from '@renderer/aiCore/errors/paintingGenerateError'
import { readErrorMessage } from '@renderer/aiCore/errors/readErrorMessage'

const logger = loggerService.withContext('AihubmixImageModel')

const AIHUBMIX_IMAGE_PROVIDER = 'aihubmix.image' as const

type AihubmixMode = 'generate' | 'remix' | 'upscale'

const MODE_TO_CONFIG: Record<AihubmixMode, string> = {
  generate: 'aihubmix_image_generate',
  remix: 'aihubmix_image_remix',
  upscale: 'aihubmix_image_upscale'
}

interface AihubmixImageFile {
  mediaType: string
  data: Uint8Array
  name: string
}

/**
 * Painting-specific bag forwarded by `generateUnified` under
 * `providerOptions.aihubmix`. Field names mirror the bespoke
 * `AihubmixPaintingData` exactly.
 */
interface AihubmixImageOptions {
  mode?: AihubmixMode
  aspectRatio?: string
  imageSize?: string
  styleType?: string
  renderingSpeed?: string
  numImages?: number
  seed?: string
  negativePrompt?: string
  magicPromptOption?: boolean
  imageWeight?: number
  resemblance?: number
  detail?: number
  imageFiles?: AihubmixImageFile[]
}

export interface CreateAihubmixImageModelOptions {
  baseURL: string
  resolveApiKey: () => string
  headers: () => Record<string, string | undefined>
  fetch?: FetchFunction
}

function toBlob(file: AihubmixImageFile): Blob {
  return new Blob([file.data as unknown as BlobPart], { type: file.mediaType })
}

export function createAihubmixImageModel(modelId: string, opts: CreateAihubmixImageModelOptions): ImageModelV3 {
  const { baseURL, resolveApiKey, headers, fetch: customFetch } = opts

  // Provider `baseURL` already includes the OpenAI-compat `/v1` suffix
  // (default `https://aihubmix.com/v1`; painting passes
  // `formatApiHost(provider.apiHost)` which appends `/v1`). The bespoke
  // service used `provider.apiHost` (the host root) for the gemini / ideogram
  // special endpoints, so strip the `/v1` suffix to reproduce those URLs.
  const apiRoot = baseURL.replace(/\/v1\/?$/, '')

  const fetchImpl: FetchFunction = customFetch ?? globalThis.fetch

  const doGenerate = async (
    options: ImageModelV3CallOptions
  ): Promise<Awaited<ReturnType<ImageModelV3['doGenerate']>>> => {
    const bag = (options.providerOptions?.aihubmix ?? {}) as unknown as AihubmixImageOptions
    const mode: AihubmixMode = bag.mode ?? 'generate'
    const prompt = options.prompt ?? ''
    const abortSignal = options.abortSignal
    const currentDate = new Date()

    const wrap = (images: string[]) => ({
      images,
      warnings: [],
      response: { timestamp: currentDate, modelId, headers: {} }
    })

    // ---- Gemini streaming branch (relocated verbatim) ----
    if (modelId === 'gemini-3-pro-image-preview') {
      const geminiUrl = `${apiRoot}/gemini/v1beta/models/gemini-3-pro-image-preview:streamGenerateContent`
      const geminiHeaders = {
        'Content-Type': 'application/json',
        'x-goog-api-key': resolveApiKey()
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
            aspectRatio: bag.aspectRatio?.replace('ASPECT_', '').replace('_', ':') || '1:1',
            imageSize: bag.imageSize || '1k'
          }
        }
      }

      logger.silly(`Gemini Request: ${JSON.stringify(requestBody)}`)

      const response = await fetchImpl(geminiUrl, {
        method: 'POST',
        headers: geminiHeaders,
        body: JSON.stringify(requestBody),
        signal: abortSignal
      })

      if (!response.ok) {
        const message = await readErrorMessage(response, 'paintings.generate_failed')
        logger.error('Gemini API Error:', { message })
        throw createPaintingGenerateError('REMOTE_ERROR', { message })
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

      return wrap(base64s.map((b64) => `data:image/png;base64,${b64}`))
    }

    // ---- Ideogram V_3 FormData branch (relocated verbatim) ----
    if (modelId === 'V_3') {
      if (mode === 'generate') {
        const formData = new FormData()
        formData.append('prompt', prompt)

        const renderSpeed = bag.renderingSpeed || 'DEFAULT'
        formData.append('rendering_speed', renderSpeed)
        formData.append('num_images', String(bag.numImages || 1))

        if (bag.aspectRatio) {
          formData.append('aspect_ratio', bag.aspectRatio.replace('ASPECT_', '').replace('_', 'x').toLowerCase())
        }
        if (bag.styleType && bag.styleType !== 'AUTO') {
          formData.append('style_type', bag.styleType)
        } else {
          formData.append('style_type', 'AUTO')
        }
        if (bag.seed) {
          formData.append('seed', bag.seed)
        }
        if (bag.negativePrompt) {
          formData.append('negative_prompt', bag.negativePrompt)
        }
        if (bag.magicPromptOption !== undefined) {
          formData.append('magic_prompt', bag.magicPromptOption ? 'ON' : 'OFF')
        }

        const response = await fetchImpl(`${apiRoot}/ideogram/v1/ideogram-v3/generate`, {
          method: 'POST',
          headers: { 'Api-Key': resolveApiKey() },
          body: formData,
          signal: abortSignal
        })

        if (!response.ok) {
          const message = await readErrorMessage(response, 'paintings.generate_failed')
          logger.error('V3 API error:', { message })
          throw createPaintingGenerateError('REMOTE_ERROR', { message })
        }

        const data = await response.json()
        const items = Array.isArray(data?.data) ? data.data : []
        const urls = items.map((item: any) => item.url)

        return wrap(urls)
      }

      if (mode === 'remix') {
        const file = bag.imageFiles?.[0]
        if (!file) {
          throw createPaintingGenerateError('IMAGE_RETRY_REQUIRED')
        }
        const formData = new FormData()
        formData.append('prompt', prompt)
        formData.append('rendering_speed', bag.renderingSpeed || 'DEFAULT')
        formData.append('num_images', String(bag.numImages || 1))

        if (bag.aspectRatio) {
          formData.append('aspect_ratio', bag.aspectRatio.replace('ASPECT_', '').replace('_', 'x').toLowerCase())
        }
        if (bag.styleType) {
          formData.append('style_type', bag.styleType)
        }
        if (bag.seed) {
          formData.append('seed', bag.seed)
        }
        if (bag.negativePrompt) {
          formData.append('negative_prompt', bag.negativePrompt)
        }
        if (bag.magicPromptOption !== undefined) {
          formData.append('magic_prompt', bag.magicPromptOption ? 'ON' : 'OFF')
        }
        if (bag.imageWeight) {
          formData.append('image_weight', String(bag.imageWeight))
        }

        formData.append('image', toBlob(file), file.name)

        const response = await fetchImpl(`${apiRoot}/ideogram/v1/ideogram-v3/remix`, {
          method: 'POST',
          headers: { 'Api-Key': resolveApiKey() },
          body: formData,
          signal: abortSignal
        })

        if (!response.ok) {
          const message = await readErrorMessage(response, 'paintings.image_mix_failed')
          logger.error('V3 Remix API error:', { message })
          throw createPaintingGenerateError('REMOTE_ERROR', { message })
        }

        const data = await response.json()
        const items = Array.isArray(data?.data) ? data.data : []
        const urls = items.map((item: any) => item.url)

        return wrap(urls)
      }

      // V_3 upscale falls through to the bespoke Ideogram upscale FormData path below.
    }

    // ---- DEFAULT: reconstruct the inner OpenAICompatibleImageModel byte-identically ----
    // gpt-image-1/2, FLUX.1-Kontext-pro, imagen-* and any unknown id in
    // `generate` mode. The bespoke service POSTed gpt-image/FLUX to
    // `${apiHost}/v1/images/generations` with `{model,prompt,size,n,quality,
    // moderation,safety_tolerance}` and routed imagen-* through
    // `AiProvider.generateImage`; the inner `OpenAICompatibleImageModel` POSTs
    // the same `/images/generations` endpoint and spreads
    // `providerOptions.aihubmix` into the body — a byte-identical superset.
    if (isDefaultModel(modelId, mode)) {
      const inner = new OpenAICompatibleImageModel(modelId, {
        provider: AIHUBMIX_IMAGE_PROVIDER,
        url: ({ path }: { path: string; modelId: string }) => `${withoutTrailingSlash(baseURL)}${path}`,
        headers,
        fetch: customFetch
      })
      return inner.doGenerate(options)
    }

    // ---- Ideogram V_1/V_2 (non-default) + V_3 upscale branch (relocated verbatim) ----
    let body: string | FormData = ''
    const reqHeaders: Record<string, string> = { 'Api-Key': resolveApiKey() }
    const url = `${apiRoot}/ideogram/${MODE_TO_CONFIG[mode]}`

    if (mode === 'generate') {
      const requestData = {
        image_request: {
          prompt,
          model: modelId,
          aspect_ratio: bag.aspectRatio,
          num_images: bag.numImages,
          style_type: bag.styleType,
          seed: bag.seed ? +bag.seed : undefined,
          negative_prompt: bag.negativePrompt || undefined,
          magic_prompt_option: bag.magicPromptOption ? 'ON' : 'OFF'
        }
      }
      body = JSON.stringify(requestData)
      reqHeaders['Content-Type'] = 'application/json'
    } else if (mode === 'remix') {
      const file = bag.imageFiles?.[0]
      if (!file) {
        throw createPaintingGenerateError('IMAGE_RETRY_REQUIRED')
      }
      const form = new FormData()
      const imageRequest: Record<string, any> = {
        prompt,
        model: modelId,
        aspect_ratio: bag.aspectRatio,
        image_weight: bag.imageWeight,
        style_type: bag.styleType,
        num_images: bag.numImages,
        seed: bag.seed ? +bag.seed : undefined,
        negative_prompt: bag.negativePrompt || undefined,
        magic_prompt_option: bag.magicPromptOption ? 'ON' : 'OFF'
      }
      form.append('image_request', JSON.stringify(imageRequest))
      form.append('image_file', toBlob(file), file.name)
      body = form
    } else {
      // upscale
      const file = bag.imageFiles?.[0]
      if (!file) {
        throw createPaintingGenerateError('IMAGE_RETRY_REQUIRED')
      }
      const form = new FormData()
      const imageRequest: Record<string, any> = {
        prompt,
        resemblance: bag.resemblance,
        detail: bag.detail,
        num_images: bag.numImages,
        seed: bag.seed ? +bag.seed : undefined,
        magic_prompt_option: bag.magicPromptOption ? 'AUTO' : 'OFF'
      }
      form.append('image_request', JSON.stringify(imageRequest))
      form.append('image_file', toBlob(file), file.name)
      body = form
    }

    const response = await fetchImpl(url, { method: 'POST', headers: reqHeaders, body, signal: abortSignal })

    if (!response.ok) {
      const message = await readErrorMessage(response, 'paintings.generate_failed')
      logger.error('API error:', { message })
      throw createPaintingGenerateError('REMOTE_ERROR', { message })
    }

    const data = await response.json()
    if (data.output) {
      const base64s = data.output.b64_json.map((item: any) => item.bytesBase64)
      return wrap(base64s.map((b64: string) => `data:image/png;base64,${b64}`))
    }
    const items = Array.isArray(data?.data) ? data.data : []
    const urls = items.filter((item: any) => item.url).map((item: any) => item.url)
    const base64s = items.filter((item: any) => item.b64_json).map((item: any) => item.b64_json)

    if (urls.length > 0) {
      return wrap(urls)
    }
    if (base64s.length > 0) {
      return wrap(base64s.map((b64: string) => `data:image/png;base64,${b64}`))
    }
    return wrap([])
  }

  return {
    specificationVersion: 'v3',
    provider: AIHUBMIX_IMAGE_PROVIDER,
    modelId,
    maxImagesPerCall: 10,
    doGenerate
  }
}

// Ideogram V_1/V_2 model ids: the only non-default models that take the
// bespoke `${apiRoot}/ideogram/...` JSON/FormData path in `generate` mode.
// (V_3 and gemini-3-pro-image-preview are handled by their own branches
// above.)
const IDEOGRAM_V1_V2_MODELS = new Set(['V_1', 'V_2'])

/**
 * Default models flow through the inner `OpenAICompatibleImageModel`:
 * gpt-image-1/2, FLUX.1-Kontext-pro, imagen-* and any other / unknown id in
 * `generate` mode. Only the Ideogram V_1/V_2 ids take the bespoke Ideogram
 * JSON path; remix/upscale never default (they always take the bespoke
 * Ideogram FormData path). This keeps chat / `ApiService.fetchImageGeneration`
 * (which sends arbitrary model ids in generate mode) byte-identical to the
 * pre-Phase-4a `OpenAICompatibleImageModel`.
 */
function isDefaultModel(modelId: string, mode: AihubmixMode): boolean {
  if (mode !== 'generate') {
    return false
  }
  return !IDEOGRAM_V1_V2_MODELS.has(modelId)
}
