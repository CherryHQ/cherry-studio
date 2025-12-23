/**
 * Tests for override generation logic
 * Tests generateOverride(), validateOverrideEnhanced()
 */

import { describe, expect, it } from 'vitest'

import type { ModelConfig, ProviderModelOverride } from '../schemas'
import { generateOverride, validateOverrideEnhanced } from '../utils/override-utils'

describe('generateOverride', () => {
  const baseModel: ModelConfig = {
    id: 'gpt-4',
    name: 'GPT-4',
    provider: 'openai',
    endpoint_type: 'CHAT_COMPLETIONS',
    capabilities: ['FUNCTION_CALL', 'REASONING'],
    context_window: 8192,
    max_output_tokens: 4096,
    pricing: {
      currency: 'USD',
      input: { per_million_tokens: 30 },
      output: { per_million_tokens: 60 }
    }
  }

  it('should return null when models are identical', () => {
    const providerModel = { ...baseModel }
    const result = generateOverride(baseModel, providerModel, 'openrouter')
    expect(result).toBeNull()
  })

  it('should generate override for pricing difference', () => {
    const providerModel: ModelConfig = {
      ...baseModel,
      pricing: {
        currency: 'USD',
        input: { per_million_tokens: 25 },
        output: { per_million_tokens: 50 }
      }
    }

    const result = generateOverride(baseModel, providerModel, 'openrouter')

    expect(result).toBeDefined()
    expect(result?.provider_id).toBe('openrouter')
    expect(result?.model_id).toBe('gpt-4')
    expect(result?.pricing).toEqual(providerModel.pricing)
    expect(result?.capabilities).toBeUndefined()
    expect(result?.limits).toBeUndefined()
  })

  it('should generate override for capability additions', () => {
    const providerModel: ModelConfig = {
      ...baseModel,
      capabilities: ['FUNCTION_CALL', 'REASONING', 'IMAGE_RECOGNITION']
    }

    const result = generateOverride(baseModel, providerModel, 'openrouter')

    expect(result).toBeDefined()
    expect(result?.capabilities).toEqual({
      add: ['IMAGE_RECOGNITION']
    })
  })

  it('should generate override for capability removals', () => {
    const providerModel: ModelConfig = {
      ...baseModel,
      capabilities: ['FUNCTION_CALL']
    }

    const result = generateOverride(baseModel, providerModel, 'openrouter')

    expect(result).toBeDefined()
    expect(result?.capabilities).toEqual({
      remove: ['REASONING']
    })
  })

  it('should generate override for capability add and remove', () => {
    const providerModel: ModelConfig = {
      ...baseModel,
      capabilities: ['FUNCTION_CALL', 'IMAGE_RECOGNITION']
    }

    const result = generateOverride(baseModel, providerModel, 'openrouter')

    expect(result).toBeDefined()
    expect(result?.capabilities).toEqual({
      add: ['IMAGE_RECOGNITION'],
      remove: ['REASONING']
    })
  })

  it('should generate override for context_window change', () => {
    const providerModel: ModelConfig = {
      ...baseModel,
      context_window: 128000
    }

    const result = generateOverride(baseModel, providerModel, 'openrouter')

    expect(result).toBeDefined()
    expect(result?.limits).toEqual({
      context_window: 128000
    })
  })

  it('should generate override for max_output_tokens change', () => {
    const providerModel: ModelConfig = {
      ...baseModel,
      max_output_tokens: 16384
    }

    const result = generateOverride(baseModel, providerModel, 'openrouter')

    expect(result).toBeDefined()
    expect(result?.limits).toEqual({
      max_output_tokens: 16384
    })
  })

  it('should generate override for multiple limit changes', () => {
    const providerModel: ModelConfig = {
      ...baseModel,
      context_window: 128000,
      max_output_tokens: 16384,
      max_input_tokens: 120000
    }

    const result = generateOverride(baseModel, providerModel, 'openrouter')

    expect(result).toBeDefined()
    expect(result?.limits).toEqual({
      context_window: 128000,
      max_output_tokens: 16384,
      max_input_tokens: 120000
    })
  })

  it('should generate override for reasoning configuration', () => {
    const providerModel: ModelConfig = {
      ...baseModel,
      reasoning: {
        type: 'anthropic',
        params: {
          type: 'enabled',
          budgetTokens: 10000
        }
      }
    }

    const result = generateOverride(baseModel, providerModel, 'openrouter')

    expect(result).toBeDefined()
    expect(result?.reasoning).toEqual(providerModel.reasoning)
  })

  it('should generate override for parameter support changes', () => {
    const baseModelWithParams: ModelConfig = {
      ...baseModel,
      parameters: {
        temperature: { min: 0, max: 2, default: 1 }
      }
    }

    const providerModel: ModelConfig = {
      ...baseModelWithParams,
      parameters: {
        temperature: { min: 0, max: 1, default: 0.7 },
        top_p: { min: 0, max: 1, default: 0.9 }
      }
    }

    const result = generateOverride(baseModelWithParams, providerModel, 'openrouter')

    expect(result).toBeDefined()
    expect(result?.parameters).toEqual({
      temperature: { min: 0, max: 1, default: 0.7 },
      top_p: { min: 0, max: 1, default: 0.9 }
    })
  })

  it('should generate override with multiple differences', () => {
    const providerModel: ModelConfig = {
      ...baseModel,
      capabilities: ['FUNCTION_CALL', 'REASONING', 'IMAGE_RECOGNITION'],
      context_window: 128000,
      pricing: {
        currency: 'USD',
        input: { per_million_tokens: 25 },
        output: { per_million_tokens: 50 }
      }
    }

    const result = generateOverride(baseModel, providerModel, 'openrouter')

    expect(result).toBeDefined()
    expect(result?.capabilities).toEqual({ add: ['IMAGE_RECOGNITION'] })
    expect(result?.limits).toEqual({ context_window: 128000 })
    expect(result?.pricing).toEqual(providerModel.pricing)
  })

  it('should set custom priority if provided', () => {
    const providerModel: ModelConfig = {
      ...baseModel,
      context_window: 128000
    }

    const result = generateOverride(baseModel, providerModel, 'openrouter', { priority: 50 })

    expect(result).toBeDefined()
    expect(result?.priority).toBe(50)
  })

  it('should default priority to 0', () => {
    const providerModel: ModelConfig = {
      ...baseModel,
      context_window: 128000
    }

    const result = generateOverride(baseModel, providerModel, 'openrouter')

    expect(result).toBeDefined()
    expect(result?.priority).toBe(0)
  })

  it('should handle models with no capabilities', () => {
    const baseModelNoCapabilities: ModelConfig = {
      ...baseModel,
      capabilities: undefined
    }
    const providerModel: ModelConfig = {
      ...baseModelNoCapabilities,
      capabilities: ['FUNCTION_CALL']
    }

    const result = generateOverride(baseModelNoCapabilities, providerModel, 'openrouter')

    expect(result).toBeDefined()
    expect(result?.capabilities).toEqual({ add: ['FUNCTION_CALL'] })
  })

  it('should handle provider model with no capabilities', () => {
    const providerModel: ModelConfig = {
      ...baseModel,
      capabilities: undefined
    }

    const result = generateOverride(baseModel, providerModel, 'openrouter')

    expect(result).toBeDefined()
    expect(result?.capabilities).toEqual({
      remove: ['FUNCTION_CALL', 'REASONING']
    })
  })
})

describe('validateOverrideEnhanced', () => {
  const baseModel: ModelConfig = {
    id: 'gpt-4',
    name: 'GPT-4',
    provider: 'openai',
    endpoint_type: 'CHAT_COMPLETIONS',
    capabilities: ['FUNCTION_CALL', 'REASONING'],
    context_window: 8192,
    max_output_tokens: 4096,
    pricing: {
      currency: 'USD',
      input: { per_million_tokens: 30 },
      output: { per_million_tokens: 60 }
    }
  }

  it('should pass validation for valid override', () => {
    const override: ProviderModelOverride = {
      provider_id: 'openrouter',
      model_id: 'gpt-4',
      limits: { context_window: 128000 },
      priority: 0
    }

    const result = validateOverrideEnhanced(override, baseModel)

    expect(result.valid).toBe(true)
    expect(result.errors).toHaveLength(0)
  })

  it('should error on incomplete pricing', () => {
    const override: ProviderModelOverride = {
      provider_id: 'openrouter',
      model_id: 'gpt-4',
      pricing: {
        currency: 'USD',
        input: { per_million_tokens: 30 }
        // Missing output
      } as any,
      priority: 0
    }

    const result = validateOverrideEnhanced(override)

    expect(result.valid).toBe(false)
    expect(result.errors).toContain('Pricing must include both input and output')
  })

  it('should error on negative pricing', () => {
    const override: ProviderModelOverride = {
      provider_id: 'openrouter',
      model_id: 'gpt-4',
      pricing: {
        currency: 'USD',
        input: { per_million_tokens: -10 },
        output: { per_million_tokens: 20 }
      },
      priority: 0
    }

    const result = validateOverrideEnhanced(override)

    expect(result.valid).toBe(false)
    expect(result.errors).toContain('Input pricing cannot be negative')
  })

  it('should error on capability conflict', () => {
    const override: ProviderModelOverride = {
      provider_id: 'openrouter',
      model_id: 'gpt-4',
      capabilities: {
        add: ['FUNCTION_CALL', 'IMAGE_RECOGNITION'],
        remove: ['FUNCTION_CALL'] // Conflict: in both add and remove
      },
      priority: 0
    }

    const result = validateOverrideEnhanced(override, baseModel)

    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.includes('Capability conflict'))).toBe(true)
  })

  it('should error on non-positive context_window', () => {
    const override: ProviderModelOverride = {
      provider_id: 'openrouter',
      model_id: 'gpt-4',
      limits: { context_window: 0 },
      priority: 0
    }

    const result = validateOverrideEnhanced(override)

    expect(result.valid).toBe(false)
    expect(result.errors).toContain('context_window must be positive')
  })

  it('should error on non-positive max_output_tokens', () => {
    const override: ProviderModelOverride = {
      provider_id: 'openrouter',
      model_id: 'gpt-4',
      limits: { max_output_tokens: -100 },
      priority: 0
    }

    const result = validateOverrideEnhanced(override)

    expect(result.valid).toBe(false)
    expect(result.errors).toContain('max_output_tokens must be positive')
  })

  it('should warn when max_output_tokens exceeds context_window', () => {
    const override: ProviderModelOverride = {
      provider_id: 'openrouter',
      model_id: 'gpt-4',
      limits: {
        context_window: 8192,
        max_output_tokens: 10000
      },
      priority: 0
    }

    const result = validateOverrideEnhanced(override)

    expect(result.valid).toBe(true)
    expect(result.warnings).toContain('max_output_tokens exceeds context_window')
  })

  it('should warn when disabled without reason', () => {
    const override: ProviderModelOverride = {
      provider_id: 'openrouter',
      model_id: 'gpt-4',
      disabled: true,
      priority: 0
    }

    const result = validateOverrideEnhanced(override, baseModel)

    expect(result.valid).toBe(true)
    expect(result.warnings).toContain('Disabled override should include a reason')
  })

  it('should pass when disabled with reason', () => {
    const override: ProviderModelOverride = {
      provider_id: 'openrouter',
      model_id: 'gpt-4',
      disabled: true,
      reason: 'Deprecated model',
      priority: 0
    }

    const result = validateOverrideEnhanced(override, baseModel)

    expect(result.valid).toBe(true)
    expect(result.warnings).not.toContain('Disabled override should include a reason')
  })

  it('should warn when reducing context_window', () => {
    const override: ProviderModelOverride = {
      provider_id: 'openrouter',
      model_id: 'gpt-4',
      limits: { context_window: 4096 },
      priority: 0
    }

    const result = validateOverrideEnhanced(override, baseModel)

    expect(result.valid).toBe(true)
    expect(result.warnings.some((w) => w.includes('Context window reduced'))).toBe(true)
  })
})
