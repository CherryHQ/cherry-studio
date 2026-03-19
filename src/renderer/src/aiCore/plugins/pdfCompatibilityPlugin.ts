/**
 * PDF Compatibility Plugin
 *
 * Converts PDF FileParts to TextParts for providers that don't support native PDF input.
 * Uses pre-extracted text content attached in providerOptions.cherryStudio.pdfTextContent.
 */
import type { LanguageModelV3Message } from '@ai-sdk/provider'
import { definePlugin } from '@cherrystudio/ai-core/core/plugins'
import { loggerService } from '@logger'
import type { Provider, ProviderType } from '@renderer/types'
import type { LanguageModelMiddleware } from 'ai'
import i18n from 'i18next'

const logger = loggerService.withContext('pdfCompatibilityPlugin')

/**
 * Provider types whose API protocol supports native PDF file input.
 * Uses provider.type (API protocol) instead of AI SDK provider ID,
 * because aggregator providers (cherryin, new-api, gateway) resolve to
 * non-standard AI SDK IDs but still speak a protocol that supports PDF.
 */
const PDF_NATIVE_PROVIDER_TYPES = new Set<ProviderType>([
  'openai', // OpenAI-compatible API (includes aggregators like cherryin)
  'openai-response', // OpenAI Responses API
  'anthropic', // Anthropic API
  'gemini', // Google Gemini API
  'azure-openai', // Azure OpenAI
  'vertexai', // Google Vertex AI
  'aws-bedrock', // AWS Bedrock
  'vertex-anthropic', // Vertex AI with Anthropic models
  'new-api', // new-api aggregator (OpenAI-compatible)
  'gateway' // Gateway aggregator (OpenAI-compatible)
])

function pdfCompatibilityMiddleware(provider: Provider): LanguageModelMiddleware {
  return {
    specificationVersion: 'v3',
    transformParams: async ({ params }) => {
      // Check provider.type (API protocol), not AI SDK provider ID,
      // because aggregator providers speak standard protocols that support PDF.
      if (PDF_NATIVE_PROVIDER_TYPES.has(provider.type)) {
        return params
      }

      if (!Array.isArray(params.prompt) || params.prompt.length === 0) {
        return params
      }

      const messages = params.prompt.map((msg) => {
        const message = msg as LanguageModelV3Message
        if (!Array.isArray(message.content)) {
          return message
        }

        const newContent = message.content.flatMap((part: any) => {
          // Only convert PDF file parts
          if (part.type !== 'file' || part.mediaType !== 'application/pdf') {
            return [part]
          }

          // Extract pre-extracted text from providerOptions
          const pdfTextContent = part.providerOptions?.cherryStudio?.pdfTextContent as string | undefined

          if (pdfTextContent) {
            logger.debug(`Converting PDF FilePart to TextPart for provider ${provider.id} (type: ${provider.type})`)
            return [{ type: 'text' as const, text: pdfTextContent }]
          }

          // No pre-extracted text available — drop the part and warn user
          logger.warn(
            `PDF file dropped for provider ${provider.id} (type: ${provider.type}): no pre-extracted text available`
          )
          window.toast.warning(
            i18n.t('message.warning.file.pdf_text_extraction_failed', { name: part.filename || 'PDF' })
          )
          return []
        })

        return { ...message, content: newContent } as LanguageModelV3Message
      })

      return { ...params, prompt: messages }
    }
  }
}

export const createPdfCompatibilityPlugin = (provider: Provider) =>
  definePlugin({
    name: 'pdfCompatibility',
    enforce: 'pre',
    configureContext: (context) => {
      context.middlewares = context.middlewares || []
      context.middlewares.push(pdfCompatibilityMiddleware(provider))
    }
  })
