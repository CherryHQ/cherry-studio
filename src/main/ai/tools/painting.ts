/**
 * Image generation core — runtime-agnostic.
 *
 * Single source of truth for "generate an image from a prompt" shared by the
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
import { loggerService } from '@logger'
import { isAbortError } from '@main/utils/error'
import type { GenerateImageOutput } from '@shared/ai/builtinTools'
import type { UniqueModelId } from '@shared/data/types/model'
import * as z from 'zod'

const logger = loggerService.withContext('Painting')

export const GENERATE_IMAGE_DESCRIPTION = `Generate an image from a text prompt using the user's configured painting model.

Use this when:
- The user asks you to draw, paint, illustrate, or generate an image, picture, logo, or icon.

Notes:
- Describe the desired image vividly in the prompt; the configured painting model does the rest.
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

/** generate_image input shape shared by both callers: MCP omits n, AI-SDK strict passes null. */
type GenerateImagePromptInput = {
  prompt: string
  n?: number | null
}

export async function generateImageFromPrompt(
  input: GenerateImagePromptInput,
  signal?: AbortSignal
): Promise<PaintingResult> {
  const uniqueModelId = application
    .get('PreferenceService')
    .get('feature.paintings.default_model_id') as UniqueModelId | null
  if (!uniqueModelId) {
    return { error: PAINTING_MODEL_NOT_CONFIGURED_NOTE }
  }
  try {
    const { files } = await application.get('AiService').generateImage({
      uniqueModelId,
      prompt: input.prompt,
      paramValues: {
        ...(input.n != null ? { numImages: input.n } : {})
      },
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
