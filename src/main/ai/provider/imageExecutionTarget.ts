import type { ImageGenerationMode, ImageGenerationSupport, Model } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'

import { imageTransportDescriptorFor } from './custom/imageTransport'
import { type NativeImageTarget, resolveNativeImageTarget } from './custom/imageTransportRegistry'
import { type ResolvedEndpoint, resolveEffectiveEndpoint, resolveWireModelId } from './endpoint'

interface ImageExecutionIdentity {
  providerInstanceId: Provider['id']
  modelId: string
  endpoint: ResolvedEndpoint
}

export type ImageExecutionTarget = ImageExecutionIdentity &
  (
    | { kind: 'custom'; scheduling: 'job'; protocol: NativeImageTarget }
    | { kind: 'legacy-adapter'; scheduling: 'direct' }
    | { kind: 'unavailable'; message: string }
  )

/** The remaining model adapters are explicit migration entries until their protocol bindings land. */
export function resolveImageExecutionTarget(
  provider: Provider,
  model: Model,
  mode: ImageGenerationMode,
  support: ImageGenerationSupport | null | undefined
): ImageExecutionTarget {
  const endpoint = resolveEffectiveEndpoint(provider, model)
  const modelId = resolveWireModelId(model, endpoint.endpointType)
  const identity = { providerInstanceId: provider.id, modelId, endpoint }
  const resolution = resolveNativeImageTarget(
    provider.presetProviderId ?? provider.id,
    modelId,
    imageTransportDescriptorFor(modelId, mode, support)
  )
  switch (resolution.kind) {
    case 'custom':
      return { ...identity, kind: 'custom', scheduling: 'job', protocol: resolution.target }
    case 'unavailable':
      return { ...identity, ...resolution }
    case 'adapter':
      return { ...identity, kind: 'legacy-adapter', scheduling: 'direct' }
  }
}
