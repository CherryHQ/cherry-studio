/**
 * PDF Compatibility Plugin
 *
 * Converts PDF FileParts to TextParts for providers that don't support native PDF input.
 * Extracts text directly from the FilePart's base64 data using pdf-parse.
 */
import type { LanguageModelV3FilePart, LanguageModelV3Message } from '@ai-sdk/provider'
import { definePlugin } from '@cherrystudio/ai-core/core/plugins'
import { loggerService } from '@logger'
import { isAnthropicModel, isGeminiModel } from '@renderer/config/models'
import { isOpenAILLMModel } from '@renderer/config/models/openai'
import type { Model, Provider, ProviderType } from '@renderer/types'
import { extractPdfText } from '@shared/utils/pdf'
import type { LanguageModelMiddleware } from 'ai'
import i18n from 'i18next'

const logger = loggerService.withContext('pdfCompatibilityPlugin')
const MAX_INLINE_PDF_TEXT_BYTES = 4 * 1024 * 1024
const PDF_TRUNCATED_SUFFIX = '\n[PDF truncated]'
const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()

type ContentPart = Exclude<LanguageModelV3Message['content'], string>[number]

function getUtf8ByteLength(text: string): number {
  return textEncoder.encode(text).length
}

function truncateUtf8Text(text: string, maxBytes: number): string {
  if (maxBytes <= 0 || text.length === 0) {
    return ''
  }

  const encoded = textEncoder.encode(text)
  if (encoded.length <= maxBytes) {
    return text
  }

  let truncated = textDecoder.decode(encoded.slice(0, maxBytes))
  while (getUtf8ByteLength(truncated) > maxBytes && truncated.length > 0) {
    truncated = truncated.slice(0, -1)
  }

  return truncated
}

function buildPdfPromptText(
  fileName: string,
  textContent: string,
  maxBytes: number
): { text: string; truncated: boolean } | null {
  if (maxBytes <= 0) {
    return null
  }

  const normalizedContent = textContent.trim()
  const prefix = `${fileName}\n`
  const prefixBytes = getUtf8ByteLength(prefix)
  const fullText = `${prefix}${normalizedContent}`

  if (getUtf8ByteLength(fullText) <= maxBytes) {
    return { text: fullText, truncated: false }
  }

  const suffixBytes = getUtf8ByteLength(PDF_TRUNCATED_SUFFIX)
  const contentBudget = maxBytes - prefixBytes - suffixBytes
  if (contentBudget <= 0) {
    return null
  }

  const truncatedContent = truncateUtf8Text(normalizedContent, contentBudget)
  const text = `${prefix}${truncatedContent}${PDF_TRUNCATED_SUFFIX}`

  if (getUtf8ByteLength(text) <= maxBytes) {
    return { text, truncated: true }
  }

  const compactText = truncateUtf8Text(text, maxBytes)
  return compactText ? { text: compactText, truncated: true } : null
}

/**
 * Provider types whose API natively supports PDF file input.
 * Only first-party provider protocols (OpenAI, Anthropic, Google) are included.
 * Aggregators (new-api, gateway) and generic 'openai' type are excluded
 * because they may route to backends that don't support the 'file' part type.
 */
const PDF_NATIVE_PROVIDER_TYPES = new Set<ProviderType>([
  'openai-response', // OpenAI Responses API
  'anthropic', // Anthropic API
  'gemini', // Google Gemini API
  'azure-openai', // Azure OpenAI
  'vertexai', // Google Vertex AI
  'aws-bedrock', // AWS Bedrock
  'vertex-anthropic' // Vertex AI with Anthropic models
])

function isPdfFilePart(part: ContentPart): part is LanguageModelV3FilePart & { mediaType: 'application/pdf' } {
  return part.type === 'file' && part.mediaType === 'application/pdf'
}

function supportsNativePdf(provider: Provider, model: Model): boolean {
  // OpenAI, Claude, and Gemini models always support native PDF regardless of provider
  if (isOpenAILLMModel(model) || isAnthropicModel(model) || isGeminiModel(model)) {
    return true
  }
  if (PDF_NATIVE_PROVIDER_TYPES.has(provider.type)) {
    return true
  }
  // TODO: allow user to configure native pdf compatibility for provider/model
  return false
}

function pdfCompatibilityMiddleware(provider: Provider, model: Model): LanguageModelMiddleware {
  return {
    specificationVersion: 'v3',
    transformParams: async ({ params }) => {
      if (supportsNativePdf(provider, model)) {
        return params
      }

      if (!Array.isArray(params.prompt) || params.prompt.length === 0) {
        return params
      }

      const pdfPartCount = params.prompt.reduce((count, message) => {
        if (!Array.isArray(message.content)) {
          return count
        }

        return count + message.content.filter((part: (typeof message.content)[number]) => isPdfFilePart(part)).length
      }, 0)

      if (pdfPartCount === 0) {
        return params
      }

      let remainingPdfBudget = MAX_INLINE_PDF_TEXT_BYTES
      let remainingPdfParts = pdfPartCount

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
          const budgetForThisFile = Math.ceil(remainingPdfBudget / remainingPdfParts)
          remainingPdfParts -= 1

          if (budgetForThisFile <= 0) {
            logger.warn(`Skipping PDF ${fileName} because the prompt budget is exhausted`)
            continue
          }

          try {
            const textContent =
              part.data instanceof URL ? await extractPdfText(part.data) : await window.api.pdf.extractText(part.data)
            const promptText = buildPdfPromptText(fileName, textContent, budgetForThisFile)

            if (!promptText) {
              logger.warn(`Skipping PDF ${fileName} because the prompt budget is too small`)
              continue
            }

            if (promptText.truncated) {
              logger.debug(
                `Truncated PDF ${fileName} to fit within the request budget for provider ${provider.id} (type: ${provider.type})`
              )
            } else {
              logger.debug(`Converting PDF FilePart to TextPart for provider ${provider.id} (type: ${provider.type})`)
            }

            newContent.push({ type: 'text', text: promptText.text })
            remainingPdfBudget = Math.max(0, remainingPdfBudget - getUtf8ByteLength(promptText.text))
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

export const createPdfCompatibilityPlugin = (provider: Provider, model: Model) =>
  definePlugin({
    name: 'pdfCompatibility',
    enforce: 'pre',
    configureContext: (context) => {
      context.middlewares = context.middlewares || []
      context.middlewares.push(pdfCompatibilityMiddleware(provider, model))
    }
  })
