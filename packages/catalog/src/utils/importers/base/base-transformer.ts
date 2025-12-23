/**
 * Base transformer interface and OpenAI-compatible base class
 * Provides structure for transforming provider API responses to internal ModelConfig
 */

import type { ModelConfig } from '../../../schemas'

/**
 * Generic transformer interface
 */
export interface ITransformer<TInput = any> {
  /**
   * Transform API model to internal ModelConfig
   */
  transform(apiModel: TInput): ModelConfig

  /**
   * Optional: Validate API response structure
   */
  validate?(response: any): boolean

  /**
   * Optional: Extract models array from response
   */
  extractModels?(response: any): TInput[]
}

/**
 * Base class for OpenAI-compatible transformers
 * Handles common patterns like extracting { data: [...] } responses
 */
export class OpenAICompatibleTransformer implements ITransformer {
  /**
   * Default implementation extracts from { data: [...] } or direct array
   */
  extractModels(response: any): any[] {
    if (Array.isArray(response.data)) {
      return response.data
    }
    if (Array.isArray(response)) {
      return response
    }
    throw new Error('Invalid API response structure: expected { data: [] } or []')
  }

  /**
   * Default transformation for OpenAI-compatible model responses
   * Minimal transformation - most fields are optional
   */
  transform(apiModel: any): ModelConfig {
    // Normalize model ID to lowercase
    const modelId = (apiModel.id || apiModel.model || '').toLowerCase()

    if (!modelId) {
      throw new Error('Model ID is required')
    }

    return {
      id: modelId,
      name: apiModel.name || modelId,
      description: apiModel.description,
      owned_by: apiModel.owned_by || 'unknown',

      capabilities: this.inferCapabilities(apiModel),
      input_modalities: ['TEXT'], // Default to text
      output_modalities: ['TEXT'], // Default to text

      context_window: apiModel.context_length || apiModel.context_window || 0,
      max_output_tokens: apiModel.max_tokens || apiModel.max_output_tokens,

      pricing: this.extractPricing(apiModel),

      metadata: {
        source: 'api',
        tags: apiModel.tags || [],
        created: apiModel.created,
        updated: apiModel.updated
      }
    }
  }

  /**
   * Infer basic capabilities from model data
   */
  protected inferCapabilities(apiModel: any): string[] | undefined {
    const capabilities: string[] = []

    // Check for common capability indicators
    if (apiModel.supports_tools || apiModel.function_calling) {
      capabilities.push('FUNCTION_CALL')
    }
    if (apiModel.supports_vision || apiModel.vision) {
      capabilities.push('IMAGE_RECOGNITION')
    }
    if (apiModel.supports_json_output || apiModel.response_format) {
      capabilities.push('STRUCTURED_OUTPUT')
    }

    return capabilities.length > 0 ? capabilities : undefined
  }

  /**
   * Extract pricing if available
   */
  protected extractPricing(apiModel: any): ModelConfig['pricing'] {
    if (!apiModel.pricing) return undefined

    const pricing = apiModel.pricing

    // Handle per-token pricing (convert to per-million)
    if (pricing.prompt !== undefined && pricing.completion !== undefined) {
      const inputCost = parseFloat(pricing.prompt)
      const outputCost = parseFloat(pricing.completion)

      if (inputCost <= 0 || outputCost <= 0) return undefined

      return {
        input: {
          per_million_tokens: inputCost * 1_000_000,
          currency: 'USD'
        },
        output: {
          per_million_tokens: outputCost * 1_000_000,
          currency: 'USD'
        }
      }
    }

    // Handle direct per-million pricing
    if (
      pricing.input?.per_million_tokens != null &&
      pricing.output?.per_million_tokens != null &&
      !isNaN(pricing.input.per_million_tokens) &&
      !isNaN(pricing.output.per_million_tokens)
    ) {
      return {
        input: {
          per_million_tokens: pricing.input.per_million_tokens,
          currency: pricing.input.currency || 'USD'
        },
        output: {
          per_million_tokens: pricing.output.per_million_tokens,
          currency: pricing.output.currency || 'USD'
        }
      }
    }

    return undefined
  }
}
