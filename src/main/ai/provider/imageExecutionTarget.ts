import type { ImageGenerationMode, ImageGenerationSupport, Model } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'

import {
  type AihubmixCustomImageBinding,
  type AihubmixSdkImageBinding,
  resolveAihubmixImageBinding
} from './custom/aihubmix/aihubmixImageBinding'
import { imageTransportDescriptorFor } from './custom/imageTransport'
import { type NativeImageTarget, resolveNativeImageTarget } from './custom/imageTransportRegistry'
import { resolveAiSdkProviderId, type ResolvedEndpoint, resolveEffectiveEndpoint, resolveWireModelId } from './endpoint'

interface ImageExecutionIdentity {
  providerInstanceId: Provider['id']
  modelId: string
  endpoint: ResolvedEndpoint
}

export type ImageExecutionTarget = ImageExecutionIdentity &
  (
    | { kind: 'custom'; scheduling: 'job'; protocol: NativeImageTarget }
    | { kind: 'custom'; scheduling: 'direct'; providerId: 'aihubmix'; binding: AihubmixCustomImageBinding }
    | { kind: 'sdk'; scheduling: 'direct'; providerId: 'aihubmix'; binding: AihubmixSdkImageBinding }
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
  const descriptor = imageTransportDescriptorFor(modelId, mode, support)
  if (
    resolveAiSdkProviderId(provider, endpoint.endpointType) === 'aihubmix' ||
    (provider.presetProviderId ?? provider.id) === 'aihubmix'
  ) {
    const resolution = resolveAihubmixImageBinding(modelId, mode, descriptor)
    if (resolution.kind === 'unavailable') return { ...identity, ...resolution }
    return { ...identity, ...resolution, scheduling: 'direct', providerId: 'aihubmix' }
  }
  const resolution = resolveNativeImageTarget(provider.presetProviderId ?? provider.id, modelId, descriptor)
  switch (resolution.kind) {
    case 'custom':
      return { ...identity, kind: 'custom', scheduling: 'job', protocol: resolution.target }
    case 'unavailable':
      return { ...identity, ...resolution }
    case 'adapter':
      return { ...identity, kind: 'legacy-adapter', scheduling: 'direct' }
  }
}
