/**
 * Converts PDF FileParts → TextParts for providers without native PDF
 * input. Runs before `anthropicCacheFeature` so cache estimation sees
 * the extracted text.
 */

import type { LanguageModelV3FilePart, LanguageModelV3Message } from '@ai-sdk/provider'
import { definePlugin } from '@cherrystudio/ai-core'
import { loggerService } from '@logger'
import type { Model } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import { isAnthropicModel, isGeminiModel, isOpenAILLMModel } from '@shared/utils/model'
import { extractPdfText } from '@shared/utils/pdf'
import type { LanguageModelMiddleware } from 'ai'

import type { AppProviderId } from '../../../../types'

const logger = loggerService.withContext('pdfCompatibilityPlugin')

type ContentPart = Exclude<LanguageModelV3Message['content'], string>[number]

/** First-party protocols only — aggregators / openai-compatible may route to backends that reject `file` parts. */
const PDF_NATIVE_PROVIDER_IDS = new Set<AppProviderId>([
  // The resolver emits the base `openai` id only for the Responses endpoint (chat-completions
  // resolves to `openai-chat`/`openai-compatible`), so matching `openai` targets exactly the
  // native-PDF-capable Responses path. (`openai-responses` is never emitted — dead literal.)
  'openai',
  'anthropic',
  'google',
  'azure',
  'azure-responses',
  'google-vertex',
  'bedrock',
  'anthropic-vertex'
])

/** Providers known to break on native PDF parts (e.g. Qiniu GPT-5.4 regression #15090). */
const PDF_FORCE_TEXT_EXTRACTION_PROVIDER_IDS = new Set<string>(['qiniu'])

function isPdfFilePart(part: ContentPart): part is LanguageModelV3FilePart & { mediaType: 'application/pdf' } {
  return part.type === 'file' && part.mediaType === 'application/pdf'
}

function supportsNativePdf(provider: Provider, model: Model, aiSdkProviderId: AppProviderId): boolean {
  if (
    PDF_FORCE_TEXT_EXTRACTION_PROVIDER_IDS.has(provider.id) ||
    (provider.presetProviderId != null && PDF_FORCE_TEXT_EXTRACTION_PROVIDER_IDS.has(provider.presetProviderId))
  ) {
    return false
  }
  if (!PDF_NATIVE_PROVIDER_IDS.has(aiSdkProviderId)) return false

  if (aiSdkProviderId === 'openai' || aiSdkProviderId === 'azure' || aiSdkProviderId === 'azure-responses') {
    return isOpenAILLMModel(model)
  }
  if (aiSdkProviderId === 'anthropic' || aiSdkProviderId === 'anthropic-vertex' || aiSdkProviderId === 'bedrock') {
    return isAnthropicModel(model)
  }
  if (aiSdkProviderId === 'google' || aiSdkProviderId === 'google-vertex') {
    return isGeminiModel(model)
  }
  return true
}

function pdfCompatibilityMiddleware(
  provider: Provider,
  model: Model,
  aiSdkProviderId: AppProviderId
): LanguageModelMiddleware {
  return {
    specificationVersion: 'v3',
    transformParams: async ({ params }) => {
      if (supportsNativePdf(provider, model, aiSdkProviderId)) return params
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
            // Drop the PDF on extraction failure so the request still goes through.
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

const createPdfCompatibilityPlugin = (provider: Provider, model: Model, aiSdkProviderId: AppProviderId) =>
  definePlugin({
    name: 'pdf-compatibility',
    enforce: 'pre',
    configureContext: (context) => {
      context.middlewares = context.middlewares || []
      context.middlewares.push(pdfCompatibilityMiddleware(provider, model, aiSdkProviderId))
    }
  })

import type { RequestFeature } from '../feature'

export const pdfCompatibilityFeature: RequestFeature = {
  name: 'pdf-compatibility',
  contributeModelAdapters: (scope) => [createPdfCompatibilityPlugin(scope.provider, scope.model, scope.aiSdkProviderId)]
}
