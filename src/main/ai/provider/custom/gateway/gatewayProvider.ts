/**
 * Vercel AI Gateway (`gateway`) provider, wrapped so Gemini chat-image models
 * generate images through the language API instead of the gateway's
 * `/image-model` route (which rejects them — see gatewayImageModel.ts).
 */
import { createGateway, type GatewayProvider, type GatewayProviderSettings } from '@ai-sdk/gateway'

import { createGatewayGeminiImageModel, isGatewayGeminiImageModel } from './gatewayImageModel'

export type { GatewayProviderSettings }

export function createGatewayWithImageModel(settings: GatewayProviderSettings = {}): GatewayProvider {
  const provider = createGateway(settings)
  const baseImageModel = provider.imageModel.bind(provider)

  const imageModel = (modelId: string) =>
    isGatewayGeminiImageModel(modelId)
      ? createGatewayGeminiImageModel(provider.languageModel(modelId), modelId)
      : baseImageModel(modelId)

  // `@ai-sdk/gateway` aliases `provider.image = provider.imageModel` at
  // creation, so both must be overridden or `.image()` keeps hitting the
  // original `/image-model` route and reproduces the failure.
  provider.imageModel = imageModel
  provider.image = imageModel

  return provider
}
