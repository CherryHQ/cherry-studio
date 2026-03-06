/**
 * OpenRouter data transformer
 * Converts OpenRouter API format to internal ModelConfig schema
 */

import type { ModelConfig } from '../../../schemas'
import { MODALITY, type Modality, MODEL_CAPABILITY, type ModelCapability } from '../../../schemas/enums'

type ModelCapabilityType = ModelCapability
import { BaseCatalogTransformer } from '../base/base-transformer'
import type { OpenRouterModel } from './types'

export class OpenRouterTransformer extends BaseCatalogTransformer<OpenRouterModel> {
  /**
   * OpenRouter-specific colon-based variant suffixes
   */
  protected override readonly colonVariantSuffixes = [
    ':free',
    ':extended',
    ':nitro',
    ':beta',
    ':preview',
    ':thinking',
    ':exacto'
  ]

  /**
   * OpenRouter doesn't use hyphen-based suffixes
   */
  protected override readonly hyphenVariantSuffixes: string[] = []

  /**
   * Transform OpenRouter model to internal ModelConfig
   * @param apiModel - Model data from OpenRouter API
   * @returns Internal model configuration
   */
  transform(apiModel: OpenRouterModel): ModelConfig {
    const capabilities = this.inferCapabilities(apiModel)
    const inputModalities = this.mapModalitiesWithEmbeddings(apiModel.architecture?.input_modalities || [])
    const outputModalities = this.mapModalitiesWithEmbeddings(apiModel.architecture?.output_modalities || [])
    const pricing = this.convertPricing(apiModel.pricing)
    const variant = this.getModelVariant(apiModel.id)
    const alias = this.getAlias(apiModel.id)
    const normalizedId = this.normalizeModelId(apiModel.id)
    const publisher = this.inferPublisher(normalizedId)

    return {
      id: normalizedId,
      name: apiModel.name,
      description: apiModel.description || undefined,

      capabilities: capabilities.length > 0 ? capabilities : undefined,
      inputModalities: inputModalities,
      outputModalities: outputModalities,

      contextWindow: apiModel.context_length || apiModel.top_provider?.context_length || undefined,
      maxOutputTokens: apiModel.top_provider?.max_completion_tokens || undefined,

      pricing,

      // Original creator (not aggregator)
      ownedBy: publisher,

      // Alias for date-versioned models
      alias,

      metadata: {
        source: 'openrouter',
        tags: this.extractTags(apiModel),
        category: this.inferCategory(apiModel),
        originalArchitecture: apiModel.architecture?.modality,
        canonicalSlug: apiModel.canonical_slug,
        originalId: apiModel.id,
        ...(variant && { variant }), // Only include if not null/undefined
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
    const outputMods = (apiModel.architecture?.output_modalities || []).map((m) => m.toLowerCase())

    // Embedding models
    if (outputMods.includes('embeddings')) {
      caps.add(MODEL_CAPABILITY.EMBEDDING)
      // Embeddings models don't have other capabilities, return early
      return Array.from(caps)
    }

    // Check supported parameters
    const params = apiModel.supported_parameters || []

    // Function calling support
    if (params.includes('tools') || params.includes('tool_choice')) {
      caps.add(MODEL_CAPABILITY.FUNCTION_CALL)
    }

    // Structured output support
    if (params.includes('response_format') || params.includes('structured_outputs')) {
      caps.add(MODEL_CAPABILITY.STRUCTURED_OUTPUT)
    }

    // Reasoning support
    if (params.includes('reasoning') || params.includes('include_reasoning')) {
      caps.add(MODEL_CAPABILITY.REASONING)
    }

    // Web search (check if pricing > 0)
    if (parseFloat(apiModel.pricing?.web_search || '0') > 0) {
      caps.add(MODEL_CAPABILITY.WEB_SEARCH)
    }

    // Check architecture modality for media capabilities
    const inputMods = (apiModel.architecture?.input_modalities || []).map((m) => m.toLowerCase())

    // Image capabilities
    if (inputMods.includes('image')) {
      caps.add(MODEL_CAPABILITY.IMAGE_RECOGNITION)
    }
    if (outputMods.includes('image')) {
      caps.add(MODEL_CAPABILITY.IMAGE_GENERATION)
    }

    // Audio capabilities
    if (inputMods.includes('audio')) {
      caps.add(MODEL_CAPABILITY.AUDIO_RECOGNITION)
    }
    if (outputMods.includes('audio')) {
      caps.add(MODEL_CAPABILITY.AUDIO_GENERATION)
    }

    // Video capabilities
    if (inputMods.includes('video')) {
      caps.add(MODEL_CAPABILITY.VIDEO_RECOGNITION)
    }
    if (outputMods.includes('video')) {
      caps.add(MODEL_CAPABILITY.VIDEO_GENERATION)
    }

    return Array.from(caps)
  }

  /**
   * Map OpenRouter modalities to internal Modality types
   * Special handling for 'embeddings' modality
   */
  private mapModalitiesWithEmbeddings(modalityList: string[]): Modality[] {
    const modalities = new Set<Modality>()

    for (const m of modalityList) {
      const normalized = m.toLowerCase()
      switch (normalized) {
        case 'text':
          modalities.add(MODALITY.TEXT)
          break
        case 'image':
          modalities.add(MODALITY.IMAGE)
          break
        case 'audio':
          modalities.add(MODALITY.AUDIO)
          break
        case 'video':
          modalities.add(MODALITY.VIDEO)
          break
        case 'embeddings':
          // Embeddings is an output-only modality, treat input as TEXT
          modalities.add(MODALITY.TEXT)
          break
      }
    }

    const result = Array.from(modalities)

    // Default to TEXT if no modalities found
    if (result.length === 0) {
      return [MODALITY.TEXT]
    }

    return result
  }

  /**
   * Convert OpenRouter pricing to internal format
   * OpenRouter uses per-token pricing as strings, we need per-million-tokens as numbers
   */
  private convertPricing(pricing: OpenRouterModel['pricing']): ModelConfig['pricing'] {
    if (!pricing) return undefined
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
      input: { perMillionTokens: promptCost * 1_000_000 },
      output: { perMillionTokens: completionCost * 1_000_000 }
    }

    // Add cache pricing if available
    if (cacheReadCost > 0) {
      result.cacheRead = { perMillionTokens: cacheReadCost * 1_000_000 }
    }

    return result
  }

  /**
   * Extract tags from supported parameters
   */
  private extractTags(apiModel: OpenRouterModel): string[] {
    const tags: string[] = []

    // Add modality as tag
    if (apiModel.architecture?.modality) {
      tags.push(apiModel.architecture.modality)
    }

    // Add some key supported parameters as tags
    const interestingParams = ['tools', 'function_calling', 'reasoning', 'web_search', 'structured_outputs', 'vision']

    for (const param of apiModel.supported_parameters || []) {
      if (interestingParams.some((ip) => param.includes(ip))) {
        tags.push(param)
      }
    }

    // Add tokenizer type if not "Other"
    if (apiModel.architecture?.tokenizer && apiModel.architecture.tokenizer !== 'Other') {
      tags.push(apiModel.architecture.tokenizer)
    }

    return Array.from(new Set(tags)).filter(Boolean)
  }

  /**
   * Infer category from architecture modality
   */
  private inferCategory(apiModel: OpenRouterModel): string {
    const modality = (apiModel.architecture?.modality || '').toLowerCase()

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
