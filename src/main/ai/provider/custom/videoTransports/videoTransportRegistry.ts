import type { VideoTransportFactory } from '../videoGenerationModel'
import { dashscopeVideoTransportFactory } from './dashscopeVideoTransport'
import { modelscopeVideoTransportFactory } from './modelscopeVideoTransport'
import { siliconVideoTransportFactory } from './siliconVideoTransport'

/**
 * Maps providerId → video transport factory.
 * The factory captures the API key and returns a ready transport.
 */
const VIDEO_TRANSPORT_REGISTRY: Record<string, VideoTransportFactory> = {
  dashscope: dashscopeVideoTransportFactory,
  modelscope: modelscopeVideoTransportFactory,
  'silicon-flow': siliconVideoTransportFactory,
  siliconflow: siliconVideoTransportFactory
}

export function resolveVideoTransport(providerId: string, apiKey: string) {
  const factory = VIDEO_TRANSPORT_REGISTRY[providerId]
  return factory ? factory(apiKey) : null
}
