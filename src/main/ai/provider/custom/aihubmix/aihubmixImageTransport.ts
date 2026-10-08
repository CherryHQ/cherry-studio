import { APICallError, type ImageModelV3File } from '@ai-sdk/provider'
import {
  convertBase64ToUint8Array,
  createJsonResponseHandler,
  type FetchFunction,
  postFormDataToApi,
  postJsonToApi,
  withoutTrailingSlash
} from '@ai-sdk/provider-utils'
import type { ParamValues } from '@cherrystudio/provider-registry'
import { downloadImageAsBase64 } from '@main/utils/downloadAsBase64'
import { createPaintingGenerateError } from '@shared/ai/paintingGenerateError'
import { parseDataUrl } from '@shared/utils/dataUrl'
import * as z from 'zod'

import {
  completedImageTransportSubmission,
  type ImageGenerationSubmitInput,
  type ImageTransportInputSupport,
  type ImmediateImageGenerationTransport
} from '../imageTransport'
import { combineImageTransportHeaders, createImageTransportErrorResponseHandler } from '../imageTransportHttp'
import { fileToDataUrl } from '../transportUtils'
import type { AihubmixCustomImageBinding } from './aihubmixImageBinding'

export type AihubmixImageOptions = Pick<
  ParamValues,
  | 'styleType'
  | 'renderingSpeed'
  | 'negativePrompt'
  | 'magicPromptOption'
  | 'imageWeight'
  | 'resemblance'
  | 'detail'
  | 'safetyTolerance'
  | 'imageResolution'
  | 'addWatermark'
  | 'sequentialImageGeneration'
  | 'maxImages'
>

export interface AihubmixImageTransportSettings {
  apiRoot: string
  baseURL: string
  apiKey: string
  headers: Record<string, string | undefined>
  fetch?: FetchFunction
  binding: Exclude<AihubmixCustomImageBinding, { kind: 'flux' }>
}

type IdeogramMode = Extract<AihubmixCustomImageBinding, { kind: 'ideogram-v1-v2' }>['operation']

const modeEndpoint: Record<IdeogramMode, string> = {
  generate: 'generate',
  remix: 'remix',
  upscale: 'upscale'
}

const doubaoParamsSchema = z.object({
  size: z.enum(['1K', '2K', '4K', 'auto']).optional(),
  n: z.number().int().min(1).max(15),
  seed: z.number().int().min(-1).max(2147483647).optional(),
  watermark: z.boolean().optional(),
  sequentialImageGeneration: z.enum(['auto', 'disabled']).optional(),
  maxImages: z.number().int().min(1).max(15).optional()
})

const imageItemSchema = z
  .object({
    url: z.string().min(1).optional(),
    b64_json: z.string().min(1).optional(),
    base64_json: z.string().min(1).optional()
  })
  .passthrough()
  .transform((item, ctx) => {
    if (item.url) return item.url
    if (item.b64_json) return `data:image/png;base64,${item.b64_json}`
    if (item.base64_json) return `data:image/png;base64,${item.base64_json}`
    ctx.addIssue({ code: 'custom', message: 'Image result requires URL or base64 data' })
    return z.NEVER
  })
const openAIImageResponseSchema = z.object({ data: z.array(imageItemSchema).min(1) }).passthrough()
const ideogramImageSchema = z
  .object({
    url: z.string().min(1).nullable().optional(),
    is_image_safe: z.boolean().optional()
  })
  .passthrough()
  .transform((item, ctx) => {
    if (item.is_image_safe === false) return null
    if (item.url) return item.url
    ctx.addIssue({ code: 'custom', message: 'Unmoderated Ideogram result requires an image URL' })
    return z.NEVER
  })
const ideogramResponseSchema = z.object({ data: z.array(ideogramImageSchema).min(1) }).passthrough()

class AihubmixImageTransport implements ImmediateImageGenerationTransport<AihubmixImageOptions> {
  readonly task = { kind: 'unsupported' as const }

  constructor(private readonly settings: AihubmixImageTransportSettings) {}

  supportsInput(): ImageTransportInputSupport {
    const binding = this.settings.binding
    return {
      files:
        binding.kind === 'doubao' ||
        (binding.kind === 'qianfan' ? binding.requiresImages : binding.operation !== 'generate'),
      mask: false
    }
  }

  async submit(input: ImageGenerationSubmitInput<AihubmixImageOptions>) {
    const binding = this.settings.binding
    try {
      switch (binding.kind) {
        case 'qianfan':
          return await this.submitPrediction(input, binding)
        case 'ideogram-v3':
          return await this.submitIdeogramV3(input, binding.operation)
        case 'doubao':
          return await this.submitDoubao(input)
        case 'ideogram-v1-v2':
          return await this.submitIdeogramV1V2(input, binding.operation)
      }
    } catch (error) {
      throw asPaintingRemoteError(error)
    }
  }

  private async submitPrediction(
    input: ImageGenerationSubmitInput<AihubmixImageOptions>,
    binding: Extract<AihubmixCustomImageBinding, { kind: 'qianfan' }>
  ) {
    const images = (input.files ?? []).map(fileToDataUrl)
    if (binding.requiresImages && images.length === 0) throw createPaintingGenerateError('IMAGE_RETRY_REQUIRED')

    const bag = input.providerParams
    const body: Record<string, unknown> = {
      prompt: input.prompt ?? '',
      ...(images.length > 0 && { images }),
      n: input.n
    }
    if (input.size !== undefined) body.size = input.size
    if (input.seed !== undefined) body.seed = input.seed
    if (bag.negativePrompt) body.negative_prompt = bag.negativePrompt
    if (bag.addWatermark !== undefined) body.watermark = bag.addWatermark

    const response = await postJsonToApi({
      url: `${this.settings.apiRoot}${binding.descriptor.endpoint}`,
      headers: combineImageTransportHeaders(
        { Authorization: `Bearer ${this.settings.apiKey}` },
        this.settings.headers,
        input.headers
      ),
      body: { input: body },
      abortSignal: input.signal,
      fetch: this.settings.fetch,
      failedResponseHandler: createImageTransportErrorResponseHandler(),
      successfulResponseHandler: createJsonResponseHandler(openAIImageResponseSchema)
    })
    return completedImageTransportSubmission(response.value.data, 'AiHubMix prediction')
  }

  private async submitIdeogramV3(
    input: ImageGenerationSubmitInput<AihubmixImageOptions>,
    mode: Exclude<IdeogramMode, 'upscale'>
  ) {
    const bag = input.providerParams
    const formData = new FormData()
    formData.append('prompt', input.prompt ?? '')
    if (bag.renderingSpeed !== undefined) formData.append('rendering_speed', bag.renderingSpeed)
    formData.append('num_images', String(input.n))

    const aspectRatio = aspectRatioToIdeogramV3(input.aspectRatio)
    if (aspectRatio) formData.append('aspect_ratio', aspectRatio)
    if (bag.styleType) formData.append('style_type', bag.styleType)
    if (input.seed !== undefined) formData.append('seed', String(input.seed))
    if (bag.negativePrompt) formData.append('negative_prompt', bag.negativePrompt)
    if (bag.magicPromptOption !== undefined) {
      formData.append('magic_prompt', bag.magicPromptOption ? 'ON' : 'OFF')
    }
    if (mode === 'remix') {
      if (bag.imageWeight !== undefined) formData.append('image_weight', String(bag.imageWeight))
      formData.append('image', await toBlob(requireImage(input), input.signal, this.settings.fetch))
    }

    const url = `${this.settings.apiRoot}/ideogram/v1/ideogram-v3/${mode}`
    const response = await this.postForm(url, formData, input)
    return completedImageTransportSubmission(parseIdeogramResults(response), `AiHubMix Ideogram V3 ${mode}`)
  }

  private async submitDoubao(input: ImageGenerationSubmitInput<AihubmixImageOptions>) {
    const url = `${withoutTrailingSlash(this.settings.baseURL)}/images/generations`
    const response = await postJsonToApi({
      url,
      headers: combineImageTransportHeaders(
        { Authorization: `Bearer ${this.settings.apiKey}` },
        this.settings.headers,
        input.headers
      ),
      body: buildDoubaoBody(input),
      abortSignal: input.signal,
      fetch: this.settings.fetch,
      failedResponseHandler: createImageTransportErrorResponseHandler(),
      successfulResponseHandler: createJsonResponseHandler(openAIImageResponseSchema)
    })
    return completedImageTransportSubmission(response.value.data, 'AiHubMix Doubao')
  }

  private async submitIdeogramV1V2(input: ImageGenerationSubmitInput<AihubmixImageOptions>, mode: IdeogramMode) {
    const bag = input.providerParams
    const aspectRatio = aspectRatioToIdeogramV1V2(input.aspectRatio)
    const url = `${this.settings.apiRoot}/ideogram/${modeEndpoint[mode]}`

    if (mode === 'generate') {
      const response = await postJsonToApi({
        url,
        headers: combineImageTransportHeaders(
          { 'Api-Key': this.settings.apiKey },
          this.settings.headers,
          input.headers
        ),
        body: {
          image_request: {
            prompt: input.prompt ?? '',
            model: input.modelId,
            aspect_ratio: aspectRatio,
            num_images: input.n,
            style_type: bag.styleType,
            seed: input.seed,
            negative_prompt: bag.negativePrompt || undefined,
            ...(bag.magicPromptOption !== undefined && { magic_prompt_option: bag.magicPromptOption ? 'ON' : 'OFF' })
          }
        },
        abortSignal: input.signal,
        fetch: this.settings.fetch,
        failedResponseHandler: createImageTransportErrorResponseHandler(),
        successfulResponseHandler: createJsonResponseHandler(ideogramResponseSchema)
      })
      return completedImageTransportSubmission(parseIdeogramResults(response.value), 'AiHubMix Ideogram generate')
    }

    const file = requireImage(input)
    const imageRequest =
      mode === 'remix'
        ? {
            prompt: input.prompt ?? '',
            model: input.modelId,
            aspect_ratio: aspectRatio,
            image_weight: bag.imageWeight,
            style_type: bag.styleType,
            num_images: input.n,
            seed: input.seed,
            negative_prompt: bag.negativePrompt || undefined,
            ...(bag.magicPromptOption !== undefined && { magic_prompt_option: bag.magicPromptOption ? 'ON' : 'OFF' })
          }
        : {
            prompt: input.prompt ?? '',
            resemblance: bag.resemblance,
            detail: bag.detail,
            num_images: input.n,
            seed: input.seed,
            ...(bag.magicPromptOption !== undefined && { magic_prompt_option: bag.magicPromptOption ? 'AUTO' : 'OFF' })
          }
    const formData = new FormData()
    formData.append('image_request', JSON.stringify(imageRequest))
    formData.append('image_file', await toBlob(file, input.signal, this.settings.fetch))
    const response = await this.postForm(url, formData, input)
    return completedImageTransportSubmission(parseIdeogramResults(response), `AiHubMix Ideogram ${mode}`)
  }

  private async postForm(
    url: string,
    formData: FormData,
    input: ImageGenerationSubmitInput<AihubmixImageOptions>
  ): Promise<z.infer<typeof ideogramResponseSchema>> {
    const headers = combineImageTransportHeaders(
      { 'Api-Key': this.settings.apiKey },
      this.settings.headers,
      input.headers
    )
    delete headers['content-type']
    const response = await postFormDataToApi({
      url,
      headers,
      formData,
      abortSignal: input.signal,
      fetch: this.settings.fetch,
      failedResponseHandler: createImageTransportErrorResponseHandler(),
      successfulResponseHandler: createJsonResponseHandler(ideogramResponseSchema)
    })
    return response.value
  }
}

function buildDoubaoBody(input: ImageGenerationSubmitInput<AihubmixImageOptions>): Record<string, unknown> {
  const bag = input.providerParams
  const parsed = doubaoParamsSchema.parse({
    // `size` is the native AI SDK channel; `imageResolution` is the existing
    // AiHubMix provider-option channel used by direct ImageModel callers.
    size: input.size !== undefined ? input.size : bag.imageResolution,
    n: input.n,
    seed: input.seed,
    watermark: bag.addWatermark,
    sequentialImageGeneration: bag.sequentialImageGeneration,
    maxImages: bag.maxImages
  })
  const body: Record<string, unknown> = {
    model: input.modelId,
    prompt: input.prompt ?? '',
    response_format: 'url'
  }
  if (parsed.size && parsed.size !== 'auto') body.size = parsed.size
  if (parsed.n !== undefined && parsed.n > 1) body.n = parsed.n
  if (parsed.seed !== undefined) body.seed = parsed.seed
  if (parsed.watermark !== undefined) body.watermark = parsed.watermark
  if (parsed.sequentialImageGeneration) {
    body.sequential_image_generation = parsed.sequentialImageGeneration
    if (parsed.maxImages !== undefined) {
      body.sequential_image_generation_options = { max_images: parsed.maxImages }
    }
  }
  const images = (input.files ?? []).map(fileToDataUrl)
  if (images.length === 1) body.image = images[0]
  else if (images.length > 1) body.image = images
  return body
}

function parseIdeogramResults(data: z.infer<typeof ideogramResponseSchema>): string[] {
  return data.data.filter((image): image is string => image !== null)
}

function aspectRatioToIdeogramV3(value: string | undefined): string | undefined {
  return value?.replace(':', 'x')
}

function aspectRatioToIdeogramV1V2(value: string | undefined): string | undefined {
  return value === undefined ? undefined : `ASPECT_${value.replace(':', '_')}`
}

function requireImage(input: ImageGenerationSubmitInput<AihubmixImageOptions>): ImageModelV3File {
  const file = input.files?.[0]
  if (!file) throw createPaintingGenerateError('IMAGE_RETRY_REQUIRED')
  return file
}

async function toBlob(
  file: ImageModelV3File,
  signal: AbortSignal | undefined,
  fetch: FetchFunction | undefined
): Promise<Blob> {
  if (file.type === 'url') {
    const image = await downloadImageAsBase64(file.url, { signal, fetch })
    if (!image) throw createPaintingGenerateError('IMAGE_RETRY_REQUIRED')
    return new Blob([Buffer.from(image.data, 'base64')], { type: image.media_type })
  }
  if (file.data instanceof Uint8Array) return new Blob([Uint8Array.from(file.data)], { type: file.mediaType })
  const parsed = parseDataUrl(file.data)
  const data = parsed?.data ?? file.data
  const bytes =
    parsed && !parsed.isBase64 ? new TextEncoder().encode(decodeURIComponent(data)) : convertBase64ToUint8Array(data)
  return new Blob([bytes], { type: parsed?.mediaType ?? file.mediaType })
}

function asPaintingRemoteError(error: unknown): unknown {
  if (APICallError.isInstance(error)) {
    return createPaintingGenerateError('REMOTE_ERROR', { message: error.message })
  }
  return error
}

export function createAihubmixImageTransport(settings: AihubmixImageTransportSettings): AihubmixImageTransport {
  return new AihubmixImageTransport(settings)
}

export type { AihubmixImageTransport }
