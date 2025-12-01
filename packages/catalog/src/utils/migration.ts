/**
 * Migration Tool - Phase 2 Implementation
 * Migrates existing JSON data to new schema-based catalog system
 */

import * as fs from 'fs/promises'
import * as path from 'path'

interface ProviderEndpointsData {
  providers: Record<
    string,
    {
      display_name: string
      endpoints: Record<string, boolean>
      url: string
    }
  >
}

interface ModelPricesData {
  [modelId: string]: {
    litellm_provider: string
    mode: string
    input_cost_per_token?: number
    output_cost_per_token?: number
    input_cost_per_pixel?: number
    output_cost_per_pixel?: number
    output_cost_per_image?: number
    max_input_tokens?: number
    max_output_tokens?: number
    max_tokens?: number
    supports_function_calling?: boolean
    supports_vision?: boolean
    supports_parallel_function_calling?: boolean
    supports_response_schema?: boolean
    supports_tool_choice?: boolean
    supports_system_messages?: boolean
    supports_assistant_prefill?: boolean
    supports_pdf_input?: boolean
    supports_prompt_caching?: boolean
    cache_creation_input_token_cost?: number
    cache_read_input_token_cost?: number
    metadata?: {
      notes?: string
    }
    source?: string
    supported_endpoints?: string[]
    deprecation_date?: string
  }
}

interface ModelConfig {
  id: string
  name?: string
  owned_by?: string
  description?: string
  capabilities: string[]
  input_modalities: string[]
  output_modalities: string[]
  context_window: number
  max_output_tokens: number
  max_input_tokens?: number
  pricing?: {
    input: { per_million_tokens: number; currency: string }
    output: { per_million_tokens: number; currency: string }
  }
  parameters?: Record<string, any>
  endpoint_types?: string[]
  metadata?: Record<string, any>
}

interface ProviderConfig {
  id: string
  name: string
  description?: string
  authentication: string
  supported_endpoints: string[]
  api_compatibility?: Record<string, boolean>
  special_config?: Record<string, any>
  documentation?: string
  website?: string
  deprecated: boolean
  maintenance_mode: boolean
  config_version: string
  metadata?: Record<string, any>
}

interface OverrideConfig {
  provider_id: string
  model_id: string
  capabilities?: {
    add?: string[]
    remove?: string[]
    force?: string[]
  }
  limits?: {
    context_window?: number
    max_output_tokens?: number
    max_input_tokens?: number
  }
  pricing?: {
    input: { per_million_tokens: number; currency: string }
    output: { per_million_tokens: number; currency: string }
  }
  disabled?: boolean
  reason?: string
  last_updated?: string
  updated_by?: string
  priority?: number
}

export class MigrationTool {
  private providerEndpointsData: ProviderEndpointsData
  private modelPricesData: ModelPricesData

  constructor(
    private providerEndpointsPath: string,
    private modelPricesPath: string,
    private outputDir: string
  ) {
    // Initialize with empty objects to satisfy TypeScript
    this.providerEndpointsData = { providers: {} }
    this.modelPricesData = {}
  }

  async loadData(): Promise<void> {
    console.log('📖 Loading existing data...')

    const providerEndpointsContent = await fs.readFile(this.providerEndpointsPath, 'utf-8')
    this.providerEndpointsData = JSON.parse(providerEndpointsContent)

    const modelPricesContent = await fs.readFile(this.modelPricesPath, 'utf-8')
    this.modelPricesData = JSON.parse(modelPricesContent)

    console.log(`✅ Loaded ${Object.keys(this.providerEndpointsData.providers).length} providers`)
    console.log(`✅ Loaded ${Object.keys(this.modelPricesData).length} model configurations`)
  }

  /**
   * Extract base model identifier from provider-specific model ID
   */
  private extractBaseModelId(providerModelId: string): string {
    // Remove provider prefixes
    const prefixes = [
      'azure/',
      'bedrock/',
      'openrouter/',
      'vertex_ai/',
      'sagemaker/',
      'watsonx/',
      'litellm_proxy/',
      'custom/',
      'aiml/',
      'together_ai/',
      'deepinfra/',
      'hyperbolic/',
      'fireworks_ai/',
      'replicate/',
      'novita/',
      'anyscale/',
      'runpod/',
      'triton/',
      'vllm/',
      'ollama/',
      'lm_studio/'
    ]

    let baseId = providerModelId
    for (const prefix of prefixes) {
      if (baseId.startsWith(prefix)) {
        baseId = baseId.substring(prefix.length)
        break
      }
    }

    // Handle AWS Bedrock specific naming
    if (baseId.includes(':')) {
      baseId = baseId.split(':')[0]
    }

    // Handle version suffixes
    baseId = baseId.replace(/\/v\d+$/, '').replace(/:v\d+$/, '')

    return baseId
  }

  /**
   * Determine if a model is a base model or provider-specific override
   */
  private isBaseModel(modelId: string, provider: string): boolean {
    const baseId = this.extractBaseModelId(modelId)

    // Official provider models are base models
    const officialProviders = [
      'anthropic',
      'openai',
      'gemini',
      'deepseek',
      'dashscope',
      'volceengine',
      'minimax',
      'moonshotai',
      'zai',
      'meta',
      'mistral',
      'cohere',
      'xai'
    ]

    if (officialProviders.includes(provider)) {
      return modelId === baseId || modelId.startsWith(provider + '/')
    }

    // Third-party providers selling access to official models are overrides
    return false
  }

  /**
   * Convert endpoint support to provider capabilities
   */
  private privateConvertEndpointsToCapabilities(endpoints: Record<string, boolean>): string[] {
    const endpointCapabilityMap: Record<string, string> = {
      chat_completions: 'CHAT_COMPLETIONS',
      messages: 'MESSAGES',
      responses: 'RESPONSES',
      completions: 'COMPLETIONS',
      embeddings: 'EMBEDDINGS',
      image_generations: 'IMAGE_GENERATION',
      image_edit: 'IMAGE_EDIT',
      audio_speech: 'AUDIO_GENERATION',
      audio_transcriptions: 'AUDIO_TRANSCRIPT',
      rerank: 'RERANK',
      moderations: 'MODERATIONS',
      ocr: 'OCR',
      search: 'WEB_SEARCH'
    }

    const capabilities: string[] = []
    for (const [endpoint, supported] of Object.entries(endpoints)) {
      if (supported && endpointCapabilityMap[endpoint]) {
        capabilities.push(endpointCapabilityMap[endpoint])
      }
    }

    return capabilities
  }

  /**
   * Generate provider configurations
   */
  private generateProviderConfigs(): ProviderConfig[] {
    const providers: ProviderConfig[] = []

    for (const [providerId, providerData] of Object.entries(this.providerEndpointsData.providers)) {
      const supported_endpoints = this.privateConvertEndpointsToCapabilities(providerData.endpoints)

      const provider: ProviderConfig = {
        id: providerId,
        name: providerData.display_name,
        description: `Provider: ${providerData.display_name}`,
        authentication: 'API_KEY',
        supported_endpoints,
        api_compatibility: {
          supports_array_content: providerData.endpoints.chat_completions || false,
          supports_stream_options: providerData.endpoints.chat_completions || false,
          supports_developer_role: providerId === 'openai',
          supports_service_tier: providerId === 'openai',
          supports_thinking_control: false,
          supports_api_version: providerId === 'openai',
          supports_parallel_tools: providerData.endpoints.chat_completions || false,
          supports_multimodal: providerData.endpoints.chat_completions || false
        },
        special_config: {},
        documentation: providerData.url,
        website: providerData.url,
        deprecated: false,
        maintenance_mode: false,
        config_version: '1.0.0'
      }

      providers.push(provider)
    }

    return providers
  }

  /**
   * Generate base model configurations
   */
  private generateBaseModels(): ModelConfig[] {
    const baseModels = new Map<string, ModelConfig>()

    for (const [modelId, modelData] of Object.entries(this.modelPricesData)) {
      if (modelData.mode !== 'chat') continue // Skip non-chat models for now

      const baseId = this.extractBaseModelId(modelId)
      const isBase = this.isBaseModel(modelId, modelData.litellm_provider)

      if (!isBase) continue // Only process base models

      // Extract capabilities from model data
      const capabilities: string[] = []
      if (modelData.supports_function_calling) capabilities.push('FUNCTION_CALL')
      if (modelData.supports_vision) capabilities.push('IMAGE_RECOGNITION')
      if (modelData.supports_response_schema) capabilities.push('STRUCTURED_OUTPUT')
      if (modelData.supports_pdf_input) capabilities.push('FILE_INPUT')
      if (modelData.supports_tool_choice) capabilities.push('FUNCTION_CALL')

      // Determine modalities
      const input_modalities = ['TEXT']
      const output_modalities = ['TEXT']
      if (modelData.supports_vision) {
        input_modalities.push('VISION')
      }

      // Convert pricing
      let pricing
      if (modelData.input_cost_per_token && modelData.output_cost_per_token) {
        pricing = {
          input: {
            per_million_tokens: Math.round(modelData.input_cost_per_token * 1000000 * 1000) / 1000,
            currency: 'USD'
          },
          output: {
            per_million_tokens: Math.round(modelData.output_cost_per_token * 1000000 * 1000) / 1000,
            currency: 'USD'
          }
        }
      }

      const baseModel: ModelConfig = {
        id: baseId,
        name: baseId,
        owned_by: modelData.litellm_provider,
        capabilities,
        input_modalities,
        output_modalities,
        context_window: modelData.max_input_tokens || 4096,
        max_output_tokens: modelData.max_output_tokens || modelData.max_tokens || 2048,
        max_input_tokens: modelData.max_input_tokens,
        pricing,
        parameters: {
          temperature: { supported: true, min: 0, max: 1, default: 1 },
          max_tokens: true,
          system_message: modelData.supports_system_messages || false,
          top_p: { supported: false }
        },
        endpoint_types: ['CHAT_COMPLETIONS'],
        metadata: {
          source: 'migration',
          original_provider: modelData.litellm_provider,
          supports_caching: !!modelData.supports_prompt_caching
        }
      }

      baseModels.set(baseId, baseModel)
    }

    return Array.from(baseModels.values())
  }

  /**
   * Generate override configurations
   */
  private generateOverrides(): OverrideConfig[] {
    const overrides: OverrideConfig[] = []

    for (const [modelId, modelData] of Object.entries(this.modelPricesData)) {
      if (modelData.mode !== 'chat') continue

      const baseId = this.extractBaseModelId(modelId)
      const isBase = this.isBaseModel(modelId, modelData.litellm_provider)

      if (isBase) continue // Only generate overrides for non-base models

      const override: OverrideConfig = {
        provider_id: modelData.litellm_provider,
        model_id: baseId,
        disabled: false,
        reason: `Provider-specific implementation of ${baseId}`,
        last_updated: new Date().toISOString().split('T')[0],
        updated_by: 'migration-tool',
        priority: 100
      }

      // Add capability differences
      const capabilities = modelData.supports_function_calling ? ['FUNCTION_CALL'] : []
      if (modelData.supports_vision) capabilities.push('IMAGE_RECOGNITION')

      if (capabilities.length > 0) {
        override.capabilities = { add: capabilities }
      }

      // Add limit differences
      const limits: any = {}
      if (modelData.max_input_tokens && modelData.max_input_tokens !== 128000) {
        limits.context_window = modelData.max_input_tokens
      }
      if (modelData.max_output_tokens && modelData.max_output_tokens !== 4096) {
        limits.max_output_tokens = modelData.max_output_tokens
      }

      if (Object.keys(limits).length > 0) {
        override.limits = limits
      }

      // Add pricing differences
      if (modelData.input_cost_per_token && modelData.output_cost_per_token) {
        override.pricing = {
          input: {
            per_million_tokens: Math.round(modelData.input_cost_per_token * 1000000 * 1000) / 1000,
            currency: 'USD'
          },
          output: {
            per_million_tokens: Math.round(modelData.output_cost_per_token * 1000000 * 1000) / 1000,
            currency: 'USD'
          }
        }
      }

      overrides.push(override)
    }

    return overrides
  }

  /**
   * Execute the full migration
   */
  async migrate(): Promise<void> {
    console.log('🚀 Starting Phase 2 Migration...')

    await this.loadData()

    // Create output directory
    await fs.mkdir(this.outputDir, { recursive: true })

    // Generate configurations
    console.log('📦 Generating provider configurations...')
    const providers = this.generateProviderConfigs()

    console.log('📦 Generating base model configurations...')
    const models = this.generateBaseModels()

    console.log('📦 Generating override configurations...')
    const overrides = this.generateOverrides()

    // Write single file for all providers
    console.log('💾 Writing providers.json...')
    await this.writeJsonFile('providers.json', {
      version: '2025.11.24',
      providers
    })

    // Write single file for all models
    console.log('💾 Writing models.json...')
    await this.writeJsonFile('models.json', {
      version: '2025.11.24',
      models
    })

    // Write single file for all overrides
    console.log('💾 Writing overrides.json...')
    await this.writeJsonFile('overrides.json', {
      version: '2025.11.24',
      overrides
    })

    // Generate migration report
    const providersByType = {
      direct: providers.filter((p) => ['anthropic', 'openai', 'google'].includes(p.id)).length,
      cloud: providers.filter((p) => ['azure', 'bedrock', 'vertex_ai'].some((c) => p.id.includes(c))).length,
      proxy: providers.filter((p) => ['openrouter', 'litellm_proxy', 'together_ai'].some((c) => p.id.includes(c)))
        .length,
      self_hosted: providers.filter((p) => ['ollama', 'lm_studio', 'vllm'].some((c) => p.id.includes(c))).length
    }

    const modelsByProvider = models.reduce(
      (acc, model) => {
        const provider = model.owned_by || 'unknown'
        acc[provider] = (acc[provider] || 0) + 1
        return acc
      },
      {} as Record<string, number>
    )

    const overridesByProvider = overrides.reduce(
      (acc, override) => {
        acc[override.provider_id] = (acc[override.provider_id] || 0) + 1
        return acc
      },
      {} as Record<string, number>
    )

    const report = {
      timestamp: new Date().toISOString(),
      summary: {
        total_providers: providers.length,
        total_base_models: models.length,
        total_overrides: overrides.length,
        provider_categories: providersByType,
        models_by_provider: modelsByProvider,
        overrides_by_provider: overridesByProvider
      },
      files: {
        providers: 'providers.json',
        models: 'models.json',
        overrides: 'overrides.json'
      }
    }

    await this.writeJsonFile('migration-report.json', report)

    console.log('\n✅ Migration completed successfully!')
    console.log(`📊 Migration Summary:`)
    console.log(
      `   Providers: ${providers.length} (${providersByType.direct} direct, ${providersByType.cloud} cloud, ${providersByType.proxy} proxy, ${providersByType.self_hosted} self-hosted)`
    )
    console.log(`   Base Models: ${models.length}`)
    console.log(`   Overrides: ${overrides.length}`)
    console.log(`\n📁 Output Files:`)
    console.log(`   ${this.outputDir}/providers.json`)
    console.log(`   ${this.outputDir}/models.json`)
    console.log(`   ${this.outputDir}/overrides.json`)
    console.log(`   ${this.outputDir}/migration-report.json`)
  }

  private async writeJsonFile(filename: string, data: any): Promise<void> {
    const filePath = path.join(this.outputDir, filename)
    await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8')
  }
}

// CLI execution
if (require.main === module) {
  const tool = new MigrationTool(
    './provider_endpoints_support.json',
    './model_prices_and_context_window.json',
    './migrated-data'
  )

  tool.migrate().catch(console.error)
}
