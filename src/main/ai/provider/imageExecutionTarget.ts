import { resolveImageCapability } from '@cherrystudio/provider-registry'
import type { ImageGenerationSupport, ImageOperation, Model } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'

import {
  type AihubmixCustomImageBinding,
  type AihubmixSdkImageBinding,
  resolveAihubmixImageBinding
} from './custom/aihubmix/aihubmixImageBinding'
import { type DmxapiImageBinding, resolveDmxapiImageBinding } from './custom/dmxapi/dmxapiImageRouting'
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
    | { kind: 'sdk'; scheduling: 'direct'; providerId: 'dmxapi'; binding: Extract<DmxapiImageBinding, { kind: 'sdk' }> }
    | { kind: 'custom'; scheduling: 'direct'; providerId: 'silicon' | 'ollama' | 'ovms' }
    | { kind: 'sdk'; scheduling: 'direct'; delegation: 'configured-provider' }
    | { kind: 'unavailable'; message: string }
  )

/** Bind custom protocols explicitly; standard SDK delegates retain their configured endpoint. */
export function resolveImageExecutionTarget(
  provider: Provider,
  model: Model,
  operation: ImageOperation,
  support: ImageGenerationSupport | null | undefined,
  hasImages = false
): ImageExecutionTarget {
  const endpoint = resolveEffectiveEndpoint(provider, model)
  const modelId = resolveWireModelId(model, endpoint.endpointType)
  const identity = { providerInstanceId: provider.id, modelId, endpoint }
  const descriptor = imageTransportDescriptorFor(modelId, operation, support, hasImages)
  const sdkProviderId = resolveAiSdkProviderId(provider, endpoint.endpointType)
  if (sdkProviderId === 'aihubmix' || (provider.presetProviderId ?? provider.id) === 'aihubmix') {
    const capability = resolveImageCapability(support ?? undefined, operation, hasImages)
    const requiresImages = capability.kind === 'supported' && capability.capability.inputs.images.min > 0
    const resolution = resolveAihubmixImageBinding(modelId, operation, descriptor, requiresImages)
    if (resolution.kind === 'unavailable') return { ...identity, ...resolution }
    return { ...identity, ...resolution, scheduling: 'direct', providerId: 'aihubmix' }
  }
  for (const providerId of ['silicon', 'ollama', 'ovms'] as const) {
    if (sdkProviderId === providerId) return { ...identity, kind: 'custom', scheduling: 'direct', providerId }
  }
  if (sdkProviderId === 'dmxapi' || (provider.presetProviderId ?? provider.id) === 'dmxapi') {
    const binding = resolveDmxapiImageBinding(modelId)
    if (binding.kind === 'sdk') return { ...identity, kind: 'sdk', scheduling: 'direct', providerId: 'dmxapi', binding }
    return {
      ...identity,
      kind: 'custom',
      scheduling: 'job',
      protocol: {
        providerId: 'dmxapi',
        binding: binding.binding,
        modelDescriptor: descriptor
      }
    }
  }
  const resolution = resolveNativeImageTarget(provider.presetProviderId ?? provider.id, modelId, descriptor)
  switch (resolution.kind) {
    case 'custom':
      return { ...identity, kind: 'custom', scheduling: 'job', protocol: resolution.target }
    case 'unavailable':
      return { ...identity, ...resolution }
    case 'adapter':
      return { ...identity, kind: 'sdk', scheduling: 'direct', delegation: 'configured-provider' }
  }
}
