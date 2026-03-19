/**
 * PDF Compatibility Plugin
 *
 * Converts PDF FileParts to TextParts for providers that don't support native PDF input.
 * Extracts text directly from the FilePart's base64 data using pdf-parse.
 */
import type { LanguageModelV3FilePart, LanguageModelV3Message } from '@ai-sdk/provider'
import { definePlugin } from '@cherrystudio/ai-core/core/plugins'
import { loggerService } from '@logger'
import type { Provider, ProviderType } from '@renderer/types'
import { extractPdfText } from '@shared/utils/pdf'
import type { LanguageModelMiddleware } from 'ai'
import i18n from 'i18next'

const logger = loggerService.withContext('pdfCompatibilityPlugin')

type ContentPart = Exclude<LanguageModelV3Message['content'], string>[number]

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

function isPdfFilePart(part: ContentPart): part is LanguageModelV3FilePart & { mediaType: 'application/pdf' } {
  return part.type === 'file' && part.mediaType === 'application/pdf'
}

function pdfCompatibilityMiddleware(provider: Provider): LanguageModelMiddleware {
  return {
    specificationVersion: 'v3',
    transformParams: async ({ params }) => {
      if (PDF_NATIVE_PROVIDER_TYPES.has(provider.type)) {
        return params
      }

      if (!Array.isArray(params.prompt) || params.prompt.length === 0) {
        return params
      }

      const messages: LanguageModelV3Message[] = []
      for (const message of params.prompt) {
        if (!Array.isArray(message.content)) {
          messages.push(message)
          continue
        }

        const hasPdf = message.content.some((part: (typeof message.content)[number]) => isPdfFilePart(part))
        if (!hasPdf) {
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
            const textContent = await extractPdfText(part.data)
            logger.debug(`Converting PDF FilePart to TextPart for provider ${provider.id} (type: ${provider.type})`)
            newContent.push({ type: 'text', text: `${fileName}\n${textContent.trim()}` })
          } catch (error) {
            logger.warn(`Failed to extract text from PDF ${fileName}:`, error instanceof Error ? error : undefined)
            window.toast.warning(i18n.t('message.warning.file.pdf_text_extraction_failed', { name: fileName }))
          }
        }

        messages.push(Object.assign({}, message, { content: newContent }))
      }

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
