/**
 * Resolve a Cherry-side compression-model selector
 * (`<providerId>:<modelId>` UniqueModelId) into an `LanguageModelV3`
 * instance via the SAME path the agent uses:
 *
 *   1. Look up Provider + Model rows by id (DataApi).
 *   2. `providerToAiSdkConfig(provider, model)` produces ai-core config.
 *   3. `createExecutor(providerId, providerSettings)` builds an
 *      executor with the provider extension + registry already wired.
 *   4. `executor.languageModel(modelId)` resolves to the bare V3 model
 *      using the same `modelResolver` / `registry.languageModel()`
 *      path the agent's internal `streamText` calls.
 *
 * Returns `null` when resolution fails (unknown provider, missing
 * model, etc.) — caller decides whether to log + skip or surface to
 * the user. The compress feature treats `null` as "compression off"
 * so a misconfigured model never breaks the conversation.
 */

import type { LanguageModelV3 } from '@ai-sdk/provider'
import { createExecutor } from '@cherrystudio/ai-core'
import { loggerService } from '@logger'
import { providerToAiSdkConfig } from '@main/ai/provider/config'
import { modelService } from '@main/data/services/ModelService'
import { providerService } from '@main/data/services/ProviderService'
import { isUniqueModelId, parseUniqueModelId, type UniqueModelId } from '@shared/data/types/model'

const logger = loggerService.withContext('resolveCompressionModel')

export async function resolveCompressionModel(modelIdRaw: string): Promise<LanguageModelV3 | null> {
  if (!modelIdRaw || !isUniqueModelId(modelIdRaw)) {
    logger.warn('compression modelId is not a valid UniqueModelId', { modelIdRaw })
    return null
  }

  const { providerId, modelId } = parseUniqueModelId(modelIdRaw as UniqueModelId)

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
