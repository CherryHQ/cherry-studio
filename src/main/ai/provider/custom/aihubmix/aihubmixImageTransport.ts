import { APICallError } from '@ai-sdk/provider'
import {
  combineHeaders,
  createJsonResponseHandler,
  type FetchFunction,
  postFormDataToApi,
  postJsonToApi,
  withoutTrailingSlash
} from '@ai-sdk/provider-utils'
import type { ParamValues } from '@cherrystudio/provider-registry'
import { createPaintingGenerateError } from '@shared/ai/paintingGenerateError'
import * as z from 'zod'

import {
  completedImageTransportSubmission,
  type ImageGenerationSubmitInput,
  type ImageTransportInputSupport,
  type ImmediateImageGenerationTransport
} from '../imageTransport'
import { createImageTransportErrorResponseHandler } from '../imageTransportHttp'
import { fileToDataUrl } from '../transportUtils'

export type AihubmixMode = 'generate' | 'remix' | 'upscale'

interface AihubmixImageFile {
  mediaType: string
  data: Uint8Array
  name: string
}

export type AihubmixImageOptions = Pick<
  ParamValues,
  | 'aspectRatio'
  | 'numImages'
  | 'seed'
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
> & {
  /** v1 residue retained until mode delivery is migrated separately. */
  mode?: AihubmixMode
  /** v1 residue retained until reference-file delivery is migrated separately. */
  imageFiles?: AihubmixImageFile[]
}

export interface AihubmixImageTransportSettings {
  apiRoot: string
  baseURL: string
  apiKey: string
  headers: Record<string, string | undefined>
  fetch?: FetchFunction
}

const modeEndpoint: Record<AihubmixMode, string> = {
  generate: 'generate',
  remix: 'remix',
  upscale: 'upscale'
}

const doubaoParamsSchema = z.object({
  size: z.enum(['1K', '2K', '4K', 'auto']).optional().catch(undefined),
  n: z.coerce.number().int().min(1).max(15).optional().catch(undefined),
  seed: z.coerce.number().int().min(-1).max(2147483647).optional().catch(undefined),
  watermark: z.coerce.boolean().optional().catch(undefined),
  sequentialImageGeneration: z.enum(['auto', 'disabled']).optional().catch(undefined),
  maxImages: z.coerce.number().int().min(1).max(15).optional().catch(undefined)
})

const imageItemSchema = z
  .object({
    url: z.string().min(1).optional(),
    b64_json: z.string().min(1).optional(),
    base64_json: z.string().min(1).optional()
  })
  .passthrough()
const openAIImageResponseSchema = z.object({ data: z.array(imageItemSchema) }).passthrough()
const ideogramResponseSchema = z
  .object({
    output: z
      .object({
        b64_json: z.array(z.object({ bytesBase64: z.string().min(1) }).passthrough()).min(1)
      })
      .passthrough()
      .optional(),
    data: z.array(imageItemSchema).optional()
  })
  .passthrough()

class AihubmixImageTransport implements ImmediateImageGenerationTransport<AihubmixImageOptions> {
  readonly task = { kind: 'unsupported' as const }

  constructor(private readonly settings: AihubmixImageTransportSettings) {}

  supportsInput(input: ImageGenerationSubmitInput<AihubmixImageOptions>): ImageTransportInputSupport {
    return {
      files: isDoubaoSeedreamModel(input.modelId),
      mask: false
    }
  }

  async submit(input: ImageGenerationSubmitInput<AihubmixImageOptions>) {
    const mode = input.providerParams.mode ?? 'generate'
    if (input.modelId === 'V_3' && mode !== 'upscale') {
      return this.submitIdeogramV3(input, mode)
    }
    if (mode === 'generate' && isDoubaoSeedreamModel(input.modelId)) {
      return this.submitDoubao(input)
    }
    return this.submitIdeogramV1V2(input, mode)
  }

  private async submitIdeogramV3(
    input: ImageGenerationSubmitInput<AihubmixImageOptions>,
    mode: Exclude<AihubmixMode, 'upscale'>
  ) {
    const bag = input.providerParams
    const formData = new FormData()
    formData.append('prompt', input.prompt ?? '')
    formData.append('rendering_speed', bag.renderingSpeed || 'DEFAULT')
    formData.append('num_images', String(input.n))

    const aspectRatio = aspectRatioToIdeogramV3(input.aspectRatio)
    if (aspectRatio) formData.append('aspect_ratio', aspectRatio)
    if (bag.styleType) formData.append('style_type', bag.styleType)
    else formData.append('style_type', 'AUTO')
    if (bag.seed) formData.append('seed', String(bag.seed))
    if (bag.negativePrompt) formData.append('negative_prompt', bag.negativePrompt)
    if (bag.magicPromptOption !== undefined) {
      formData.append('magic_prompt', bag.magicPromptOption ? 'ON' : 'OFF')
    }
    if (mode === 'remix') {
      if (bag.imageWeight) formData.append('image_weight', String(bag.imageWeight))
      const file = requireLegacyImageFile(bag)
      formData.append('image', toBlob(file), file.name)
    }

    const url = `${this.settings.apiRoot}/ideogram/v1/ideogram-v3/${mode}`
    const response = await this.postForm(url, formData, input)
    return completedImageTransportSubmission(parseIdeogramResults(response), `AiHubMix Ideogram V3 ${mode}`)
  }

  private async submitDoubao(input: ImageGenerationSubmitInput<AihubmixImageOptions>) {
    const url = `${withoutTrailingSlash(this.settings.baseURL)}/images/generations`
    const response = await this.postJson(url, buildDoubaoBody(input), openAIImageResponseSchema, input)
    return completedImageTransportSubmission(parseOpenAIImageResults(response), 'AiHubMix Doubao')
  }

  private async submitIdeogramV1V2(input: ImageGenerationSubmitInput<AihubmixImageOptions>, mode: AihubmixMode) {
    const bag = input.providerParams
    const aspectRatio = aspectRatioToIdeogramV1V2(input.aspectRatio)
    const url = `${this.settings.apiRoot}/ideogram/${modeEndpoint[mode]}`

    if (mode === 'generate') {
      const response = await this.postJson(
        url,
        {
          image_request: {
            prompt: input.prompt ?? '',
            model: input.modelId,
            aspect_ratio: aspectRatio,
            num_images: input.n,
            style_type: bag.styleType,
            seed: bag.seed ? +bag.seed : undefined,
            negative_prompt: bag.negativePrompt || undefined,
            magic_prompt_option: bag.magicPromptOption ? 'ON' : 'OFF'
          }
        },
        ideogramResponseSchema,
        input,
        { 'Api-Key': this.settings.apiKey }
      )
      return completedImageTransportSubmission(parseIdeogramResults(response), 'AiHubMix Ideogram generate')
    }

    const file = requireLegacyImageFile(bag)
    const imageRequest =
      mode === 'remix'
        ? {
            prompt: input.prompt ?? '',
            model: input.modelId,
            aspect_ratio: aspectRatio,
            image_weight: bag.imageWeight,
            style_type: bag.styleType,
            num_images: input.n,
            seed: bag.seed ? +bag.seed : undefined,
            negative_prompt: bag.negativePrompt || undefined,
            magic_prompt_option: bag.magicPromptOption ? 'ON' : 'OFF'
          }
        : {
            prompt: input.prompt ?? '',
            resemblance: bag.resemblance,
            detail: bag.detail,
            num_images: input.n,
            seed: bag.seed ? +bag.seed : undefined,
            magic_prompt_option: bag.magicPromptOption ? 'AUTO' : 'OFF'
          }
    const formData = new FormData()
    formData.append('image_request', JSON.stringify(imageRequest))
    formData.append('image_file', toBlob(file), file.name)
    const response = await this.postForm(url, formData, input)
    return completedImageTransportSubmission(parseIdeogramResults(response), `AiHubMix Ideogram ${mode}`)
  }

  private async postJson<T>(
    url: string,
    body: Record<string, unknown>,
    schema: z.ZodType<T>,
    input: ImageGenerationSubmitInput<AihubmixImageOptions>,
    authHeaders: Record<string, string | undefined> = {}
  ): Promise<T> {
    try {
      const response = await postJsonToApi({
        url,
        headers: combineHeaders(authHeaders, this.settings.headers, input.headers),
        body,
        abortSignal: input.signal,
        fetch: this.settings.fetch,
        failedResponseHandler: createImageTransportErrorResponseHandler(),
        successfulResponseHandler: createJsonResponseHandler(schema)
      })
      return response.value
    } catch (error) {
      throw asPaintingRemoteError(error)
    }
  }

  private async postForm(
    url: string,
    formData: FormData,
    input: ImageGenerationSubmitInput<AihubmixImageOptions>
  ): Promise<z.infer<typeof ideogramResponseSchema>> {
    try {
      const response = await postFormDataToApi({
        url,
        headers: combineHeaders({ 'Api-Key': this.settings.apiKey }, this.settings.headers, input.headers),
        formData,
        abortSignal: input.signal,
        fetch: this.settings.fetch,
        failedResponseHandler: createImageTransportErrorResponseHandler(),
        successfulResponseHandler: createJsonResponseHandler(ideogramResponseSchema)
      })
      return response.value
    } catch (error) {
      throw asPaintingRemoteError(error)
    }
  }
}

function buildDoubaoBody(input: ImageGenerationSubmitInput<AihubmixImageOptions>): Record<string, unknown> {
  const bag = input.providerParams
  const parsed = doubaoParamsSchema.parse({
    // `size` is the native AI SDK channel; `imageResolution` is the existing
    // AiHubMix provider-option channel used by direct ImageModel callers.
    size: input.size !== undefined ? input.size : bag.imageResolution,
    n: input.n,
    seed: typeof input.seed === 'number' ? input.seed : bag.seed,
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

function parseOpenAIImageResults(data: z.infer<typeof openAIImageResponseSchema>): string[] {
  return data.data.map(imageItemToResult).filter((item): item is string => item !== undefined)
}

function parseIdeogramResults(data: z.infer<typeof ideogramResponseSchema>): string[] {
  if (data.output) {
    return data.output.b64_json.map((item) => `data:image/png;base64,${item.bytesBase64}`)
  }
  return (data.data ?? []).map(imageItemToResult).filter((item): item is string => item !== undefined)
}

function imageItemToResult(item: z.infer<typeof imageItemSchema>): string | undefined {
  if (item.url) return item.url
  if (item.b64_json) return `data:image/png;base64,${item.b64_json}`
  if (item.base64_json) return `data:image/png;base64,${item.base64_json}`
  return undefined
}

function aspectRatioToIdeogramV3(value: string | undefined): string | undefined {
  return value
    ?.replace(/^ASPECT_/i, '')
    .replace(/[_:]/g, 'x')
    .toLowerCase()
}

function aspectRatioToIdeogramV1V2(value: string | undefined): string | undefined {
  if (!value) return undefined
  if (/^ASPECT_/i.test(value)) return value
  if (/^\d+:\d+$/.test(value)) return `ASPECT_${value.replace(':', '_')}`
  return value
}

function isDoubaoSeedreamModel(modelId: string): boolean {
  return modelId.startsWith('doubao-seedream')
}

function requireLegacyImageFile(bag: AihubmixImageOptions): AihubmixImageFile {
  const file = bag.imageFiles?.[0]
  if (!file) throw createPaintingGenerateError('IMAGE_RETRY_REQUIRED')
  return file
}

function toBlob(file: AihubmixImageFile): Blob {
  return new Blob([file.data as unknown as BlobPart], { type: file.mediaType })
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
