/**
 * Image generation/editing core — runtime-agnostic.
 *
 * Single source of truth for producing an image from a prompt and optional image references, shared by the
 * AI-SDK builtin tool (`generate_image`) and the Claude Code in-process MCP
 * bridge. Both runtimes are thin wrappers over `generateImageFromPrompt`; the
 * painting model is resolved from the `feature.paintings.default_model_id` preference,
 * and generation is delegated to `AiService.generateImage`, which owns
 * provider/model resolution, vendor param mapping, the sync + async-job
 * transports, and FileEntry persistence.
 *
 * Mirrors `webLookup`: a failed generation returns `{ error }` (a model-facing
 * note) instead of throwing, so the surrounding agentic loop keeps running. A
 * cancellation (aborted signal) is the exception — it rethrows, so it
 * propagates as the cancellation it is rather than a retryable error.
 */

import { application } from '@application'
import { buildParamsSchema, type ParamValues } from '@cherrystudio/provider-registry'
import { providerRegistryService } from '@data/services/ProviderRegistryService'
import { loggerService } from '@logger'
import { isAbortError } from '@main/utils/error'
import {
  type GenerateImageOutput,
  type GenerateImageToolInput,
  resolveGenerateImageInputLimit
} from '@shared/ai/builtinTools'
import {
  type ImageGenerationMode,
  type ImageGenerationSupport,
  parseUniqueModelId,
  type UniqueModelId
} from '@shared/data/types/model'
import * as z from 'zod'

const logger = loggerService.withContext('Painting')

export const GENERATE_IMAGE_DESCRIPTION = `Generate or edit an image using the user's configured painting model.

Use this when:
- The user asks you to draw, paint, illustrate, or generate an image, picture, logo, or icon.
- The user asks you to modify a previously generated image and provides its FileEntry id.

Notes:
- Describe the desired image or edit vividly in the prompt.
- Pass image_ids only when editing or using existing images as references.
- Generation can take 10-60 seconds.
- Requires a painting model configured in Settings > Default Model. If none is set this returns a
  configuration note — tell the user instead of retrying.`

/**
 * A failed generation must be distinguishable from "ran fine, produced files":
 * success returns the file array (matching `generateImageOutputSchema`); failure
 * returns `{ error }` carrying a model-facing note.
 */
export const paintingErrorSchema = z.object({ error: z.string() })
export type PaintingError = z.infer<typeof paintingErrorSchema>
export type PaintingResult = GenerateImageOutput | PaintingError

/** Transient failure (provider/network hiccup) — a retry can succeed. */
export const PAINTING_ERROR_NOTE = 'Image generation failed (provider error); retry or inform the user.'

/**
 * Permanent failure: no painting model is configured. Retrying can never succeed until the user picks
 * one, so the note must steer away from a retry loop.
 */
export const PAINTING_MODEL_NOT_CONFIGURED_NOTE =
  'No painting model is configured. Tell the user to pick one in Settings > Default Model; do not retry — it cannot succeed until then.'

export const PAINTING_EDIT_NOT_SUPPORTED_NOTE =
  "The configured painting model can't edit images. Tell the user to choose an edit-capable painting model; do not retry with this model."

export const PAINTING_GENERATE_NOT_SUPPORTED_NOTE =
  "The configured painting model can't generate a new image without input images. Ask for image references or tell the user to choose a generation-capable painting model."

export const PAINTING_INPUT_IMAGE_ERROR_NOTE =
  'One or more image references could not be read as images. Ask the user for valid generated-image FileEntry ids.'

export interface ConfiguredPaintingModel {
  uniqueModelId: UniqueModelId
  support: ImageGenerationSupport | null
}

export function isPaintingError(output: PaintingResult): output is PaintingError {
  // Success is always the file array; the error object is the only non-array shape.
  return !Array.isArray(output)
}

/** Shared model-output projection: an error renders its note; success renders a one-line summary. */
export function paintingModelOutput(output: PaintingResult): { type: 'text'; value: string } {
  if (isPaintingError(output)) {
    return { type: 'text', value: output.error }
  }
  if (output.length === 0) {
    return { type: 'text', value: 'Image generation returned no images.' }
  }
  const list = output.map((file) => `${file.name} (${file.id})`).join(', ')
  return { type: 'text', value: `Generated ${output.length} image(s): ${list}` }
}

export function resolveConfiguredPaintingModel(): ConfiguredPaintingModel | null {
  const uniqueModelId = application
    .get('PreferenceService')
    .get('feature.paintings.default_model_id') as UniqueModelId | null
  if (!uniqueModelId) return null

  const { providerId, modelId } = parseUniqueModelId(uniqueModelId)
  return {
    uniqueModelId,
    support: providerRegistryService.getImageGenerationSupport(providerId, modelId)
  }
}

function resolveMode(input: GenerateImageToolInput): ImageGenerationMode {
  return input.image_ids && input.image_ids.length > 0 ? 'edit' : 'generate'
}

function extractParamValues(
  input: GenerateImageToolInput,
  support: ImageGenerationSupport | null,
  mode: ImageGenerationMode
): ParamValues {
  const supports = support?.modes[mode]?.supports
  if (!supports) return {}

  const candidate: Record<string, unknown> = {}
  for (const key of Object.keys(supports)) {
    const value = input[key as keyof GenerateImageToolInput]
    if (value !== undefined && value !== null && value !== '') candidate[key] = value
  }

  const parsed = buildParamsSchema(support, mode).parse(candidate)
  return Object.fromEntries(
    Object.keys(supports).flatMap((key) => (parsed[key] === undefined ? [] : [[key, parsed[key]]]))
  )
}

async function resolveInputImages(
  imageIds: readonly string[],
  support: ImageGenerationSupport | null
): Promise<string[]> {
  const ids = imageIds.slice(0, resolveGenerateImageInputLimit(support))
  return Promise.all(
    ids.map(async (id) => {
      const { content, mime } = await application.get('FileManager').read(id, { encoding: 'base64' })
      if (!mime.startsWith('image/')) throw new Error(`FileEntry ${id} is not an image`)
      return `data:${mime};base64,${content}`
    })
  )
}

export async function generateImageFromPrompt(
  input: GenerateImageToolInput,
  signal?: AbortSignal,
  configuredModel: ConfiguredPaintingModel | null = resolveConfiguredPaintingModel()
): Promise<PaintingResult> {
  if (!configuredModel) return { error: PAINTING_MODEL_NOT_CONFIGURED_NOTE }

  const { uniqueModelId, support } = configuredModel
  const mode = resolveMode(input)
  if ((mode === 'edit' && !support?.modes.edit) || (mode === 'generate' && support && !support.modes.generate)) {
    return { error: mode === 'edit' ? PAINTING_EDIT_NOT_SUPPORTED_NOTE : PAINTING_GENERATE_NOT_SUPPORTED_NOTE }
  }

  let inputImages: string[] | undefined
  if (mode === 'edit') {
    try {
      inputImages = await resolveInputImages(input.image_ids ?? [], support)
    } catch (error) {
      if (signal?.aborted || isAbortError(error)) throw error
      logger.warn('Failed to resolve generate_image input images', { error })
      return { error: PAINTING_INPUT_IMAGE_ERROR_NOTE }
    }
  }

  try {
    const { files } = await application.get('AiService').generateImage({
      uniqueModelId,
      prompt: input.prompt,
      mode,
      ...(inputImages && { inputImages }),
      paramValues: extractParamValues(input, support, mode),
      requestOptions: signal ? { signal } : undefined
    })
    return files.map((file) => ({ id: file.id, name: file.name }))
  } catch (error) {
    // A cancellation isn't a provider failure — rethrow so it propagates instead of looking like a
    // retryable error that keeps the tool loop running after the request was already aborted.
    if (signal?.aborted || isAbortError(error)) throw error
    logger.error('AiService.generateImage failed', error as Error, { uniqueModelId })
    return { error: PAINTING_ERROR_NOTE }
  }
}
