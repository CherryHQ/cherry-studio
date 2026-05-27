import type { PaintingAction } from '@renderer/types'
import type { Provider } from '@renderer/types/provider'

import type { PaintingGenerationResult } from '../types'

export type NewApiImageMode = 'openai_image_generate' | 'openai_image_edit'

type NewApiImageResponse = {
  data?: Array<{ url?: string; b64_json?: string }>
  error?: { message?: string }
}

type BuildNewApiImageRequestOptions = {
  provider: Provider
  apiKey: string
  mode: NewApiImageMode
  painting: PaintingAction
  prompt: string
  editImages: File[]
}

type GenerateNewApiImagesOptions = BuildNewApiImageRequestOptions & {
  fallbackErrorMessage: string
  signal: AbortSignal
}

function getNewApiImageEndpoint(provider: Pick<Provider, 'id' | 'apiHost'>, mode: NewApiImageMode) {
  const baseApiHost = provider.apiHost.replace(/\/v1$/, '')
  const imagePath = mode === 'openai_image_edit' ? 'edits' : 'generations'
  const pathPrefix = provider.id === 'aionly' ? '/openai/v1/images' : '/v1/images'

  return `${baseApiHost}${pathPrefix}/${imagePath}`
}

function buildNewApiGenerateRequestBody(painting: PaintingAction, prompt: string) {
  return {
    prompt,
    model: painting.model,
    size: painting.size === 'auto' ? undefined : painting.size,
    background: painting.background === 'auto' ? undefined : painting.background,
    n: painting.n,
    quality: painting.quality === 'auto' ? undefined : painting.quality,
    moderation: painting.moderation === 'auto' ? undefined : painting.moderation
  }
}

function buildNewApiEditRequestBody(painting: PaintingAction, prompt: string, editImages: File[]) {
  const formData = new FormData()
  formData.append('prompt', prompt)
  formData.append('model', painting.model || '')

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

  return formData
}

function buildNewApiImageRequest({
  provider,
  apiKey,
  mode,
  painting,
  prompt,
  editImages
}: BuildNewApiImageRequestOptions) {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`
  }

  const body =
    mode === 'openai_image_edit'
      ? buildNewApiEditRequestBody(painting, prompt, editImages)
      : JSON.stringify(buildNewApiGenerateRequestBody(painting, prompt))

  if (mode !== 'openai_image_edit') {
    headers['Content-Type'] = 'application/json'
  }

  return {
    url: getNewApiImageEndpoint(provider, mode),
    headers,
    body
  }
}

function parseNewApiImageResponse(data: NewApiImageResponse): PaintingGenerationResult {
  const images = data.data || []

  return {
    urls: images.filter((item) => item.url).map((item) => item.url as string),
    base64s: images.filter((item) => item.b64_json).map((item) => item.b64_json as string)
  }
}

export async function generateNewApiImages(options: GenerateNewApiImagesOptions): Promise<PaintingGenerationResult> {
  const { url, headers, body } = buildNewApiImageRequest(options)
  const response = await fetch(url, { method: 'POST', headers, body, signal: options.signal })
  const data = (await response.json()) as NewApiImageResponse

  if (!response.ok) {
    throw new Error(data.error?.message || options.fallbackErrorMessage)
  }

  return parseNewApiImageResponse(data)
}
