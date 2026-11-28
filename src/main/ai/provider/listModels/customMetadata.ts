import { loggerService } from '@logger'
import { MODEL_CAPABILITY, type ModelCapability } from '@shared/data/types/model'

const logger = loggerService.withContext('CustomModelMetadata')
const knownCapabilities = new Set<string>(Object.values(MODEL_CAPABILITY))

/** Explicit provider declarations only. Model names are never capability evidence. */
export function readProviderCapabilities(
  model: { id: string } & Record<string, unknown>,
  providerId: string
): ModelCapability[] | undefined {
  const value = model.capabilities
  if (value === undefined || value === null) return undefined
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string' || !knownCapabilities.has(entry))) {
    logger.warn('Ignoring malformed model capabilities from provider', { providerId, modelId: model.id })
    return undefined
  }
  return [...new Set(value)] as ModelCapability[]
}
