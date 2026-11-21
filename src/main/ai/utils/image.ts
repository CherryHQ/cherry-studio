import type { GoogleGenerativeAIProviderOptions } from '@ai-sdk/google'

export function buildGeminiGenerateImageParams(): Pick<GoogleGenerativeAIProviderOptions, 'responseModalities'> {
  return {
    responseModalities: ['TEXT', 'IMAGE']
  }
}
