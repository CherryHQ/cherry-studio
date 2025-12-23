/**
 * OpenRouter data transformer
 * Converts OpenRouter API format to internal ModelConfig schema
 */

import type { Modality, ModelCapabilityType, ModelConfig } from '../../../schemas'
import type { OpenRouterModel } from './types'

export class OpenRouterTransformer {
  /**
   * Normalize model ID by extracting the model name from provider/model format and converting to lowercase
   * @param modelId - Original model ID (e.g., "openrouter/GPT-4" or "anthropic/Claude-3-Opus")
   * @returns Normalized lowercase model ID (e.g., "gpt-4" or "claude-3-opus")
   */
  private normalizeModelId(modelId: string): string {
    // Split by '/' and take the last part, then convert to lowercase
    const parts = modelId.split('/')
    return parts[parts.length - 1].toLowerCase()
  }

  /**
   * Transform OpenRouter model to internal ModelConfig
   * @param apiModel - Model data from OpenRouter API
   * @returns Internal model configuration
   */
  transform(apiModel: OpenRouterModel): ModelConfig {
    const capabilities = this.inferCapabilities(apiModel)
    const inputModalities = this.mapModalities(apiModel.architecture.input_modalities)
    const outputModalities = this.mapModalities(apiModel.architecture.output_modalities)
    const pricing = this.convertPricing(apiModel.pricing)

    return {
      id: this.normalizeModelId(apiModel.id),
      name: apiModel.name,
      description: apiModel.description || undefined,
      owned_by: 'openrouter',

      capabilities: capabilities.length > 0 ? capabilities : undefined,
      input_modalities: inputModalities,
      output_modalities: outputModalities,

      context_window: apiModel.context_length || apiModel.top_provider.context_length,
      max_output_tokens: apiModel.top_provider.max_completion_tokens || undefined,

      pricing,

      metadata: {
        source: 'openrouter',
        tags: this.extractTags(apiModel),
        category: this.inferCategory(apiModel),
        original_architecture: apiModel.architecture.modality,
        canonical_slug: apiModel.canonical_slug,
        created: apiModel.created
      }
    }
  }

  /**
   * Infer capabilities from supported parameters and architecture
   */
  private inferCapabilities(apiModel: OpenRouterModel): ModelCapabilityType[] {
    const caps = new Set<ModelCapabilityType>()

    // Check architecture modality for embeddings
    const outputMods = apiModel.architecture.output_modalities.map((m) => m.toLowerCase())

    // Embedding models
    if (outputMods.includes('embeddings')) {
      caps.add('EMBEDDING')
      // Embeddings models don't have other capabilities, return early
      return Array.from(caps)
    }

    // Check supported parameters
    const params = apiModel.supported_parameters || []

    // Function calling support
    if (params.includes('tools') || params.includes('tool_choice')) {
      caps.add('FUNCTION_CALL')
    }

    // Structured output support
    if (params.includes('response_format') || params.includes('structured_outputs')) {
      caps.add('STRUCTURED_OUTPUT')
    }

    // Reasoning support
    if (params.includes('reasoning') || params.includes('include_reasoning')) {
      caps.add('REASONING')
    }

    // Web search (check if pricing > 0)
    if (parseFloat(apiModel.pricing.web_search || '0') > 0) {
      caps.add('WEB_SEARCH')
    }

    // Check architecture modality for media capabilities
    const inputMods = apiModel.architecture.input_modalities.map((m) => m.toLowerCase())

    // Image capabilities
    if (inputMods.includes('image')) {
      caps.add('IMAGE_RECOGNITION')
    }
    if (outputMods.includes('image')) {
      caps.add('IMAGE_GENERATION')
    }

    // Audio capabilities
    if (inputMods.includes('audio')) {
      caps.add('AUDIO_RECOGNITION')
    }
    if (outputMods.includes('audio')) {
      caps.add('AUDIO_GENERATION')
    }

    // Video capabilities
    if (inputMods.includes('video')) {
      caps.add('VIDEO_RECOGNITION')
    }
    if (outputMods.includes('video')) {
      caps.add('VIDEO_GENERATION')
    }

    return Array.from(caps)
  }

  /**
   * Map OpenRouter modalities to internal Modality types
   */
  private mapModalities(modalityList: string[]): Modality[] {
    const modalities = new Set<Modality>()

    modalityList.forEach((m) => {
      const normalized = m.toLowerCase()
      switch (normalized) {
        case 'text':
          modalities.add('TEXT')
          break
        case 'image':
          modalities.add('VISION')
          break
        case 'audio':
          modalities.add('AUDIO')
          break
        case 'video':
          modalities.add('VIDEO')
          break
        case 'embeddings':
          // Embeddings is an output-only modality, treat input as TEXT
          modalities.add('TEXT')
          break
      }
    })

    const result = Array.from(modalities)

    // Default to TEXT if no modalities found
    if (result.length === 0) {
      return ['TEXT']
    }

    return result
  }

  /**
   * Convert OpenRouter pricing to internal format
   * OpenRouter uses per-token pricing as strings, we need per-million-tokens as numbers
   */
  private convertPricing(pricing: OpenRouterModel['pricing']): ModelConfig['pricing'] {
    const promptCost = parseFloat(pricing.prompt || '0')
    const completionCost = parseFloat(pricing.completion || '0')
    const cacheReadCost = parseFloat(pricing.input_cache_read || '0')

    // If all costs are 0 or negative (OpenRouter uses -1 for unknown/dynamic pricing), return undefined
    if (promptCost <= 0 && completionCost <= 0) {
      return undefined
    }

    // If either cost is negative, return undefined (invalid pricing)
    if (promptCost < 0 || completionCost < 0) {
      return undefined
    }

    const result: ModelConfig['pricing'] = {
      input: {
        per_million_tokens: promptCost * 1_000_000,
        currency: 'USD'
      },
      output: {
        per_million_tokens: completionCost * 1_000_000,
        currency: 'USD'
      }
    }

    // Add cache pricing if available
    if (cacheReadCost > 0) {
      result.cache_read = {
        per_million_tokens: cacheReadCost * 1_000_000,
        currency: 'USD'
      }
    }

    return result
  }

  /**
   * Extract tags from supported parameters
   */
  private extractTags(apiModel: OpenRouterModel): string[] {
    const tags: string[] = []

    // Add modality as tag
    tags.push(apiModel.architecture.modality)

    // Add some key supported parameters as tags
    const interestingParams = [
      'tools',
      'function_calling',
      'reasoning',
      'web_search',
      'structured_outputs',
      'vision'
    ]

    apiModel.supported_parameters.forEach((param) => {
      if (interestingParams.some((ip) => param.includes(ip))) {
        tags.push(param)
      }
    })

    // Add tokenizer type if not "Other"
    if (apiModel.architecture.tokenizer && apiModel.architecture.tokenizer !== 'Other') {
      tags.push(apiModel.architecture.tokenizer)
    }

    return Array.from(new Set(tags)).filter(Boolean)
  }

  /**
   * Infer category from architecture modality
   */
  private inferCategory(apiModel: OpenRouterModel): string {
    const modality = apiModel.architecture.modality.toLowerCase()

    if (modality.includes('image') && modality.includes('->image')) {
      return 'image-generation'
    }
    if (modality.includes('video') && modality.includes('->video')) {
      return 'video-generation'
    }
    if (modality.includes('audio') && modality.includes('->audio')) {
      return 'audio-generation'
    }

    return 'language-model'
  }
}
