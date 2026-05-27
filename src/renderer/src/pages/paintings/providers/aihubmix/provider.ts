import { loggerService } from '@logger'
import { AiProvider } from '@renderer/aiCore'
import type { FileMetadata, PaintingAction } from '@renderer/types'
import type { Provider } from '@renderer/types/provider'

import type { PaintingGenerationResult } from '../types'
import type { AihubmixMode } from './config'

const logger = loggerService.withContext('AihubmixProvider')

type AihubmixFileMap = {
  [key: string]: FileMetadata
}

type GenerateAihubmixImagesOptions = {
  provider: Provider
  mode: AihubmixMode
  painting: PaintingAction
  prompt: string
  fileMap: AihubmixFileMap
  generateFailedMessage: string
  imageMixFailedMessage: string
  signal: AbortSignal
}

type AihubmixFetchConfig = {
  url: string
  headers: Record<string, string>
  body: string | FormData
}

type GeminiResponse = {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        inlineData?: {
          data?: string
        }
      }>
    }
  }>
}

type AihubmixImageResponse = {
  data?: Array<{ url?: string; b64_json?: string }>
  output?: {
    b64_json?: Array<{ bytesBase64?: string }>
  }
  error?: { message?: string }
}

function getImageFile(painting: PaintingAction, fileMap: AihubmixFileMap) {
  return painting.imageFile ? fileMap[painting.imageFile] : undefined
}

function toGeminiImageSize(painting: PaintingAction) {
  return painting.aspectRatio?.replace('ASPECT_', '').replace('_', ':') || '1:1'
}

function toIdeogramAspectRatio(painting: PaintingAction) {
  return painting.aspectRatio?.replace('ASPECT_', '').replace('_', 'x').toLowerCase()
}

function appendV3CommonFormData(formData: FormData, painting: PaintingAction, prompt: string) {
  formData.append('prompt', prompt)
  formData.append('rendering_speed', painting.renderingSpeed || 'DEFAULT')
  formData.append('num_images', String(painting.numImages || 1))

  const aspectRatioValue = toIdeogramAspectRatio(painting)
  if (aspectRatioValue) {
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
}

function parseGeminiBase64s(data: GeminiResponse | GeminiResponse[]) {
  const responseItems = Array.isArray(data) ? data : [data]
  const base64s: string[] = []

  responseItems.forEach((item) => {
    item.candidates?.forEach((candidate) => {
      candidate.content?.parts?.forEach((part) => {
        if (part.inlineData?.data) {
          base64s.push(part.inlineData.data)
        }
      })
    })
  })

  return base64s
}

function parseAihubmixImageResponse(data: AihubmixImageResponse): PaintingGenerationResult {
  if (data.output) {
    return {
      urls: [],
      base64s:
        data.output.b64_json?.map((item) => item.bytesBase64).filter((base64): base64 is string => Boolean(base64)) ??
        []
    }
  }

  const images = data.data || []

  return {
    urls: images.filter((item) => item.url).map((item) => item.url as string),
    base64s: images.filter((item) => item.b64_json).map((item) => item.b64_json as string)
  }
}

async function generateImagenImages(
  provider: Provider,
  painting: PaintingAction,
  prompt: string,
  model: string,
  signal: AbortSignal
) {
  const aiProvider = new AiProvider(provider)
  const base64s = await aiProvider.generateImage({
    prompt,
    model,
    imageSize: toGeminiImageSize(painting),
    batchSize: model.startsWith('imagen-4.0-ultra-generate') ? 1 : painting.numberOfImages || 1,
    personGeneration: painting.personGeneration,
    signal
  })

  return { urls: [], base64s }
}

async function generateGeminiImages(
  provider: Provider,
  painting: PaintingAction,
  prompt: string,
  generateFailedMessage: string,
  signal: AbortSignal
) {
  const requestBody = {
    contents: [
      {
        parts: [
          {
            text: prompt
          }
        ],
        role: 'user'
      }
    ],
    generationConfig: {
      responseModalities: ['TEXT', 'IMAGE'],
      imageConfig: {
        aspectRatio: toGeminiImageSize(painting),
        imageSize: painting.imageSize || '1k'
      }
    }
  }

  logger.silly(`Gemini Request: ${JSON.stringify(requestBody)}`)

  const response = await fetch(
    `${provider.apiHost}/gemini/v1beta/models/gemini-3-pro-image-preview:streamGenerateContent`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': provider.apiKey
      },
      body: JSON.stringify(requestBody),
      signal
    }
  )

  const data = await response.json()

  if (!response.ok) {
    logger.error('Gemini API Error:', data)
    throw new Error(data.error?.message || generateFailedMessage)
  }

  logger.silly(`Gemini API Response: ${JSON.stringify(data)}`)

  return {
    urls: [],
    base64s: parseGeminiBase64s(data as GeminiResponse | GeminiResponse[])
  }
}

async function callAihubmixV3Generate(
  provider: Provider,
  painting: PaintingAction,
  prompt: string,
  generateFailedMessage: string,
  signal: AbortSignal
) {
  const formData = new FormData()
  appendV3CommonFormData(formData, painting, prompt)

  if (!painting.styleType || painting.styleType === 'AUTO') {
    formData.set('style_type', 'AUTO')
  }

  logger.silly('FormData内容:')
  for (const pair of formData.entries()) {
    logger.silly(`${pair[0]}: ${pair[1]}`)
  }

  logger.silly(`API 端点: ${provider.apiHost}/ideogram/v1/ideogram-v3/generate`)

  const response = await fetch(`${provider.apiHost}/ideogram/v1/ideogram-v3/generate`, {
    method: 'POST',
    headers: { 'Api-Key': provider.apiKey },
    body: formData,
    signal
  })
  const data = (await response.json()) as AihubmixImageResponse

  if (!response.ok) {
    logger.error('V3 API错误:', data)
    throw new Error(data.error?.message || generateFailedMessage)
  }

  logger.silly(`V3 API响应: ${data}`)

  return {
    urls: data.data?.map((item) => item.url).filter((url): url is string => Boolean(url)) ?? [],
    base64s: []
  }
}

async function callAihubmixV3Remix(
  provider: Provider,
  painting: PaintingAction,
  prompt: string,
  fileMap: AihubmixFileMap,
  imageMixFailedMessage: string,
  signal: AbortSignal
) {
  const formData = new FormData()
  appendV3CommonFormData(formData, painting, prompt)

  if (painting.imageWeight) {
    formData.append('image_weight', String(painting.imageWeight))
  }

  formData.append('image', getImageFile(painting, fileMap) as unknown as Blob)

  const response = await fetch(`${provider.apiHost}/ideogram/v1/ideogram-v3/remix`, {
    method: 'POST',
    headers: { 'Api-Key': provider.apiKey },
    body: formData,
    signal
  })
  const data = (await response.json()) as AihubmixImageResponse

  if (!response.ok) {
    logger.error('V3 Remix API错误:', data)
    throw new Error(data.error?.message || imageMixFailedMessage)
  }

  logger.silly(`V3 Remix API响应: ${data}`)

  return {
    urls: data.data?.map((item) => item.url).filter((url): url is string => Boolean(url)) ?? [],
    base64s: []
  }
}

function buildAihubmixCommonGenerateRequest(
  provider: Provider,
  painting: PaintingAction,
  prompt: string
): AihubmixFetchConfig {
  let url = `${provider.apiHost}/ideogram/aihubmix_image_generate`
  let headers: Record<string, string> = {
    'Api-Key': provider.apiKey
  }
  let requestData: Record<string, unknown>

  if (painting.model === 'gpt-image-1' || painting.model === 'gpt-image-2') {
    requestData = {
      prompt,
      model: painting.model,
      size: painting.size === 'auto' ? undefined : painting.size,
      n: painting.n,
      quality: painting.quality,
      ...(painting.model === 'gpt-image-1' ? { moderation: painting.moderation } : {})
    }
    url = `${provider.apiHost}/v1/images/generations`
    headers = {
      Authorization: `Bearer ${provider.apiKey}`
    }
  } else if (painting.model === 'FLUX.1-Kontext-pro') {
    requestData = {
      prompt,
      model: painting.model,
      safety_tolerance: painting.safetyTolerance || 6
    }
    url = `${provider.apiHost}/v1/images/generations`
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

  headers['Content-Type'] = 'application/json'

  return {
    url,
    headers,
    body: JSON.stringify(requestData)
  }
}

function buildAihubmixRemixRequest(
  provider: Provider,
  painting: PaintingAction,
  prompt: string,
  fileMap: AihubmixFileMap
): AihubmixFetchConfig {
  const formData = new FormData()
  const imageRequest: Record<string, unknown> = {
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

  formData.append('image_request', JSON.stringify(imageRequest))
  formData.append('image_file', getImageFile(painting, fileMap) as unknown as Blob)

  return {
    url: `${provider.apiHost}/ideogram/aihubmix_image_remix`,
    headers: {
      'Api-Key': provider.apiKey
    },
    body: formData
  }
}

function buildAihubmixUpscaleRequest(
  provider: Provider,
  painting: PaintingAction,
  prompt: string,
  fileMap: AihubmixFileMap
): AihubmixFetchConfig {
  const formData = new FormData()
  const imageRequest: Record<string, unknown> = {
    prompt,
    resemblance: painting.resemblance,
    detail: painting.detail,
    num_images: painting.numImages,
    seed: painting.seed ? +painting.seed : undefined,
    magic_prompt_option: painting.magicPromptOption ? 'AUTO' : 'OFF'
  }

  formData.append('image_request', JSON.stringify(imageRequest))
  formData.append('image_file', getImageFile(painting, fileMap) as unknown as Blob)

  return {
    url: `${provider.apiHost}/ideogram/aihubmix_image_upscale`,
    headers: {
      'Api-Key': provider.apiKey
    },
    body: formData
  }
}

function buildAihubmixCommonRequest({
  provider,
  mode,
  painting,
  prompt,
  fileMap
}: Pick<GenerateAihubmixImagesOptions, 'provider' | 'mode' | 'painting' | 'prompt' | 'fileMap'>) {
  if (mode === 'aihubmix_image_remix') {
    return buildAihubmixRemixRequest(provider, painting, prompt, fileMap)
  }

  if (mode === 'aihubmix_image_upscale') {
    return buildAihubmixUpscaleRequest(provider, painting, prompt, fileMap)
  }

  return buildAihubmixCommonGenerateRequest(provider, painting, prompt)
}

async function callAihubmixCommonApi(
  requestConfig: AihubmixFetchConfig,
  generateFailedMessage: string,
  signal: AbortSignal
) {
  const response = await fetch(requestConfig.url, {
    method: 'POST',
    headers: requestConfig.headers,
    body: requestConfig.body,
    signal
  })
  const data = (await response.json()) as AihubmixImageResponse

  if (!response.ok) {
    logger.error('通用API错误:', data)
    throw new Error(data.error?.message || generateFailedMessage)
  }

  logger.silly(`通用API响应: ${data}`)

  return parseAihubmixImageResponse(data)
}

export async function generateAihubmixImages(
  options: GenerateAihubmixImagesOptions
): Promise<PaintingGenerationResult> {
  const { provider, mode, painting, prompt, fileMap, generateFailedMessage, imageMixFailedMessage, signal } = options

  if (mode === 'aihubmix_image_generate') {
    if (painting.model?.startsWith('imagen-')) {
      return generateImagenImages(provider, painting, prompt, painting.model, signal)
    }

    if (painting.model === 'gemini-3-pro-image-preview') {
      return generateGeminiImages(provider, painting, prompt, generateFailedMessage, signal)
    }

    if (painting.model === 'V_3') {
      return callAihubmixV3Generate(provider, painting, prompt, generateFailedMessage, signal)
    }
  }

  if (mode === 'aihubmix_image_remix' && painting.model === 'V_3') {
    return callAihubmixV3Remix(provider, painting, prompt, fileMap, imageMixFailedMessage, signal)
  }

  return callAihubmixCommonApi(buildAihubmixCommonRequest(options), generateFailedMessage, signal)
}
