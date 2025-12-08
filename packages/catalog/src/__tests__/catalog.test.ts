import * as path from 'path'
import { describe, expect, it } from 'vitest'

import { ConfigLoader } from '../loader/ConfigLoader'
import { SchemaValidator } from '../validator/SchemaValidator'

// Use fixtures directory for test data
const fixturesPath = path.join(__dirname, 'fixtures')

describe('Config & Schema', () => {
  describe('ConfigLoader', () => {
    it('should load models with complete validation', async () => {
      const loader = new ConfigLoader({
        basePath: fixturesPath,
        validateOnLoad: true,
        cacheEnabled: false
      })

      const models = await loader.loadModels('test-models.json')
      expect(models).toBeDefined()
      expect(Array.isArray(models)).toBe(true)
      expect(models).toHaveLength(1)

      const model = models[0]
      expect(model).toStrictEqual({
        id: 'test-model',
        name: 'Test Model',
        owned_by: 'TestProvider',
        description: 'A test model for unit testing',
        capabilities: ['FUNCTION_CALL', 'REASONING'],
        input_modalities: ['TEXT'],
        output_modalities: ['TEXT'],
        context_window: 128000,
        max_output_tokens: 4096,
        max_input_tokens: 124000,
        pricing: {
          input: { per_million_tokens: 1, currency: 'USD' },
          output: { per_million_tokens: 2, currency: 'USD' }
        },
        parameters: {
          temperature: { supported: true, min: 0, max: 2, default: 1 },
          maxTokens: true,
          systemMessage: true,
          topP: { supported: true, min: 0, max: 1, default: 1 }
        },
        metadata: {
          tags: ['test', 'fast', 'reliable'],
          category: 'language-model',
          source: 'test',
          license: 'mit',
          documentation: 'https://docs.test.com/models/test-model',
          family: 'test-family',
          architecture: 'transformer',
          trainingData: 'synthetic'
        }
      })
    })

    it('should load providers with complete validation', async () => {
      const loader = new ConfigLoader({
        basePath: fixturesPath,
        validateOnLoad: true,
        cacheEnabled: false
      })

      const providers = await loader.loadProviders('test-providers.json')
      expect(providers).toBeDefined()
      expect(Array.isArray(providers)).toBe(true)
      expect(providers).toHaveLength(1)

      const provider = providers[0]
      expect(provider).toStrictEqual({
        id: 'test-provider',
        name: 'Test Provider',
        description: 'A test provider for unit testing',
        authentication: 'API_KEY',
        pricing_model: 'PER_MODEL',
        model_routing: 'DIRECT',
        behaviors: {
          supports_custom_models: false,
          provides_model_mapping: false,
          supports_model_versioning: false,
          provides_fallback_routing: false,
          has_auto_retry: false,
          supports_health_check: false,
          has_real_time_metrics: false,
          provides_usage_analytics: false,
          supports_webhook_events: false,
          requires_api_key_validation: true,
          supports_rate_limiting: false,
          provides_usage_limits: false,
          supports_streaming: true,
          supports_batch_processing: false,
          supports_model_fine_tuning: false
        },
        supported_endpoints: ['CHAT_COMPLETIONS'],
        api_compatibility: {
          supports_array_content: true,
          supports_stream_options: false,
          supports_developer_role: false,
          supports_thinking_control: false,
          supports_api_version: false,
          supports_parallel_tools: false,
          supports_multimodal: false,
          supports_service_tier: false
        },
        special_config: {},
        documentation: 'https://docs.test.com',
        website: 'https://test.com',
        deprecated: false,
        maintenance_mode: false,
        config_version: '1.0.0',
        metadata: {
          tags: ['test'],
          category: 'ai-provider',
          source: 'test',
          reliability: 'high',
          supportedLanguages: ['en']
        }
      })
    })

    it('should load overrides with complete validation', async () => {
      const loader = new ConfigLoader({
        basePath: fixturesPath,
        validateOnLoad: true,
        cacheEnabled: false
      })

      const overrides = await loader.loadOverrides('test-overrides.json')
      expect(overrides).toBeDefined()
      expect(Array.isArray(overrides)).toBe(true)
      expect(overrides).toHaveLength(1)

      const override = overrides[0]
      expect(override).toMatchObject({
        provider_id: 'test-provider',
        model_id: 'test-model',
        disabled: false,
        reason: 'Test override for enhanced capabilities and limits',
        priority: 100
      })

      expect(override.capabilities?.add).toContain('FUNCTION_CALL')
      expect(override.capabilities?.remove).toContain('REASONING')
      expect(override.limits?.context_window).toBe(256000)
      expect(override.limits?.max_output_tokens).toBe(8192)
    })

    it('should load all configs simultaneously', async () => {
      const loader = new ConfigLoader({
        basePath: fixturesPath,
        validateOnLoad: true,
        cacheEnabled: false
      })

      const configs = await loader.loadAllConfigs({
        modelsFile: 'test-models.json',
        providersFile: 'test-providers.json',
        overridesFile: 'test-overrides.json'
      })

      expect(configs).toHaveProperty('models')
      expect(configs).toHaveProperty('providers')
      expect(configs).toHaveProperty('overrides')
      expect(configs.models).toHaveLength(1)
      expect(configs.providers).toHaveLength(1)
      expect(configs.overrides).toHaveLength(1)
    })

    it('should handle missing files gracefully', async () => {
      const loader = new ConfigLoader({
        basePath: '/nonexistent/path'
      })

      await expect(loader.loadModels('nonexistent.json')).rejects.toThrow('Failed to load models')
    })
  })

  describe('SchemaValidator', () => {
    it('should validate valid model configuration', async () => {
      const validator = new SchemaValidator()

      const validModel = {
        id: 'test-model',
        capabilities: ['FUNCTION_CALL', 'REASONING'],
        input_modalities: ['TEXT'],
        output_modalities: ['TEXT'],
        context_window: 128000,
        max_output_tokens: 4096,
        metadata: {
          tags: ['test'],
          category: 'language-model',
          source: 'test'
        }
      }

      const result = await validator.validateModel(validModel)
      expect(result.success).toBe(true)
      expect(result.data).toBeDefined()
      expect(result.data!.id).toBe('test-model')
    })

    it('should reject invalid model configuration', async () => {
      const validator = new SchemaValidator()

      const invalidModel = {
        id: 123, // Should be string
        capabilities: 'not-array', // Should be array
        contextWindow: -1000 // Should be positive
      }

      const result = await validator.validateModel(invalidModel)
      expect(result.success).toBe(false)
      expect(result.errors).toBeDefined()
      expect(result.errors!.length).toBeGreaterThan(0)
    })

    it('should provide warnings for model configuration issues', async () => {
      const validator = new SchemaValidator()

      const modelWithIssues = {
        id: 'test-model',
        capabilities: ['FUNCTION_CALL'], // At least one required now
        input_modalities: ['TEXT'],
        output_modalities: ['TEXT'],
        context_window: 200000, // Large context window
        max_output_tokens: 4096,
        // Missing pricing and description
        metadata: {
          tags: ['test'],
          category: 'language-model',
          source: 'test'
        }
      }

      const result = await validator.validateModel(modelWithIssues)
      expect(result.success).toBe(true)
      expect(result.warnings).toBeDefined()
      expect(result.warnings!.length).toBeGreaterThan(0)
    })

    it('should accept custom validation warnings', async () => {
      const validator = new SchemaValidator()

      const model = {
        id: 'test-model',
        capabilities: ['FUNCTION_CALL'],
        input_modalities: ['TEXT'],
        output_modalities: ['TEXT'],
        context_window: 1000,
        max_output_tokens: 500,
        metadata: {
          tags: ['test'],
          category: 'language-model',
          source: 'test'
        }
      }

      const result = await validator.validateModel(model, {
        includeWarnings: true,
        customValidation: () => ['Custom warning message']
      })

      expect(result.success).toBe(true)
      expect(result.warnings).toContain('Custom warning message')
    })
  })

  describe('Integration Tests', () => {
    it('should load and validate models end-to-end', async () => {
      const loader = new ConfigLoader({
        basePath: fixturesPath,
        validateOnLoad: true,
        cacheEnabled: false
      })

      const validator = new SchemaValidator()

      // Load models
      const models = await loader.loadModels('test-models.json')
      expect(models.length).toBeGreaterThan(0)

      // Validate first model
      const validationResult = await validator.validateModel(models[0])
      expect(validationResult.success).toBe(true)
      expect(validationResult.data).toBeDefined()
      expect(validationResult.data!.id).toBe(models[0].id)
    })

    it('should work with caching enabled', async () => {
      const loader = new ConfigLoader({
        basePath: fixturesPath,
        validateOnLoad: true,
        cacheEnabled: true
      })

      // Test that caching doesn't break basic functionality
      const models1 = await loader.loadModels('test-models.json')
      expect(models1.length).toBeGreaterThan(0)
      expect(models1[0]).toHaveProperty('id', 'test-model')

      // Test cache clear functionality
      loader.clearCache()
      expect(true).toBe(true) // Cache clear should not throw
    })
  })

  describe('Snapshot Tests', () => {
    it('should snapshot model configurations', async () => {
      const loader = new ConfigLoader({
        basePath: fixturesPath,
        validateOnLoad: true,
        cacheEnabled: false
      })

      const models = await loader.loadModels('test-models.json')
      expect(models).toMatchSnapshot()
    })

    it('should snapshot provider configurations', async () => {
      const loader = new ConfigLoader({
        basePath: fixturesPath,
        validateOnLoad: true,
        cacheEnabled: false
      })

      const providers = await loader.loadProviders('test-providers.json')
      expect(providers).toMatchSnapshot()
    })

    it('should snapshot override configurations', async () => {
      const loader = new ConfigLoader({
        basePath: fixturesPath,
        validateOnLoad: true,
        cacheEnabled: false
      })

      const overrides = await loader.loadOverrides('test-overrides.json')
      expect(overrides).toMatchSnapshot()
    })

    it('should snapshot complete configuration structure', async () => {
      const loader = new ConfigLoader({
        basePath: fixturesPath,
        validateOnLoad: true,
        cacheEnabled: false
      })

      const configs = await loader.loadAllConfigs({
        modelsFile: 'test-models.json',
        providersFile: 'test-providers.json',
        overridesFile: 'test-overrides.json'
      })

      expect(configs).toMatchSnapshot({
        models: expect.any(Array),
        providers: expect.any(Array),
        overrides: expect.any(Array)
      })
    })

    it('should snapshot validation results', async () => {
      const loader = new ConfigLoader({
        basePath: fixturesPath,
        validateOnLoad: true,
        cacheEnabled: false
      })
      const validator = new SchemaValidator()

      const model = await loader.loadModels('test-models.json')
      const validationResult = await validator.validateModel(model[0], {
        includeWarnings: true,
        customValidation: () => ['Custom validation warning for snapshot']
      })

      expect(validationResult).toMatchSnapshot()
    })
  })
})
