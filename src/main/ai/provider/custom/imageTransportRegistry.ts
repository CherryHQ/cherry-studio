import type { ProviderConfig } from '../../types'
import type { VendorBag } from '../../utils/imageOptions'
import { resolveDashScopeImageProtocol } from './dashscope/dashscopeImageBinding'
import { type DmxapiCustomImageBinding, resolveDmxapiImageBinding } from './dmxapi/dmxapiImageRouting'
import type { ImageGenerationTransport, ImageTransportDescriptor } from './imageGenerationModel'
import { resolvePpioImageProtocol } from './ppio/ppioImageBinding'
import { resolveTokenhubImageProtocol } from './tokenhub/tokenhubImageBinding'

export type NativeImageTarget =
  | { providerId: 'comfyui'; modelDescriptor: ImageTransportDescriptor | undefined }
  | { providerId: 'ppio'; modelDescriptor: ImageTransportDescriptor }
  | { providerId: 'dashscope'; modelDescriptor: ImageTransportDescriptor }
  | { providerId: 'tokenhub'; modelDescriptor: ImageTransportDescriptor }
  | { providerId: 'modelscope'; modelDescriptor: ImageTransportDescriptor | undefined }
  | { providerId: 'dmxapi'; binding: DmxapiCustomImageBinding; modelDescriptor: ImageTransportDescriptor | undefined }

export type NativeImageTargetResolution =
  | { kind: 'custom'; target: NativeImageTarget }
  | { kind: 'unavailable'; message: string }
  | { kind: 'adapter' }

/** Native protocol requirements are independent of Job scheduling and credential selection. */
export function resolveNativeImageTarget(
  providerId: string,
  modelId: string,
  modelDescriptor: ImageTransportDescriptor | undefined
): NativeImageTargetResolution {
  switch (providerId) {
    case 'ppio':
    case 'dashscope':
    case 'tokenhub':
      if (!modelDescriptor) {
        return { kind: 'unavailable', message: `No image protocol configured for '${providerId}/${modelId}'` }
      }
      if (providerId === 'ppio' && !resolvePpioImageProtocol(modelDescriptor.endpoint)) {
        return { kind: 'unavailable', message: `Unsupported PPIO image endpoint: ${modelDescriptor.endpoint}` }
      }
      if (providerId === 'dashscope' && !resolveDashScopeImageProtocol(modelDescriptor.id)) {
        return { kind: 'unavailable', message: `Unsupported DashScope image model: ${modelDescriptor.id}` }
      }
      if (providerId === 'tokenhub' && !resolveTokenhubImageProtocol(modelDescriptor.endpoint)) {
        return { kind: 'unavailable', message: `Unsupported TokenHub image endpoint: ${modelDescriptor.endpoint}` }
      }
      return { kind: 'custom', target: { providerId, modelDescriptor } }
    case 'comfyui':
    case 'modelscope':
      return { kind: 'custom', target: { providerId, modelDescriptor } }
    case 'dmxapi': {
      const resolution = resolveDmxapiImageBinding(modelId)
      if (resolution.kind === 'custom')
        return { kind: 'custom', target: { providerId, binding: resolution.binding, modelDescriptor } }
    }
  }
  return { kind: 'adapter' }
}

export type BoundNativeImageTarget = {
  [P in NativeImageTarget['providerId']]: Extract<NativeImageTarget, { providerId: P }> & {
    settings: ProviderConfig<P>['providerSettings']
  }
}[NativeImageTarget['providerId']]

export function bindNativeImageTarget(target: NativeImageTarget, config: ProviderConfig): BoundNativeImageTarget {
  switch (target.providerId) {
    case 'comfyui':
      if (config.providerId === 'comfyui') return { ...target, settings: config.providerSettings }
      break
    case 'ppio':
      if (config.providerId === 'ppio') return { ...target, settings: config.providerSettings }
      break
    case 'dashscope':
      if (config.providerId === 'dashscope') return { ...target, settings: config.providerSettings }
      break
    case 'tokenhub':
      if (config.providerId === 'tokenhub') return { ...target, settings: config.providerSettings }
      break
    case 'modelscope':
      if (config.providerId === 'modelscope') return { ...target, settings: config.providerSettings }
      break
    case 'dmxapi':
      if (config.providerId === 'dmxapi') return { ...target, settings: config.providerSettings }
      break
  }
  throw new Error(`Image protocol '${target.providerId}' cannot use '${config.providerId}' settings`)
}

export async function createNativeImageTransport(
  target: BoundNativeImageTarget
): Promise<ImageGenerationTransport<VendorBag>> {
  switch (target.providerId) {
    case 'comfyui': {
      const { buildComfyuiTransport } = await import('./comfyui/comfyuiProvider')
      return buildComfyuiTransport(target.settings)
    }
    case 'ppio': {
      const { buildPpioTransport } = await import('./ppio/ppioProvider')
      return buildPpioTransport(target.settings, target.modelDescriptor)
    }
    case 'dashscope': {
      const { buildDashScopeTransport } = await import('./dashscope/dashscopeProvider')
      return buildDashScopeTransport(target.settings, target.modelDescriptor)
    }
    case 'modelscope': {
      const { buildModelscopeTransport } = await import('./modelscope/modelscopeProvider')
      return buildModelscopeTransport(target.settings)
    }
    case 'dmxapi': {
      const { buildDmxapiTransport } = await import('./dmxapi/dmxapiProvider')
      return buildDmxapiTransport(target.settings, target.binding)
    }
    case 'tokenhub': {
      const { buildTokenhubTransport } = await import('./tokenhub/tokenhubProvider')
      return buildTokenhubTransport(target.settings, target.modelDescriptor)
    }
  }
}

export type ImageTransportProviderId = NativeImageTarget['providerId']

export function hasImageTransport(
  providerId: string,
  modelId: string,
  modelDescriptor?: ImageTransportDescriptor
): providerId is ImageTransportProviderId {
  return resolveNativeImageTarget(providerId, modelId, modelDescriptor).kind === 'custom'
}

export function isImageTransportConfig(
  config: ProviderConfig,
  modelId: string,
  modelDescriptor?: ImageTransportDescriptor
): config is ProviderConfig<ImageTransportProviderId> {
  return hasImageTransport(config.providerId, modelId, modelDescriptor)
}

export async function resolveImageTransport(
  config: ProviderConfig<ImageTransportProviderId>,
  modelId: string,
  modelDescriptor?: ImageTransportDescriptor
): Promise<ImageGenerationTransport<VendorBag> | null> {
  const resolution = resolveNativeImageTarget(config.providerId, modelId, modelDescriptor)
  if (resolution.kind !== 'custom') return null
  return createNativeImageTransport(bindNativeImageTarget(resolution.target, config))
}
