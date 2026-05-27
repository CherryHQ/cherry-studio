import type { FileMetadata, Painting, Provider } from '@renderer/types'
import { convertToBase64 } from '@renderer/utils'

import type { PaintingGenerationResult } from '../types'

type SiliconImageResponse = {
  data?: Array<{ url?: string; b64_json?: string }>
  images?: Array<{ url?: string; b64_json?: string }>
}

type SiliconModelRequestParams = {
  supportsImageSize: boolean
  supportsSteps: boolean
  supportsGuidanceScale: boolean
  supportsBatchSize: boolean
  defaultImageSize?: string
}

type BuildSiliconImageRequestBodyOptions = {
  painting: Painting
  prompt: string
  modelParams: SiliconModelRequestParams
  inputImages: string[]
}

type GenerateSiliconImagesOptions = BuildSiliconImageRequestBodyOptions & {
  provider: Provider
  signal: AbortSignal
}

type SiliconImageErrorResponse = SiliconImageResponse & {
  error?: { message?: string }
}

function getSiliconImageEndpoint(provider: Pick<Provider, 'apiHost'>) {
  const apiHost = provider.apiHost.replace(/\/$/, '').replace(/\/v1$/, '')
  return `${apiHost}/v1/images/generations`
}

function parseSiliconImageResult(data: SiliconImageResponse): PaintingGenerationResult {
  const images = data.data || data.images || []

  return {
    urls: images
      .map((image) => image.url || (image.b64_json ? `data:image/png;base64,${image.b64_json}` : undefined))
      .filter((url): url is string => Boolean(url)),
    base64s: []
  }
}

function buildSiliconImageRequestBody({
  painting,
  prompt,
  modelParams,
  inputImages
}: BuildSiliconImageRequestBodyOptions) {
  return {
    model: painting.model,
    prompt,
    negative_prompt: painting.negativePrompt || undefined,
    image_size: modelParams.supportsImageSize ? painting.imageSize || modelParams.defaultImageSize : undefined,
    batch_size: modelParams.supportsBatchSize ? painting.numImages || 1 : undefined,
    seed: painting.seed ? Number(painting.seed) : undefined,
    num_inference_steps: modelParams.supportsSteps ? painting.steps || 20 : undefined,
    guidance_scale: modelParams.supportsGuidanceScale ? painting.guidanceScale || 7.5 : undefined,
    image: inputImages[0],
    image2: inputImages[1],
    image3: inputImages[2]
  }
}

export async function getSiliconInputImages(
  files: FileMetadata[],
  convertFile = (file: FileMetadata) => convertToBase64(file as unknown as File)
) {
  const images = await Promise.all(files.map((file) => convertFile(file)))
  return images.filter((image): image is string => typeof image === 'string')
}

export async function generateSiliconImages({
  provider,
  painting,
  prompt,
  signal,
  inputImages,
  modelParams
}: GenerateSiliconImagesOptions): Promise<PaintingGenerationResult> {
  const response = await fetch(getSiliconImageEndpoint(provider), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${provider.apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(buildSiliconImageRequestBody({ painting, prompt, modelParams, inputImages })),
    signal
  })

  const data = (await response.json()) as SiliconImageErrorResponse

  if (!response.ok) {
    throw new Error(data.error?.message || response.statusText)
  }

  return parseSiliconImageResult(data)
}
