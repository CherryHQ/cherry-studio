import { APICallError, type ImageModelV3File } from '@ai-sdk/provider'
import {
  combineHeaders,
  convertBase64ToUint8Array,
  createJsonResponseHandler,
  downloadBlob,
  type FetchFunction,
  postFormDataToApi,
  postJsonToApi,
  withoutTrailingSlash
} from '@ai-sdk/provider-utils'
import type { ParamValues } from '@cherrystudio/provider-registry'
import { createPaintingGenerateError } from '@shared/ai/paintingGenerateError'
import { parseDataUrl } from '@shared/utils/dataUrl'
import * as z from 'zod'

import {
  completedImageTransportSubmission,
  type ImageGenerationSubmitInput,
  type ImageTransportInputSupport,
  type ImmediateImageGenerationTransport
} from '../imageTransport'
import { createImageTransportErrorResponseHandler } from '../imageTransportHttp'
import { fileToDataUrl } from '../transportUtils'

export type AihubmixMode = 'generate' | 'edit' | 'remix' | 'upscale'

export type AihubmixImageOptions = Pick<
  ParamValues,
  | 'aspectRatio'
  | 'numImages'
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
  mode?: AihubmixMode
}

export interface AihubmixImageTransportSettings {
  apiRoot: string
  baseURL: string
  apiKey: string
  headers: Record<string, string | undefined>
  fetch?: FetchFunction
}

type IdeogramMode = Exclude<AihubmixMode, 'edit'>

const modeEndpoint: Record<IdeogramMode, string> = {
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
    const mode = input.providerParams.mode ?? 'generate'
    return {
      files: isDoubaoSeedreamModel(input.modelId) || mode === 'edit' || mode === 'remix' || mode === 'upscale',
      mask: false
    }
  }

  async submit(input: ImageGenerationSubmitInput<AihubmixImageOptions>) {
    const mode = input.providerParams.mode ?? 'generate'
    if (mode === 'edit') {
      return this.submitRegistryEdit(input)
    }
    if (input.modelId === 'ideogram/V3' && mode !== 'upscale') {
      return this.submitIdeogramV3(input, mode)
    }
    if (mode === 'generate' && isDoubaoSeedreamModel(input.modelId)) {
      return this.submitDoubao(input)
    }
    return this.submitIdeogramV1V2(input, mode)
  }

  private async submitRegistryEdit(input: ImageGenerationSubmitInput<AihubmixImageOptions>) {
    const descriptor = input.modelDescriptor
    if (!descriptor || descriptor.mode !== 'edit') {
      throw new Error(`AiHubMix edit model '${input.modelId}' is missing its registry transport descriptor`)
    }
    const images = (input.files ?? []).map(fileToDataUrl)
    if (images.length === 0) throw createPaintingGenerateError('IMAGE_RETRY_REQUIRED')

    const bag = input.providerParams
    const body: Record<string, unknown> = {
      prompt: input.prompt ?? '',
      images,
      n: input.n
    }
    if (input.size !== undefined) body.size = input.size
    if (input.seed !== undefined) body.seed = input.seed
    if (bag.negativePrompt) body.negative_prompt = bag.negativePrompt
    if (bag.addWatermark !== undefined) body.watermark = bag.addWatermark

    const response = await this.postJson(
      `${this.settings.apiRoot}${descriptor.endpoint}`,
      { input: body },
      openAIImageResponseSchema,
      input
    )
    return completedImageTransportSubmission(parseOpenAIImageResults(response), 'AiHubMix registry edit')
  }

  private async submitIdeogramV3(
    input: ImageGenerationSubmitInput<AihubmixImageOptions>,
    mode: Exclude<IdeogramMode, 'upscale'>
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
    if (input.seed !== undefined) formData.append('seed', String(input.seed))
    if (bag.negativePrompt) formData.append('negative_prompt', bag.negativePrompt)
    if (bag.magicPromptOption !== undefined) {
      formData.append('magic_prompt', bag.magicPromptOption ? 'ON' : 'OFF')
    }
    if (mode === 'remix') {
      if (bag.imageWeight) formData.append('image_weight', String(bag.imageWeight))
      formData.append('image', await toBlob(requireImage(input), input.signal))
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

  private async submitIdeogramV1V2(input: ImageGenerationSubmitInput<AihubmixImageOptions>, mode: IdeogramMode) {
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
            seed: input.seed,
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
            magic_prompt_option: bag.magicPromptOption ? 'ON' : 'OFF'
          }
        : {
            prompt: input.prompt ?? '',
            resemblance: bag.resemblance,
            detail: bag.detail,
            num_images: input.n,
            seed: input.seed,
            magic_prompt_option: bag.magicPromptOption ? 'AUTO' : 'OFF'
          }
    const formData = new FormData()
    formData.append('image_request', JSON.stringify(imageRequest))
    formData.append('image_file', await toBlob(file, input.signal))
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

function requireImage(input: ImageGenerationSubmitInput<AihubmixImageOptions>): ImageModelV3File {
  const file = input.files?.[0]
  if (!file) throw createPaintingGenerateError('IMAGE_RETRY_REQUIRED')
  return file
}

async function toBlob(file: ImageModelV3File, signal?: AbortSignal): Promise<Blob> {
  if (file.type === 'url') return downloadBlob(file.url, { abortSignal: signal })
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
