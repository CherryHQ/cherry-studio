/**
 * PDF Compatibility Plugin
 *
 * Converts PDF FileParts to TextParts for providers that don't support native PDF input.
 * Uses pre-extracted text content attached in providerOptions.cherryStudio.pdfTextContent.
 */
import type { LanguageModelV3Message } from '@ai-sdk/provider'
import { definePlugin } from '@cherrystudio/ai-core/core/plugins'
import { loggerService } from '@logger'
import type { Provider } from '@renderer/types'
import type { LanguageModelMiddleware } from 'ai'
import i18n from 'i18next'

import { PDF_NATIVE_PROVIDER_IDS } from '../prepareParams/modelCapabilities'
import { getAiSdkProviderId } from '../provider/factory'

const logger = loggerService.withContext('pdfCompatibilityPlugin')

function pdfCompatibilityMiddleware(provider: Provider): LanguageModelMiddleware {
  return {
    specificationVersion: 'v3',
    transformParams: async ({ params }) => {
      const aiSdkId = getAiSdkProviderId(provider)

      // If provider supports native PDF, pass through unchanged
      if (PDF_NATIVE_PROVIDER_IDS.has(aiSdkId)) {
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
            logger.debug(`Converting PDF FilePart to TextPart for provider ${aiSdkId}`)
            return [{ type: 'text' as const, text: pdfTextContent }]
          }

          // No pre-extracted text available — drop the part and warn user
          logger.warn(`PDF file dropped for provider ${aiSdkId}: no pre-extracted text available`)
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
