import type { FetchFunction } from '@ai-sdk/provider-utils'
import { loggerService } from '@logger'
import type { Model } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import { isOllamaProvider } from '@shared/utils/provider'

import { resolveOllamaModelContextWindow } from './custom/ollama/modelInfo'

const logger = loggerService.withContext('RuntimeModelMetadata')

export interface RuntimeModelResolutionOptions {
  signal?: AbortSignal
  apiKey?: string
  baseUrl: string
  fetch?: FetchFunction
}

type RuntimeModelResolver = (provider: Provider, model: Model, options: RuntimeModelResolutionOptions) => Promise<Model>

const ollamaRuntimeModelResolver: RuntimeModelResolver = async (provider, model, options) => {
  if (model.contextWindow || !model.apiModelId) return model
  const contextWindow = await resolveOllamaModelContextWindow(provider, model.apiModelId, options)
  return contextWindow ? { ...model, contextWindow } : model
}

const runtimeModelResolvers: Array<{
  match: (provider: Provider) => boolean
  resolve: RuntimeModelResolver
}> = [{ match: isOllamaProvider, resolve: ollamaRuntimeModelResolver }]

/** Apply optional provider-owned metadata without coupling request orchestration to a concrete provider. */
export async function resolveRuntimeModel(
  provider: Provider,
  model: Model,
  options: RuntimeModelResolutionOptions
): Promise<Model> {
  const resolver = runtimeModelResolvers.find((candidate) => candidate.match(provider))
  if (!resolver) return model

  try {
    return await resolver.resolve(provider, model, options)
  } catch (error) {
    if (options.signal?.aborted) throw error
    logger.warn('Failed to resolve optional runtime model metadata; continuing with configured metadata', {
      providerId: provider.id,
      modelId: model.apiModelId,
      error
    })
    return model
  }
}
