import { normalizeHeaders } from '@ai-sdk/provider-utils'

import type { Model } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'

import type { AiImageRequest } from '../AiService'
import { applyHttpTrace } from '../observability'
import type { AppProviderId } from '../types'
import { asSdkImageSize, resolveImageRequestSize } from '../utils/aiSdkNativeBindings'
import { splitParamValues } from '../utils/imageOptions'
import { resolveProviderAiSdkConfig } from './config'
import { buildVendorProviderOptions } from './custom/wire/buildImageRequest'
import { resolveWireRegistration } from './custom/wire/wireProfile'
import { resolveProviderOptionsKey } from './endpoint'
import type { ImageExecutionTarget } from './imageExecutionTarget'

export async function resolveSdkImageConfig(
  provider: Provider,
  model: Model,
  target: Exclude<ImageExecutionTarget, { kind: 'unavailable' }>,
  apiKeyOverride: AiImageRequest['apiKeyOverride']
) {
  const { config: resolvedConfig, credentialReceipt } = await resolveProviderAiSdkConfig(provider, model, {
    apiKeyOverride,
    resolvedEndpoint: target.endpoint,
    imageProviderId: 'binding' in target ? target.providerId : undefined,
    nativeImageTarget: target.scheduling === 'job' ? target.protocol : undefined
  })
  let config = resolvedConfig
  if ('providerId' in target) {
    if (config.providerId !== target.providerId) throw new Error('Image binding and provider settings do not match')
    if (target.providerId === 'aihubmix' && config.providerId === 'aihubmix') {
      config = { ...config, providerSettings: { ...config.providerSettings, imageBinding: target.binding } }
    }
    if (target.providerId === 'dmxapi' && config.providerId === 'dmxapi') {
      config = { ...config, providerSettings: { ...config.providerSettings, imageBinding: target.binding } }
    }
  }
  applyHttpTrace(config.providerSettings, { modelName: model.name })
  const imageFetch = config.providerSettings.fetch
  if (!imageFetch) throw new Error('Resolved image configuration requires an injected fetch')
  config.providerSettings.fetch = (input, init) => {
    if (!(init?.body instanceof FormData)) return imageFetch(input, init)
    // The resolved provider/call headers cannot supply the boundary owned by FormData serialization.
    const headers = new Headers(init.headers)
    headers.delete('content-type')
    return imageFetch(input, { ...init, headers })
  }
  // Both compatible config builders use the instance ID as `name`; image models read its first segment.
  let actualProviderId =
    config.providerId === 'openai-compatible' || config.providerId === 'github-copilot-openai-compatible'
      ? target.providerInstanceId.split('.')[0].trim()
      : target.providerInstanceId
  let optionsProviderId: AppProviderId = config.providerId
  if ('providerId' in target && target.providerId === 'dmxapi') {
    switch (target.binding.family) {
      case 'openai-native':
        optionsProviderId = 'openai'
        break
      case 'gemini-native':
        optionsProviderId = 'google'
        break
      case 'openai-compat-image':
        optionsProviderId = 'openai-compatible'
        actualProviderId = 'dmxapi'
        break
    }
  }
  return {
    sdkConfig: {
      ...config,
      modelId: target.modelId,
      imageWireRegistration: resolveWireRegistration(optionsProviderId),
      providerOptionsKey: resolveProviderOptionsKey(optionsProviderId, {
        actualProviderId
      })
    },
    credentialReceipt
  }
}

type ImageSdkConfig = Awaited<ReturnType<typeof resolveSdkImageConfig>>['sdkConfig']

/** Encode canonical parameters only at the SDK boundary. The SDK owns batch splitting. */
export function buildSdkImageOptions(
  request: Pick<AiImageRequest, 'prompt' | 'inputImages' | 'mask' | 'paramValues' | 'requestOptions'>,
  config: ImageSdkConfig,
  signal: AbortSignal | undefined
) {
  const { structured, vendorBag } = splitParamValues(request.paramValues)
  const providerOptions = buildVendorProviderOptions(
    config.providerOptionsKey,
    request.paramValues,
    config.imageWireRegistration,
    vendorBag
  )
  const size = resolveImageRequestSize(structured.size)
  return {
    model: config.modelId,
    prompt: request.inputImages
      ? { text: request.prompt, images: request.inputImages, ...(request.mask && { mask: request.mask }) }
      : request.prompt,
    n: structured.n ?? 1,
    maxRetries: request.requestOptions?.maxRetries ?? 0,
    ...(size !== undefined && { size: asSdkImageSize(size) }),
    ...(structured.seed !== undefined && { seed: structured.seed }),
    ...(structured.aspectRatio && { aspectRatio: structured.aspectRatio }),
    ...(Object.keys(providerOptions).length > 0 && { providerOptions }),
    ...(signal && { abortSignal: signal }),
    ...(request.requestOptions?.headers && { headers: normalizeHeaders(request.requestOptions.headers) })
  }
}
