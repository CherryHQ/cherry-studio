/**
 * AIHubMix data transformer
 * Converts AIHubMix API format to internal ModelConfig schema
 */

import type { Modality,ModelCapabilityType, ModelConfig } from '../../../schemas'
import type { AiHubMixModel } from './types'

export class AiHubMixTransformer {
  /**
   * Transform AIHubMix model to internal ModelConfig
   * @param apiModel - Model data from AIHubMix API
   * @returns Internal model configuration
   */
  transform(apiModel: AiHubMixModel): ModelConfig {
    return {
      id: apiModel.model_id,
      description: apiModel.desc || undefined,

      capabilities: this.mapCapabilities(apiModel.types, apiModel.features),
      input_modalities: this.mapModalities(apiModel.input_modalities),
      output_modalities: this.inferOutputModalities(apiModel.types),

      context_window: apiModel.context_length || 0,
      max_output_tokens: apiModel.max_output || 0,

      pricing: {
        input: {
          per_million_tokens: apiModel.pricing.input,
          currency: 'USD'
        },
        output: {
          per_million_tokens: apiModel.pricing.output,
          currency: 'USD'
        },
        ...(apiModel.pricing.cache_read && {
          cache_read: {
            per_million_tokens: apiModel.pricing.cache_read,
            currency: 'USD'
          }
        }),
        ...(apiModel.pricing.cache_write && {
          cache_write: {
            per_million_tokens: apiModel.pricing.cache_write,
            currency: 'USD'
          }
        })
      },

      metadata: {
        source: 'aihubmix',
        tags: this.extractTags(apiModel),
        category: this.inferCategory(apiModel.types),
        original_types: apiModel.types,
        original_features: apiModel.features
      }
    }
  }

  /**
   * Map AIHubMix types and features to internal capabilities
   */
  private mapCapabilities(types: string, features: string): ModelCapabilityType[] {
    const caps = new Set<ModelCapabilityType>()

    // Parse features CSV
    const featureList = features
      .split(',')
      .map((f) => f.trim().toLowerCase())
      .filter(Boolean)

    // Map features to capabilities
    featureList.forEach((feature) => {
      switch (feature) {
        case 'thinking':
          caps.add('REASONING')
          break
        case 'function_calling':
        case 'tools':
          caps.add('FUNCTION_CALL')
          break
        case 'structured_outputs':
          caps.add('STRUCTURED_OUTPUT')
          break
        case 'web':
        case 'deepsearch':
          caps.add('WEB_SEARCH')
          break
      }
    })

    // Map types to capabilities
    const typeList = types
      .split(',')
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean)

    typeList.forEach((type) => {
      switch (type) {
        case 'image_generation':
          caps.add('IMAGE_GENERATION')
          break
        case 'video':
          caps.add('VIDEO_GENERATION')
          break
      }
    })

    // Return as array (deduplicate via Set)
    const result = Array.from(caps)

    // If no capabilities found, add a default TEXT capability
    if (result.length === 0) {
      return []
    }

    return result
  }

  /**
   * Map AIHubMix input_modalities CSV to internal Modality array
   */
  private mapModalities(modalitiesCSV: string): Modality[] {
    const modalities = new Set<Modality>()

    const modalityList = modalitiesCSV
      .split(',')
      .map((m) => m.trim().toUpperCase())
      .filter(Boolean)

    modalityList.forEach((m) => {
      switch (m) {
        case 'TEXT':
          modalities.add('TEXT')
          break
        case 'IMAGE':
          modalities.add('VISION')
          break
        case 'AUDIO':
          modalities.add('AUDIO')
          break
        case 'VIDEO':
          modalities.add('VIDEO')
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
   * Infer output modalities from model type
   */
  private inferOutputModalities(types: string): Modality[] {
    const typeList = types
      .split(',')
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean)

    if (typeList.includes('image_generation')) {
      return ['VISION']
    }
    if (typeList.includes('video')) {
      return ['VIDEO']
    }

    // Default to TEXT for LLMs
    return ['TEXT']
  }

  /**
   * Extract tags from model data
   */
  private extractTags(apiModel: AiHubMixModel): string[] {
    const tags: string[] = []

    // Add type-based tags
    const types = apiModel.types.split(',').map((t) => t.trim())
    tags.push(...types)

    // Add feature-based tags
    const features = apiModel.features.split(',').map((f) => f.trim())
    tags.push(...features)

    // Deduplicate and filter empty
    return Array.from(new Set(tags)).filter(Boolean)
  }

  /**
   * Infer metadata category from type
   */
  private inferCategory(types: string): string {
    const typeList = types
      .split(',')
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean)

    if (typeList.includes('image_generation')) {
      return 'image-generation'
    }
    if (typeList.includes('video')) {
      return 'video-generation'
    }

    return 'language-model'
  }
}
