/**
 * PDF Compatibility Plugin
 *
 * Converts PDF FileParts to TextParts for providers that don't support native
 * PDF input. Uses `extractPdfText` (pdf-parse) to read directly from the
 * FilePart's base64 / Uint8Array payload on Main.
 */

import type { LanguageModelV3FilePart, LanguageModelV3Message } from '@ai-sdk/provider'
import { definePlugin } from '@cherrystudio/ai-core'
import { loggerService } from '@logger'
import type { Model } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import { isAnthropicModel, isGeminiModel, isOpenAILLMModel } from '@shared/utils/model'
import { extractPdfText } from '@shared/utils/pdf'
import type { LanguageModelMiddleware } from 'ai'

import { getAiSdkProviderId } from '../../../provider/factory'
import type { AppProviderId } from '../../../types'

const logger = loggerService.withContext('pdfCompatibilityPlugin')

type ContentPart = Exclude<LanguageModelV3Message['content'], string>[number]

/**
 * AI SDK provider ids whose API natively supports PDF file input.
 *
 * Only first-party provider protocols (OpenAI Responses, Anthropic, Google)
 * plus cloud-hosted variants are included. Aggregators / generic
 * openai-compatible endpoints are excluded because they may route to
 * backends that reject the `file` part type.
 */
const PDF_NATIVE_PROVIDER_IDS = new Set<AppProviderId>([
  'openai-responses',
  'anthropic',
  'google',
  'azure',
  'azure-responses',
  'google-vertex',
  'amazon-bedrock',
  'anthropic-vertex'
])

function isPdfFilePart(part: ContentPart): part is LanguageModelV3FilePart & { mediaType: 'application/pdf' } {
  return part.type === 'file' && part.mediaType === 'application/pdf'
}

function supportsNativePdf(provider: Provider, model: Model): boolean {
  // OpenAI, Claude, and Gemini models always support native PDF regardless of provider.
  if (isOpenAILLMModel(model) || isAnthropicModel(model) || isGeminiModel(model)) return true
  const aiSdkProviderId = getAiSdkProviderId(provider)
  return PDF_NATIVE_PROVIDER_IDS.has(aiSdkProviderId)
}

function pdfCompatibilityMiddleware(provider: Provider, model: Model): LanguageModelMiddleware {
  return {
    specificationVersion: 'v3',
    transformParams: async ({ params }) => {
      if (supportsNativePdf(provider, model)) return params
      if (!Array.isArray(params.prompt) || params.prompt.length === 0) return params

      const messages: LanguageModelV3Message[] = []
      for (const message of params.prompt) {
        if (!Array.isArray(message.content)) {
          messages.push(message)
          continue
        }
        if (!message.content.some(isPdfFilePart)) {
          messages.push(message)
          continue
        }

        const newContent: ContentPart[] = []
        for (const part of message.content) {
          if (!isPdfFilePart(part)) {
            newContent.push(part)
            continue
          }

          const fileName = part.filename || 'PDF'
          try {
            // TODO: use OCR service to extract text from PDF in V2
            const textContent = await extractPdfText(part.data)
            logger.debug(`Converting PDF FilePart to TextPart for provider ${provider.id}`)
            newContent.push({ type: 'text', text: `${fileName}\n${textContent.trim()}` })
          } catch (error) {
            // Best-effort: drop the PDF part on extraction failure — the model
            // simply won't see it rather than the whole request failing.
            logger.warn(
              `Failed to extract text from PDF ${fileName}`,
              error instanceof Error ? error : new Error(String(error))
            )
          }
        }
        messages.push(Object.assign({}, message, { content: newContent }))
      }

      return { ...params, prompt: messages }
    }
  }
}

const createPdfCompatibilityPlugin = (provider: Provider, model: Model) =>
  definePlugin({
    name: 'pdf-compatibility',
    enforce: 'pre',
    configureContext: (context) => {
      context.middlewares = context.middlewares || []
      context.middlewares.push(pdfCompatibilityMiddleware(provider, model))
    }
  })

import type { RequestFeature } from '../feature'

/**
 * Convert PDF parts to extracted text for providers that can't natively
 * consume `file` content. Must run before Anthropic cache so cache token
 * estimation accounts for the extracted text.
 */
export const pdfCompatibilityFeature: RequestFeature = {
  name: 'pdf-compatibility',
  contributeModelAdapters: (scope) => [createPdfCompatibilityPlugin(scope.provider, scope.model)]
}
