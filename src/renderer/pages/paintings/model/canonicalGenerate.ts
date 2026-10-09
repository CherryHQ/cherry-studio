import {
  buildImageRequestParamsSchema,
  type ImageOperation,
  imageParamsSchema,
  resolveImageCapability
} from '@cherrystudio/provider-registry'
import { FILE_TYPE, type FileMetadata } from '@renderer/types/file'
import { createPaintingGenerateError } from '@shared/ai/paintingGenerateError'
import type { ImageGenerationSupport } from '@shared/data/types/model'
import { getFileTypeByExt } from '@shared/utils/file'

import { optionalFiniteNumber } from '../form/fieldValue'
import { imageGenerationToFields } from '../form/imageGenerationToFields'
import { generatePainting } from './generatePainting'
import type { GenerateInput } from './types/generateInput'

/** Encode raw image bytes as a data URL for Main. */
function bytesToDataUrl(bytes: Uint8Array, mime: string): string {
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
  }
  return `data:${mime};base64,${btoa(binary)}`
}

/** Validate the visible draft and send canonical parameters, operation and independent image inputs. */
export async function canonicalGenerate(
  { painting, provider, abortController }: GenerateInput,
  { support, operation = 'generate' }: { support?: ImageGenerationSupport; operation?: ImageOperation } = {}
): Promise<FileMetadata[]> {
  if (!painting.model) throw createPaintingGenerateError('MISSING_REQUIRED_FIELDS')
  const inputFiles = (painting.inputFiles ?? []).filter(
    (entry) => getFileTypeByExt(entry.ext ?? '') === FILE_TYPE.IMAGE
  )
  const hasImages = inputFiles.length > 0
  const resolution = resolveImageCapability(support, operation, hasImages)
  if (resolution.kind === 'unsupported') throw createPaintingGenerateError('OPERATION_FAILED')
  const prompt = painting.prompt.trim()
  if (resolution.kind === 'supported') {
    const { images, prompt: promptRequirement } = resolution.capability.inputs
    if (inputFiles.length < images.min) throw createPaintingGenerateError('EDIT_IMAGE_REQUIRED')
    if (images.max.kind === 'known' && inputFiles.length > images.max.value) {
      throw createPaintingGenerateError('INPUT_IMAGE_LIMIT_EXCEEDED')
    }
    if (promptRequirement === 'required' && !prompt) throw createPaintingGenerateError('PROMPT_REQUIRED')
  } else if (!prompt) {
    throw createPaintingGenerateError('PROMPT_REQUIRED')
  }

  const rawParams = painting.params ?? {}
  const source = { ...rawParams }
  for (const [key, value] of Object.entries(source)) {
    if (value === '' || value === null || value === undefined) delete source[key]
  }
  const items = imageGenerationToFields(support, { operation, hasImages })
  if (resolution.kind === 'supported') {
    for (const key of Object.keys(source)) {
      if (!(key in resolution.capability.supports)) delete source[key]
    }
    for (const item of items) {
      if (item.condition && !item.condition(rawParams)) delete source[item.key]
    }
  }
  delete source.customSize_width
  delete source.customSize_height
  if (source.size === 'custom') {
    const width = optionalFiniteNumber(rawParams.customSize_width)
    const height = optionalFiniteNumber(rawParams.customSize_height)
    if (
      width === null ||
      height === null ||
      !Number.isInteger(width) ||
      !Number.isInteger(height) ||
      width <= 0 ||
      height <= 0
    ) {
      throw createPaintingGenerateError('OPERATION_FAILED')
    }
    source.size = `${width}x${height}`
  }
  const schema =
    resolution.kind === 'supported' ? buildImageRequestParamsSchema(resolution.capability) : imageParamsSchema.strict()
  const parsed = schema.safeParse(source)
  if (!parsed.success) throw createPaintingGenerateError('OPERATION_FAILED')

  const inputImages = hasImages
    ? await Promise.all(
        inputFiles.map(async (entry) => {
          abortController.signal.throwIfAborted()
          const { data, mime } = await window.api.file.binaryImage(`${entry.id}${entry.ext ? `.${entry.ext}` : ''}`)
          return bytesToDataUrl(new Uint8Array(data), mime)
        })
      )
    : undefined
  abortController.signal.throwIfAborted()
  return generatePainting({
    provider,
    signal: abortController.signal,
    modelId: painting.model,
    prompt,
    operation,
    paramValues: parsed.data,
    inputImages
  })
}
