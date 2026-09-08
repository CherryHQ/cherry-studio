import { normalizeHeaders } from '@ai-sdk/provider-utils'
import type { Model } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'

import type { AiImageRequest } from '../AiService'
import { asSdkImageSize, resolveImageRequestSize } from '../utils/aiSdkNativeBindings'
import { splitParamValues } from '../utils/imageOptions'
import { applyHttpTrace } from './applyHttpTrace'
import { resolveProviderAiSdkConfig } from './config'
import { buildVendorProviderOptions } from './custom/wire/buildImageRequest'
import { resolveWireRegistration } from './custom/wire/wireProfile'
import { resolveProviderOptionsKey } from './endpoint'
import type { ImageExecutionTarget } from './imageExecutionTarget'

export async function resolveSdkImageConfig(
  provider: Provider,
  model: Model,
  target: Extract<ImageExecutionTarget, { scheduling: 'direct' }>,
  apiKeyOverride: AiImageRequest['apiKeyOverride']
) {
  const { config: resolvedConfig, credentialReceipt } = await resolveProviderAiSdkConfig(provider, model, {
    apiKeyOverride,
    resolvedEndpoint: target.endpoint
  })
  let config = resolvedConfig
  if (target.kind !== 'legacy-adapter') {
    if (config.providerId !== target.providerId) throw new Error('Image binding and provider settings do not match')
    config = { ...config, providerSettings: { ...config.providerSettings, imageBinding: target.binding } }
  }
  applyHttpTrace(config, undefined, model)
  // Both compatible config builders use the instance ID as `name`; image models read its first segment.
  const actualProviderId =
    config.providerId === 'openai-compatible' || config.providerId === 'github-copilot-openai-compatible'
      ? target.providerInstanceId.split('.')[0].trim()
      : target.providerInstanceId
  return {
    sdkConfig: {
      ...config,
      modelId: target.modelId,
      providerOptionsKey: resolveProviderOptionsKey(config.providerId, {
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
    resolveWireRegistration(config.providerId),
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
