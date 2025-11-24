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
  ownedBy?: string
  description?: string
  capabilities: string[]
  inputModalities: string[]
  outputModalities: string[]
  contextWindow: number
  maxOutputTokens: number
  maxInputTokens?: number
  pricing?: {
    input: { perMillionTokens: number; currency: string }
    output: { perMillionTokens: number; currency: string }
  }
  parameters?: Record<string, any>
  endpointTypes?: string[]
  metadata?: Record<string, any>
}

interface ProviderConfig {
  id: string
  name: string
  description?: string
  authentication: string
  pricingModel: string
  modelRouting: string
  behaviors: Record<string, boolean>
  supportedEndpoints: string[]
  apiCompatibility?: Record<string, boolean>
  specialConfig?: Record<string, any>
  documentation?: string
  website?: string
  deprecated: boolean
  maintenanceMode: boolean
  configVersion: string
  metadata?: Record<string, any>
}

interface OverrideConfig {
  providerId: string
  modelId: string
  capabilities?: {
    add?: string[]
    remove?: string[]
    force?: string[]
  }
  limits?: {
    contextWindow?: number
    maxOutputTokens?: number
    maxInputTokens?: number
  }
  pricing?: {
    input: { perMillionTokens: number; currency: string }
    output: { perMillionTokens: number; currency: string }
  }
  disabled?: boolean
  reason?: string
  lastUpdated?: string
  updatedBy?: string
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
      const supportedEndpoints = this.privateConvertEndpointsToCapabilities(providerData.endpoints)

      // Determine provider characteristics
      const isDirectProvider = ['anthropic', 'openai', 'google'].includes(providerId)
      const isCloudProvider = ['azure', 'aws', 'gcp'].some((cloud) => providerId.includes(cloud))
      const isProxyProvider = ['openrouter', 'litellm', 'together_ai'].includes(providerId)

      let pricingModel = 'PER_MODEL'
      let modelRouting = 'DIRECT'

      if (isProxyProvider) {
        pricingModel = 'UNIFIED'
        modelRouting = 'INTELLIGENT'
      } else if (isCloudProvider) {
        pricingModel = 'PER_MODEL'
        modelRouting = 'DIRECT'
      }

      const provider: ProviderConfig = {
        id: providerId,
        name: providerData.display_name,
        description: `Provider: ${providerData.display_name}`,
        authentication: 'API_KEY',
        pricingModel,
        modelRouting,
        behaviors: {
          supportsCustomModels: providerData.endpoints.batches || false,
          providesModelMapping: isProxyProvider,
          supportsModelVersioning: true,
          providesFallbackRouting: isProxyProvider,
          hasAutoRetry: isProxyProvider,
          supportsHealthCheck: isDirectProvider,
          hasRealTimeMetrics: isDirectProvider || isProxyProvider,
          providesUsageAnalytics: isDirectProvider,
          supportsWebhookEvents: false,
          requiresApiKeyValidation: true,
          supportsRateLimiting: isDirectProvider,
          providesUsageLimits: isDirectProvider,
          supportsStreaming: providerData.endpoints.chat_completions || providerData.endpoints.messages,
          supportsBatchProcessing: providerData.endpoints.batches || false,
          supportsModelFineTuning: providerId === 'openai'
        },
        supportedEndpoints,
        apiCompatibility: {
          supportsArrayContent: providerData.endpoints.chat_completions || false,
          supportsStreamOptions: providerData.endpoints.chat_completions || false,
          supportsDeveloperRole: providerId === 'openai',
          supportsServiceTier: providerId === 'openai',
          supportsThinkingControl: false,
          supportsApiVersion: providerId === 'openai',
          supportsParallelTools: providerData.endpoints.chat_completions || false,
          supportsMultimodal: providerData.endpoints.chat_completions || false
        },
        specialConfig: {},
        documentation: providerData.url,
        website: providerData.url,
        deprecated: false,
        maintenanceMode: false,
        configVersion: '1.0.0',
        metadata: {
          source: 'litellm-endpoints',
          tags: [isDirectProvider ? 'official' : isProxyProvider ? 'proxy' : 'cloud'],
          reliability: isDirectProvider ? 'high' : 'medium'
        }
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
      const inputModalities = ['TEXT']
      const outputModalities = ['TEXT']
      if (modelData.supports_vision) {
        inputModalities.push('VISION')
      }

      // Convert pricing
      let pricing
      if (modelData.input_cost_per_token && modelData.output_cost_per_token) {
        pricing = {
          input: {
            perMillionTokens: Math.round(modelData.input_cost_per_token * 1000000 * 1000) / 1000,
            currency: 'USD'
          },
          output: {
            perMillionTokens: Math.round(modelData.output_cost_per_token * 1000000 * 1000) / 1000,
            currency: 'USD'
          }
        }
      }

      const baseModel: ModelConfig = {
        id: baseId,
        name: baseId,
        ownedBy: modelData.litellm_provider,
        capabilities,
        inputModalities,
        outputModalities,
        contextWindow: modelData.max_input_tokens || 4096,
        maxOutputTokens: modelData.max_output_tokens || modelData.max_tokens || 2048,
        maxInputTokens: modelData.max_input_tokens,
        pricing,
        parameters: {
          temperature: { supported: true, min: 0, max: 1, default: 1 },
          maxTokens: true,
          systemMessage: modelData.supports_system_messages || false,
          topP: { supported: false }
        },
        endpointTypes: ['CHAT_COMPLETIONS'],
        metadata: {
          source: 'migration',
          originalProvider: modelData.litellm_provider,
          supportsCaching: !!modelData.supports_prompt_caching
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
        providerId: modelData.litellm_provider,
        modelId: baseId,
        disabled: false,
        reason: `Provider-specific implementation of ${baseId}`,
        lastUpdated: new Date().toISOString().split('T')[0],
        updatedBy: 'migration-tool',
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
        limits.contextWindow = modelData.max_input_tokens
      }
      if (modelData.max_output_tokens && modelData.max_output_tokens !== 4096) {
        limits.maxOutputTokens = modelData.max_output_tokens
      }

      if (Object.keys(limits).length > 0) {
        override.limits = limits
      }

      // Add pricing differences
      if (modelData.input_cost_per_token && modelData.output_cost_per_token) {
        override.pricing = {
          input: {
            perMillionTokens: Math.round(modelData.input_cost_per_token * 1000000 * 1000) / 1000,
            currency: 'USD'
          },
          output: {
            perMillionTokens: Math.round(modelData.output_cost_per_token * 1000000 * 1000) / 1000,
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

    // Create output directories
    await fs.mkdir(path.join(this.outputDir, 'models'), { recursive: true })
    await fs.mkdir(path.join(this.outputDir, 'providers'), { recursive: true })
    await fs.mkdir(path.join(this.outputDir, 'overrides'), { recursive: true })

    // Generate configurations
    console.log('📦 Generating provider configurations...')
    const providers = this.generateProviderConfigs()

    console.log('📦 Generating base model configurations...')
    const models = this.generateBaseModels()

    console.log('📦 Generating override configurations...')
    const overrides = this.generateOverrides()

    // Group providers by category
    const directProviders = providers.filter((p) => ['anthropic', 'openai', 'google'].includes(p.id))
    const cloudProviders = providers.filter((p) => ['azure', 'bedrock', 'vertex_ai'].some((c) => p.id.includes(c)))
    const proxyProviders = providers.filter((p) =>
      ['openrouter', 'litellm_proxy', 'together_ai'].some((c) => p.id.includes(c))
    )
    const selfHostedProviders = providers.filter((p) => ['ollama', 'lm_studio', 'vllm'].some((c) => p.id.includes(c)))

    // Write provider files
    await this.writeJsonFile('providers/direct-providers.json', {
      version: '2025.11.24',
      providers: directProviders
    })

    await this.writeJsonFile('providers/cloud-platforms.json', {
      version: '2025.11.24',
      providers: cloudProviders
    })

    await this.writeJsonFile('providers/unified-gateways.json', {
      version: '2025.11.24',
      providers: proxyProviders
    })

    await this.writeJsonFile('providers/self-hosted.json', {
      version: '2025.11.24',
      providers: selfHostedProviders
    })

    // Group models by provider
    const modelsByProvider = new Map<string, ModelConfig[]>()
    models.forEach((model) => {
      const provider = model.ownedBy || 'unknown'
      if (!modelsByProvider.has(provider)) {
        modelsByProvider.set(provider, [])
      }
      modelsByProvider.get(provider)!.push(model)
    })

    // Write model files
    for (const [provider, providerModels] of modelsByProvider.entries()) {
      const filename = provider.includes('/') ? provider.split('/')[1] : provider
      await this.writeJsonFile(`models/${filename}.json`, {
        version: '2025.11.24',
        models: providerModels
      })
    }

    // Group overrides by provider
    const overridesByProvider = new Map<string, OverrideConfig[]>()
    overrides.forEach((override) => {
      if (!overridesByProvider.has(override.providerId)) {
        overridesByProvider.set(override.providerId, [])
      }
      overridesByProvider.get(override.providerId)!.push(override)
    })

    // Write override files
    for (const [provider, providerOverrides] of overridesByProvider.entries()) {
      await this.writeJsonFile(`overrides/${provider}.json`, {
        version: '2025.11.24',
        overrides: providerOverrides
      })
    }

    // Generate migration report
    const report = {
      timestamp: new Date().toISOString(),
      summary: {
        totalProviders: providers.length,
        totalBaseModels: models.length,
        totalOverrides: overrides.length,
        providerCategories: {
          direct: directProviders.length,
          cloud: cloudProviders.length,
          proxy: proxyProviders.length,
          selfHosted: selfHostedProviders.length
        },
        modelsByProvider: Object.fromEntries(Array.from(modelsByProvider.entries()).map(([k, v]) => [k, v.length])),
        overridesByProvider: Object.fromEntries(
          Array.from(overridesByProvider.entries()).map(([k, v]) => [k, v.length])
        )
      }
    }

    await this.writeJsonFile('migration-report.json', report)

    console.log('\n✅ Migration completed successfully!')
    console.log(`📊 Migration Summary:`)
    console.log(`   Providers: ${providers.length}`)
    console.log(`   Base Models: ${models.length}`)
    console.log(`   Overrides: ${overrides.length}`)
    console.log(`   Report: migration-report.json`)
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
