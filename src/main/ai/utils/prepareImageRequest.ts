import {
  buildImageRequestParamsSchema,
  imageParamsSchema,
  resolveLegacyImageCapability
} from '@cherrystudio/provider-registry'
import { loggerService } from '@logger'
import { imageInputSchema } from '@shared/ai/imageInput'
import { createPaintingGenerateError } from '@shared/ai/paintingGenerateError'
import type { ImageGenerationSupport } from '@shared/data/types/model'

import type { AiImageRequest } from '../AiService'

const logger = loggerService.withContext('prepareImageRequest')

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
