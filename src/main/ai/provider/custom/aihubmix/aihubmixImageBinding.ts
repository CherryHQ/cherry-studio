import type { ImageOperation } from '@shared/data/types/model'

import type { ImageTransportDescriptor } from '../imageTransport'

export type AihubmixSdkImageBinding = { kind: 'openai' } | { kind: 'google-imagen' } | { kind: 'google-gemini' }

export type AihubmixCustomImageBinding =
  | { kind: 'flux' }
  | { kind: 'qianfan'; descriptor: ImageTransportDescriptor; requiresImages: boolean }
  | { kind: 'doubao' }
  | { kind: 'ideogram-v3'; operation: 'generate' | 'remix' }
  | { kind: 'ideogram-v1-v2'; operation: 'generate' | 'remix' | 'upscale' }

export type AihubmixImageBinding = AihubmixSdkImageBinding | AihubmixCustomImageBinding

type Resolution =
  | { kind: 'sdk'; binding: AihubmixSdkImageBinding }
  | { kind: 'custom'; binding: AihubmixCustomImageBinding }
  | { kind: 'unavailable'; message: string }

/** Bind the protocol before constructing a model; an operation alone never chooses a vendor family. */
export function resolveAihubmixImageBinding(
  modelId: string,
  operation: ImageOperation,
  descriptor: ImageTransportDescriptor | undefined,
  requiresImages = false
): Resolution {
  const unavailable = (reason: string): Resolution => ({
    kind: 'unavailable',
    message: `AiHubMix image model '${modelId}': ${reason}`
  })
  const ordinary = operation === 'generate'
  if (modelId === 'ideogram/V3') {
    if (operation === 'generate' || operation === 'remix') {
      return { kind: 'custom', binding: { kind: 'ideogram-v3', operation } }
    }
    if (operation === 'upscale') return { kind: 'custom', binding: { kind: 'ideogram-v1-v2', operation } }
    return unavailable(`unsupported operation '${operation}'`)
  }
  if (/^(?:V_1(?:_TURBO)?|V_2A?(?:_TURBO)?)$/.test(modelId)) {
    if (operation === 'generate' || operation === 'remix' || operation === 'upscale') {
      return { kind: 'custom', binding: { kind: 'ideogram-v1-v2', operation } }
    }
    return unavailable(`unsupported operation '${operation}'`)
  }
  if (!ordinary) return unavailable(`unsupported operation '${operation}'`)
  if (modelId === 'flux-2-flex' || modelId === 'flux-2-pro' || modelId === 'flux-kontext-max') {
    return { kind: 'custom', binding: { kind: 'flux' } }
  }
  if (modelId.startsWith('doubao-seedream')) return { kind: 'custom', binding: { kind: 'doubao' } }
  if (modelId.startsWith('imagen-')) return { kind: 'sdk', binding: { kind: 'google-imagen' } }
  if (modelId.startsWith('gemini-') && modelId.includes('image')) {
    return { kind: 'sdk', binding: { kind: 'google-gemini' } }
  }
  if (descriptor?.endpoint.startsWith('/v1/models/qianfan/')) {
    return { kind: 'custom', binding: { kind: 'qianfan', descriptor, requiresImages } }
  }
  if (modelId.startsWith('qwen-image') || modelId.startsWith('irag-') || modelId.startsWith('ernie-irag')) {
    return unavailable('missing Qianfan prediction descriptor')
  }
  return { kind: 'sdk', binding: { kind: 'openai' } }
}
