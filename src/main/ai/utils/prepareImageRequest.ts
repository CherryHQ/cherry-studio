import {
  buildImageRequestParamsSchema,
  imageParamsSchema,
  type ParamValues,
  resolveLegacyImageCapability
} from '@cherrystudio/provider-registry'
import { loggerService } from '@logger'
import { providerRegistryService } from '@main/data/services/ProviderRegistryService'
import { imageInputSchema } from '@shared/ai/imageInput'
import { createPaintingGenerateError } from '@shared/ai/paintingGenerateError'
import type { ImageGenerationSupport, Model } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'

import type { AiImageRequest, AsInProcess } from '../AiService'
import { resolveImageExecutionTarget } from '../provider/imageExecutionTarget'
import type { AiBaseRequest } from '../types'

const logger = loggerService.withContext('prepareImageRequest')

/** Resolve capability and protocol before credentials or other execution side effects. */
export function prepareImageExecution(request: AsInProcess<AiImageRequest>, provider: Provider, model: Model) {
  const support = providerRegistryService.getImageGenerationSupport(provider.id, model.apiModelId ?? model.id)
  return bindImageRequest(request, provider, model, support)
}

function bindImageRequest(
  request: AsInProcess<AiImageRequest>,
  provider: Provider,
  model: Model,
  support: ImageGenerationSupport | null | undefined
) {
  const preparedRequest = { ...request, ...prepareImageRequest(request, support ?? undefined) }
  const target = resolveImageExecutionTarget(provider, model, request.mode ?? 'generate', support)
  if (target.kind === 'unavailable') throw new Error(target.message)
  return { request: preparedRequest, provider, model, target }
}

/** Health checks are callers too: materialize catalog defaults and required inputs before normal preparation. */
export function prepareImageProbe(request: AsInProcess<AiBaseRequest>, provider: Provider, model: Model) {
  const support = providerRegistryService.getImageGenerationSupport(provider.id, model.apiModelId ?? model.id)
  const mode =
    support == null
      ? 'generate'
      : (['generate', 'edit', 'remix', 'upscale', 'merge'] as const).find((mode) => mode in support.modes)
  if (!mode) throw createPaintingGenerateError('OPERATION_FAILED')
  const resolution = resolveLegacyImageCapability(support ?? undefined, mode)
  const paramValues: ParamValues = {}
  if (resolution.kind === 'supported') {
    for (const [key, spec] of Object.entries(resolution.capability.supports)) {
      if (typeof spec === 'object' && spec !== null && 'default' in spec && spec.default !== undefined)
        paramValues[key] = spec.default
    }
  }
  const inputCount = resolution.kind === 'supported' ? resolution.capability.inputs.images.min : 0
  return bindImageRequest(
    {
      ...request,
      prompt: 'a red circle',
      mode,
      paramValues,
      inputImages: inputCount > 0 ? Array.from({ length: inputCount }, () => PROBE_IMAGE) : undefined,
      cleanupPolicy: 'delete_when_unreferenced'
    },
    provider,
    model,
    support
  )
}

// Translation APIs require a public URL, so a probe cannot universally substitute inline bytes.
const PROBE_IMAGE = 'https://help-static-aliyun-doc.aliyuncs.com/file-manage-files/zh-CN/20250916/ordhsk/1.webp'

/** Main owns validation for both renderer and in-process tool calls. */
export function prepareImageRequest(
  request: Pick<AiImageRequest, 'mode' | 'prompt' | 'paramValues' | 'inputImages' | 'mask'>,
  support: ImageGenerationSupport | undefined
) {
  const mode = request.mode ?? 'generate'
  const resolution = resolveLegacyImageCapability(support, mode)
  if (resolution.kind === 'unsupported') {
    logger.warn('Image operation is not declared', { mode })
    throw createPaintingGenerateError('OPERATION_FAILED')
  }

  const prompt = request.prompt.trim()
  const inputImages = request.inputImages?.length ? request.inputImages : undefined
  const imageCount = inputImages?.length ?? 0
  if (request.mask !== undefined && imageCount === 0) throw createPaintingGenerateError('IMAGE_REQUIRED')

  const promptRequired = resolution.kind === 'supported' ? resolution.capability.inputs.prompt === 'required' : true
  if (promptRequired && !prompt) throw createPaintingGenerateError('PROMPT_REQUIRED')

  if (resolution.kind === 'supported') {
    const { images } = resolution.capability.inputs
    if (imageCount < images.min) throw createPaintingGenerateError('EDIT_IMAGE_REQUIRED')
    if (images.max.kind === 'known' && imageCount > images.max.value) {
      throw createPaintingGenerateError('INPUT_IMAGE_LIMIT_EXCEEDED')
    }
    if (imageCount > 0 && images.max.kind === 'unknown') {
      logger.warn('Legacy image declaration has no input count limit', { mode })
    }
  } else {
    logger.warn('Image capability is unconfigured; only the canonical input contract can be validated')
    if (mode !== 'generate' && imageCount === 0) throw createPaintingGenerateError('EDIT_IMAGE_REQUIRED')
  }

  for (const image of [...(inputImages ?? []), ...(request.mask === undefined ? [] : [request.mask])]) {
    if (!imageInputSchema.safeParse(image).success) throw createPaintingGenerateError('IMAGE_HANDLE_REQUIRED')
  }

  const schema =
    resolution.kind === 'supported' ? buildImageRequestParamsSchema(resolution.capability) : imageParamsSchema.strict()
  const params = schema.safeParse(request.paramValues)
  if (!params.success) {
    logger.warn('Invalid image parameters', { issues: params.error.issues })
    const error = createPaintingGenerateError('OPERATION_FAILED')
    error.cause = params.error
    throw error
  }

  return { prompt, paramValues: params.data, inputImages, mask: request.mask }
}
