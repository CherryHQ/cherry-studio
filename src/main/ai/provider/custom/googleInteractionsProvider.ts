import { createGoogleGenerativeAI, type GoogleGenerativeAIProviderSettings } from '@ai-sdk/google'
import { wrapLanguageModel } from 'ai'

export function createGoogleInteractionsProvider(settings: GoogleGenerativeAIProviderSettings = {}) {
  const google = createGoogleGenerativeAI(settings)
  return {
    ...google,
    languageModel: (modelId: string) =>
      wrapLanguageModel({
        model: google.interactions(modelId),
        middleware: {
          specificationVersion: 'v3',
          transformParams: async ({ params }) => ({
            ...params,
            providerOptions: {
              ...params.providerOptions,
              google: {
                ...params.providerOptions?.google,
                // Cherry's edited, branched and windowed history is authoritative.
                previousInteractionId: undefined,
                store: false,
                background: false
              }
            }
          })
        }
      })
  }
}
