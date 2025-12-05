import { aihubmixProviderCreator, newApiResolverCreator, vertexAnthropicProviderCreator } from './config'
import { azureAnthropicProviderCreator } from './config/azure-anthropic'
import { isAzureOpenAIProvider, isNewApiProvider } from './detection'
import type { MinimalModel, MinimalProvider } from './types'

export interface ResolveActualProviderOptions<P extends MinimalProvider> {
  isSystemProvider?: (provider: P) => boolean
}

const defaultIsSystemProvider = <P extends MinimalProvider>(provider: P): boolean => {
  if ('isSystem' in provider) {
    return Boolean((provider as unknown as { isSystem?: boolean }).isSystem)
  }
  return false
}

export function resolveActualProvider<M extends MinimalModel, P extends MinimalProvider>(
  provider: P,
  model: M,
  options: ResolveActualProviderOptions<P> = {}
): P {
  let resolvedProvider = provider

  if (isNewApiProvider(resolvedProvider)) {
    resolvedProvider = newApiResolverCreator(model, resolvedProvider)
  }

  const isSystemProvider = options.isSystemProvider?.(resolvedProvider) ?? defaultIsSystemProvider(resolvedProvider)

  if (isSystemProvider && resolvedProvider.id === 'aihubmix') {
    resolvedProvider = aihubmixProviderCreator(model, resolvedProvider)
  }

  if (isSystemProvider && resolvedProvider.id === 'vertexai') {
    resolvedProvider = vertexAnthropicProviderCreator(model, resolvedProvider)
  }

  if (isAzureOpenAIProvider(resolvedProvider)) {
    resolvedProvider = azureAnthropicProviderCreator(model, resolvedProvider)
  }

  return resolvedProvider
}
