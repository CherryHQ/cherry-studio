/**
 * Vercel AI Gateway (`gateway`) provider, wrapped so Gemini chat-image models
 * generate images through the language API instead of the gateway's
 * `/image-model` route (which rejects them — see gatewayImageModel.ts).
 */
import { createGateway, type GatewayProvider, type GatewayProviderSettings } from '@ai-sdk/gateway'
import { wrapImageModel } from 'ai'
import { isPlainObject } from 'es-toolkit'

import { createGatewayGeminiImageModel, isGatewayGeminiImageModel } from './gatewayImageModel'

export type { GatewayProviderSettings }

export function createGatewayWithImageModel(settings: GatewayProviderSettings = {}): GatewayProvider {
  const provider = createGateway(settings)
  const baseImageModel = provider.imageModel.bind(provider)

  const imageModel = (modelId: string) =>
    isGatewayGeminiImageModel(modelId)
      ? createGatewayGeminiImageModel(provider.languageModel(modelId), modelId)
      : wrapImageModel({
          model: baseImageModel(modelId),
          middleware: {
            specificationVersion: 'v3',
            transformParams: async ({ params }) => {
              const { providerOptions } = params
              if (
                !modelId.startsWith('openai/') ||
                !isPlainObject(providerOptions) ||
                !isPlainObject(providerOptions.gateway) ||
                ('openai' in providerOptions && !isPlainObject(providerOptions.openai))
              ) {
                return params
              }

              const gateway = { ...providerOptions.gateway }
              const migrated: typeof gateway = {}
              for (const key of ['quality', 'background', 'moderation', 'style', 'outputFormat', 'outputCompression']) {
                if (Object.hasOwn(providerOptions.gateway, key)) {
                  migrated[key] = providerOptions.gateway[key]
                  delete gateway[key]
                }
              }
              if (Object.keys(migrated).length === 0) return params

              const normalized: typeof providerOptions = {
                ...providerOptions,
                openai: { ...migrated, ...providerOptions.openai }
              }
              delete normalized.gateway
              if (Object.keys(gateway).length > 0) normalized.gateway = gateway
              return { ...params, providerOptions: normalized }
            }
          }
        })

  // `@ai-sdk/gateway` aliases `provider.image = provider.imageModel` at
  // creation, so both must be overridden or `.image()` keeps hitting the
  // original `/image-model` route and reproduces the failure.
  provider.imageModel = imageModel
  provider.image = imageModel

  return provider
}
