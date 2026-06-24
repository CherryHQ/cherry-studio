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

  provider.imageModel = (modelId: string) =>
    isGatewayGeminiImageModel(modelId)
      ? createGatewayGeminiImageModel(provider.languageModel(modelId), modelId)
      : baseImageModel(modelId)

  return provider
}
