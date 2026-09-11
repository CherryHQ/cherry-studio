import { prefetch } from '@data/hooks/useDataApi'
import { loggerService } from '@logger'
import type { FileMetadata } from '@renderer/types/file'
import { uuid } from '@renderer/utils/uuid'
import type { ImageGenerationSupport } from '@shared/data/types/model'

import { paintingOperation } from '../utils/paintingProviderMode'
import { canonicalGenerate } from './canonicalGenerate'
import type { GenerateInput } from './types/generateInput'
import type { PaintingData } from './types/paintingData'

const logger = loggerService.withContext('paintings/paintingPipeline')

export interface PaintingDraftDefaults {
  providerId: string
  modelId?: string
}

/**
 * Build an initial `PaintingData` row for a new painting under the given
 * provider and optional configured model. Every per-model knob lives in
 * `params: Record<string, unknown>` and gets populated by the form when the
 * user picks a model + edits controls.
 */
export function createDefaultPainting({ providerId, modelId }: PaintingDraftDefaults): PaintingData {
  return {
    id: uuid(),
    providerId,
    mode: 'generate',
    prompt: '',
    files: [],
    params: {},
    ...(modelId && { model: modelId })
  }
}

/** Resolve model capabilities before materializing inputs or submitting generation. */
export async function paintingGenerate(input: GenerateInput): Promise<FileMetadata[]> {
  const modelId = input.painting.model
  let support: ImageGenerationSupport | undefined
  if (modelId) {
    try {
      support =
        (await prefetch('/providers/:providerId/models/:modelId*/image-generation-support', {
          params: { providerId: input.provider.id, modelId }
        })) ?? undefined
    } catch (error) {
      logger.warn('Failed to prefetch image-generation support', { providerId: input.provider.id, modelId, error })
      throw error
    }
  }
  return canonicalGenerate(input, { support, operation: paintingOperation(input.painting.mode) })
}
