import { application } from '@application'
import { loggerService } from '@logger'
import { BaseService, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { modelService } from '@main/data/services/ModelService'
import { providerService } from '@main/data/services/ProviderService'
import { createUniqueModelId, type UniqueModelId } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import { isOllamaProvider } from '@shared/utils/provider'

const logger = loggerService.withContext('ErrorSummarizerService')

/**
 * Summarizes error output (stack traces, compiler errors, test failures) using a local model.
 * Reduces token costs when sending errors to remote models by compressing them first.
 * Falls back gracefully if no local model is available.
 */
@Injectable('ErrorSummarizerService')
@ServicePhase(Phase.WhenReady)
export class ErrorSummarizerService extends BaseService {
  protected async onInit(): Promise<void> {}
  async summarizeError(errorOutput: string, maxLength: number = 5000): Promise<string | null> {
    try {
      if (!errorOutput || errorOutput.trim().length === 0) {
        return null
      }

      if (errorOutput.length > maxLength) {
        errorOutput = errorOutput.substring(0, maxLength) + '\n... (truncated)'
      }

      const localModelId = await this.findAvailableLocalModel()
      if (!localModelId) {
        logger.debug('no local model available for error summarization')
        return null
      }

      const aiService = application.get('AiService')
      const result = await aiService.generateText(
        {
          conversation: { id: 'error-summarization' },
          uniqueModelId: localModelId,
          prompt: this.buildSummarizationPrompt(errorOutput),
          requestOptions: { maxRetries: 0 }
        },
        []
      )

      if (!result.text || result.text.trim().length === 0) {
        logger.warn('error summarization returned empty result')
        return null
      }

      return result.text.trim()
    } catch (error) {
      logger.warn('error summarization failed', { error: String(error) })
      return null
    }
  }

  private async findAvailableLocalModel(): Promise<UniqueModelId | null> {
    try {
      const providers = providerService.list({})
      for (const provider of providers) {
        if (!this.isLocalInferenceProvider(provider)) {
          continue
        }

        const models = modelService.list({ providerId: provider.id })
        if (models && models.length > 0) {
          const model = models[0]
          const uniqueModelId = createUniqueModelId(provider.id, model.id)
          return uniqueModelId
        }
      }

      return null
    } catch (error) {
      logger.debug('failed to find available local model', { error: String(error) })
      return null
    }
  }

  private isLocalInferenceProvider(provider: Provider): boolean {
    return provider.id === 'ollama' || provider.id === 'lmstudio' || isOllamaProvider(provider)
  }

  private buildSummarizationPrompt(errorOutput: string): string {
    return `Please summarize this error output concisely in 2-3 sentences, focusing on:
1. What failed (the component or operation)
2. The root cause if apparent
3. The error code or key error message

Be very concise - aim for under 100 tokens total.

Error output:
\`\`\`
${errorOutput}
\`\`\`

Summary:`
  }
}
