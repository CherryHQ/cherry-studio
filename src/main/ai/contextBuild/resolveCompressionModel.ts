/**
 * Resolve a Cherry-side compression-model selector (`<providerId>::<modelId>`
 * UniqueModelId) into a `LanguageModelV3` via the SAME path the agent uses:
 * Provider+Model rows (DataApi) → `providerToAiSdkConfig` → `createExecutor`
 * → `executor.languageModel(modelId)`.
 *
 * Returns `null` (never throws) on any failure — the compress feature treats
 * null as "compression off" so a misconfigured model never breaks the chat.
 */
import type { LanguageModelV3 } from '@ai-sdk/provider'
import { createExecutor } from '@cherrystudio/ai-core'
import { loggerService } from '@logger'
import { providerToAiSdkConfig } from '@main/ai/provider/config'
import { modelService } from '@main/data/services/ModelService'
import { providerService } from '@main/data/services/ProviderService'
import { isUniqueModelId, parseUniqueModelId } from '@shared/data/types/model'

const logger = loggerService.withContext('resolveCompressionModel')

export async function resolveCompressionModel(modelIdRaw: string): Promise<LanguageModelV3 | null> {
  if (!modelIdRaw || !isUniqueModelId(modelIdRaw)) {
    logger.warn('compression modelId is not a valid UniqueModelId', { modelIdRaw })
    return null
  }

  const { providerId, modelId } = parseUniqueModelId(modelIdRaw)

  let provider
  let model
  try {
    provider = await providerService.getByProviderId(providerId)
    model = await modelService.getByKey(providerId, modelId)
  } catch (error) {
    logger.warn('compression provider/model lookup failed', {
      providerId,
      modelId,
      error: (error as Error).message
    })
    return null
  }

  try {
    const config = await providerToAiSdkConfig(provider, model)
    // ai-core's createExecutor type accepts only the registered union of
    // provider ids; the union match was already validated by `providerToAiSdkConfig`.
    const executor = await createExecutor(
      config.providerId as Parameters<typeof createExecutor>[0],
      config.providerSettings as Parameters<typeof createExecutor>[1]
    )
    return await executor.languageModel(model.apiModelId ?? model.id)
  } catch (error) {
    logger.warn('compression model resolution failed', {
      providerId,
      modelId,
      error: (error as Error).message
    })
    return null
  }
}
