/**
 * AIHubMix data transformer
 * Converts AIHubMix API format to internal ModelConfig schema
 */

import type { ModelConfig } from '../../../schemas'
import { Modality, ModelCapability } from '../../../schemas/enums'

type ModelCapabilityType = ModelCapability
import { BaseCatalogTransformer, CAPABILITY_PATTERNS } from '../base/base-transformer'
import type { AiHubMixModel } from './types'

export class AiHubMixTransformer extends BaseCatalogTransformer<AiHubMixModel> {
  /**
   * Transform AIHubMix model to internal ModelConfig
   * @param apiModel - Model data from AIHubMix API
   * @returns Internal model configuration
   */
  transform(apiModel: AiHubMixModel): ModelConfig {
    const variant = this.getModelVariant(apiModel.model_id)
    const alias = this.getAlias(apiModel.model_id)
    const normalizedId = this.normalizeModelId(apiModel.model_id)
    const publisher = this.inferPublisher(normalizedId)

    return {
      id: normalizedId,
      description: apiModel.desc || undefined,

      capabilities: this.mapCapabilities(apiModel.types, apiModel.features, normalizedId),
      inputModalities: this.mapInputModalities(apiModel.input_modalities),
      outputModalities: this.inferOutputModalities(apiModel.types),

      contextWindow: apiModel.context_length || undefined,
      maxOutputTokens: apiModel.max_output || undefined,

      pricing: {
        input: { perMillionTokens: apiModel.pricing.input },
        output: { perMillionTokens: apiModel.pricing.output },
        ...(apiModel.pricing.cache_read && {
          cacheRead: { perMillionTokens: apiModel.pricing.cache_read }
        }),
        ...(apiModel.pricing.cache_write && {
          cacheWrite: { perMillionTokens: apiModel.pricing.cache_write }
        })
      },

      // Original creator (not aggregator)
      ownedBy: publisher,

      // Alias for date-versioned models
      alias,

      metadata: {
        source: 'aihubmix',
        tags: this.extractTags(apiModel),
        category: this.inferCategory(apiModel.types),
        originalId: apiModel.model_id,
        ...(variant && { variant }), // Only include if not null/undefined
        originalTypes: apiModel.types,
        originalFeatures: apiModel.features
      }
    }
  }

  /**
   * Map AIHubMix types and features to internal capabilities
   * Also infers capabilities from model ID patterns
   */
  private mapCapabilities(types: string, features: string, modelId: string): ModelCapabilityType[] {
    const caps = new Set<ModelCapabilityType>()

    // Parse features CSV
    const featureList = features
      .split(',')
      .map((f) => f.trim().toLowerCase())
      .filter(Boolean)

    // Map features to capabilities
    for (const feature of featureList) {
      switch (feature) {
        case 'thinking':
          caps.add(ModelCapability.REASONING)
          break
        case 'function_calling':
        case 'tools':
          caps.add(ModelCapability.FUNCTION_CALL)
          break
        case 'structured_outputs':
          caps.add(ModelCapability.STRUCTURED_OUTPUT)
          break
        case 'web':
        case 'deepsearch':
          caps.add(ModelCapability.WEB_SEARCH)
          break
      }
    }

    // Map types to capabilities
    const typeList = types
      .split(',')
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean)

    for (const type of typeList) {
      switch (type) {
        case 'image_generation':
          caps.add(ModelCapability.IMAGE_GENERATION)
          break
        case 'video':
          caps.add(ModelCapability.VIDEO_GENERATION)
          break
      }
    }

    // Infer capabilities from model ID patterns
    for (const [match, exclude, capability] of CAPABILITY_PATTERNS) {
      if (match.test(modelId) && (!exclude || !exclude.test(modelId))) {
        caps.add(capability)
      }
    }

    // Return as array (deduplicate via Set)
    return Array.from(caps)
  }

  /**
   * Map AIHubMix input_modalities CSV to internal Modality array
   */
  private mapInputModalities(modalitiesCSV: string): Modality[] {
    const modalities = new Set<Modality>()

    const modalityList = modalitiesCSV
      .split(',')
      .map((m) => m.trim().toUpperCase())
      .filter(Boolean)

    for (const m of modalityList) {
      switch (m) {
        case 'TEXT':
          modalities.add(Modality.TEXT)
          break
        case 'IMAGE':
          modalities.add(Modality.VISION)
          break
        case 'AUDIO':
          modalities.add(Modality.AUDIO)
          break
        case 'VIDEO':
          modalities.add(Modality.VIDEO)
          break
      }
    }

    const result = Array.from(modalities)

    // Default to TEXT if no modalities found
    if (result.length === 0) {
      return [Modality.TEXT]
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
      return [Modality.VISION]
    }
    if (typeList.includes('video')) {
      return [Modality.VIDEO]
    }

    // Default to TEXT for LLMs
    return [Modality.TEXT]
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
