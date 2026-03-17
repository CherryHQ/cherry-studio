/**
 * models.dev data transformer
 * Converts models.dev API format to internal ModelConfig and ProviderConfig schemas
 */

import type { ModelConfig, ProviderConfig } from '../../../schemas'
import { ENDPOINT_TYPE, MODALITY, type Modality, MODEL_CAPABILITY, type ModelCapability } from '../../../schemas/enums'

type ModelCapabilityType = ModelCapability
import { BaseCatalogTransformer, CAPABILITY_PATTERNS, inferPublisherFromModelId } from '../base/base-transformer'
import type { ModelsDevModel, ModelsDevProvider } from './types'

export class ModelsDevTransformer extends BaseCatalogTransformer<ModelsDevModel> {
  /**
   * ModelsDevTransformer uses providerId for context-aware transformation
   */
  private currentProviderId = ''

  // Uses default HYPHEN_VARIANT_SUFFIXES from base class
  // which includes: -free, -search, -online, -think, -reasoning, -classic,
  // -tee, -cc, -fw, -di, -t, -reverse, etc.

  /**
   * Official models that end with variant-like suffixes but should NOT be stripped
   * These are actual official model names from their respective providers
   */
  protected override readonly officialModelsWithSuffix = new Set([
    // OpenAI SearchGPT models
    'gpt-4o-search',
    'gpt-4o-mini-search',
    // Perplexity reasoning models
    'sonar-reasoning',
    'sonar-pro-reasoning',
    // Microsoft Phi reasoning models
    'phi-4-reasoning',
    'phi-4-mini-reasoning',
    // xAI Grok reasoning models (include non-reasoning as official too)
    'grok-4-fast-reasoning',
    'grok-4-fast-non-reasoning',
    'grok-4-1-fast-reasoning',
    'grok-4-1-fast-non-reasoning',
    'grok-4.1-fast-reasoning',
    'grok-4.1-fast-non-reasoning'
  ])

  /**
   * Publishers known for specific capabilities
   */
  private static readonly PUBLISHER_CAPABILITIES: Record<string, ModelCapabilityType[]> = {
    jina: [MODEL_CAPABILITY.EMBEDDING, MODEL_CAPABILITY.RERANK],
    voyage: [MODEL_CAPABILITY.EMBEDDING, MODEL_CAPABILITY.RERANK],
    cohere: [MODEL_CAPABILITY.EMBEDDING, MODEL_CAPABILITY.RERANK],
    stability: [MODEL_CAPABILITY.IMAGE_GENERATION],
    baai: [MODEL_CAPABILITY.EMBEDDING, MODEL_CAPABILITY.RERANK]
  }

  /**
   * Transform models.dev provider to internal ProviderConfig
   */
  transformProvider(apiProvider: ModelsDevProvider): ProviderConfig {
    // Build base_urls from API URL
    const baseUrls = apiProvider.api ? this.inferBaseUrls(apiProvider.api) : { default: '' }

    return {
      id: apiProvider.id,
      name: apiProvider.name,
      description: `Provider from models.dev catalog`,
      baseUrls: baseUrls,
      defaultChatEndpoint: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS,
      metadata: {
        source: 'modelsdev',
        envVars: apiProvider.env,
        npmPackage: apiProvider.npm,
        website: {
          official: apiProvider.doc || '',
          docs: apiProvider.doc || '',
          apiKey: apiProvider.doc || ''
        }
      }
    }
  }

  /**
   * Transform models.dev model to internal ModelConfig
   * Uses the base class `transform` method signature but requires providerId context
   */
  transform(apiModel: ModelsDevModel): ModelConfig {
    return this.transformModel(apiModel, this.currentProviderId)
  }

  /**
   * Transform models.dev model to internal ModelConfig with providerId
   */
  transformModel(apiModel: ModelsDevModel, providerId: string): ModelConfig {
    // Store providerId for use in transform() if called without providerId
    this.currentProviderId = providerId

    const normalizedId = this.normalizeModelId(apiModel.id)
    // Infer the original model publisher (not aggregator)
    const publisher = this.inferPublisherWithFallback(normalizedId, providerId)
    const capabilities = this.inferCapabilities(apiModel, publisher)
    const inputModalities = apiModel.modalities
      ? this.mapModalities(apiModel.modalities.input)
      : ([MODALITY.TEXT] as Modality[])
    const outputModalities = apiModel.modalities
      ? this.mapOutputModalities(apiModel.modalities.output)
      : ([MODALITY.TEXT] as Modality[])
    const pricing = apiModel.cost ? this.convertPricing(apiModel.cost) : undefined
    const variant = this.getModelVariant(apiModel.id)
    const alias = this.getAlias(apiModel.id)

    // Track if this is from an aggregator (providerId differs from publisher)
    const isAggregator = providerId !== publisher

    return {
      id: normalizedId,
      name: apiModel.name,
      description: undefined,

      capabilities: capabilities.length > 0 ? capabilities : undefined,
      inputModalities: inputModalities,
      outputModalities: outputModalities,

      contextWindow: apiModel.limit?.context || undefined,
      maxOutputTokens: apiModel.limit?.output || undefined,

      pricing,

      // Model family (e.g., "GPT-4", "Claude 3")
      family: apiModel.family || undefined,

      // Original creator (e.g., "anthropic", "google", "openai"), not the aggregator
      ownedBy: publisher,

      // Whether the model has open weights
      openWeights: apiModel.open_weights,

      // Alias for date-versioned models (e.g., claude-sonnet-4-5-20250929 -> claude-sonnet-4-5)
      alias,

      metadata: {
        source: 'modelsdev',
        originalId: apiModel.id,
        ...(variant && { variant }), // Only include if not null/undefined
        ...(isAggregator && { aggregator: providerId }), // Track aggregator if different from publisher
        ...(apiModel.interleaved && { interleavedThinking: true }), // Track interleaved support from models.dev
        knowledgeCutoff: apiModel.knowledge,
        releaseDate: apiModel.release_date,
        lastUpdated: apiModel.last_updated
      }
    }
  }

  /**
   * Infer the original model publisher from model ID
   * Returns the providerId if no match found (could be the publisher itself)
   */
  private inferPublisherWithFallback(modelId: string, providerId: string): string {
    const publisher = inferPublisherFromModelId(modelId)
    if (publisher) {
      return publisher
    }

    // If no pattern matches, the providerId might be the actual publisher
    // (e.g., "anthropic" provider hosting "claude" models)
    return providerId
  }

  /**
   * Infer base_urls from API base URL
   */
  private inferBaseUrls(apiUrl: string): Record<string, string> {
    // Normalize URL (remove trailing slash)
    const baseUrl = apiUrl.replace(/\/$/, '')

    // Map to chat_completions endpoint type (most common for models.dev providers)
    return {
      [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: baseUrl
    }
  }

  /**
   * Infer capabilities from model flags, model ID patterns, and publisher
   */
  private inferCapabilities(apiModel: ModelsDevModel, publisher?: string): ModelCapabilityType[] {
    const caps = new Set<ModelCapabilityType>()
    const modelId = apiModel.id.toLowerCase()

    // Reasoning/thinking support
    if (apiModel.reasoning) {
      caps.add(MODEL_CAPABILITY.REASONING)
    }

    // Function/tool calling
    if (apiModel.tool_call) {
      caps.add(MODEL_CAPABILITY.FUNCTION_CALL)
    }

    // Structured output (JSON mode)
    if (apiModel.structured_output) {
      caps.add(MODEL_CAPABILITY.STRUCTURED_OUTPUT)
    }

    // File/attachment support implies file input
    if (apiModel.attachment) {
      caps.add(MODEL_CAPABILITY.FILE_INPUT)
    }

    // Check input modalities (skip if not provided)
    const inputMods = apiModel.modalities?.input.map((m) => m.toLowerCase()) ?? []
    const outputMods = apiModel.modalities?.output.map((m) => m.toLowerCase()) ?? []

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

    // Embedding capability
    if (outputMods.includes('embedding') || outputMods.includes('embeddings')) {
      caps.add(MODEL_CAPABILITY.EMBEDDING)
    }

    // Infer capabilities from model ID patterns
    for (const [match, exclude, capability] of CAPABILITY_PATTERNS) {
      if (match.test(modelId) && (!exclude || !exclude.test(modelId))) {
        caps.add(capability)
      }
    }

    // Infer capabilities from publisher (for embedding/rerank focused providers)
    if (publisher && ModelsDevTransformer.PUBLISHER_CAPABILITIES[publisher]) {
      const publisherCaps = ModelsDevTransformer.PUBLISHER_CAPABILITIES[publisher]

      // Add EMBEDDING if model name suggests it's an embedding model
      if (
        publisherCaps.includes(MODEL_CAPABILITY.EMBEDDING) &&
        (modelId.includes('embed') || modelId.includes('e5') || modelId.includes('bge'))
      ) {
        caps.add(MODEL_CAPABILITY.EMBEDDING)
      }

      // Add RERANK only if model name explicitly contains 'rerank'
      if (publisherCaps.includes(MODEL_CAPABILITY.RERANK) && modelId.includes('rerank')) {
        caps.add(MODEL_CAPABILITY.RERANK)
      }

      // Add IMAGE_GENERATION for stability models (they're all image gen)
      if (publisherCaps.includes(MODEL_CAPABILITY.IMAGE_GENERATION)) {
        caps.add(MODEL_CAPABILITY.IMAGE_GENERATION)
      }
    }

    return Array.from(caps)
  }

  /**
   * Map output modalities to internal format
   * Handles special case for embeddings output
   */
  private mapOutputModalities(modalityList: string[]): Modality[] {
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
        case 'embedding':
        case 'embeddings':
          modalities.add(MODALITY.VECTOR)
          break
      }
    }

    const result = Array.from(modalities)
    return result.length > 0 ? result : [MODALITY.TEXT]
  }

  /**
   * Convert pricing to internal format
   * models.dev uses per-million-tokens pricing directly
   */
  private convertPricing(cost: NonNullable<ModelsDevModel['cost']>): ModelConfig['pricing'] {
    // Skip if both costs are 0 (free/unknown)
    if (cost.input <= 0 && cost.output <= 0) {
      return undefined
    }

    const result: ModelConfig['pricing'] = {
      input: { perMillionTokens: cost.input },
      output: { perMillionTokens: cost.output }
    }

    // Add cache pricing if available
    if (cost.cache_read && cost.cache_read > 0) {
      result.cacheRead = { perMillionTokens: cost.cache_read }
    }

    return result
  }
}
