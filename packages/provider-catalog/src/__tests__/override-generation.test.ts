/**
 * Tests for override generation logic
 * Tests generateOverride(), validateOverrideEnhanced()
 */

import { describe, expect, it } from 'vitest'

import type { ModelConfig, ProviderModelOverride } from '../schemas'
import { ModelCapability } from '../schemas/enums'
import { generateOverride, validateOverrideEnhanced } from '../utils/override-utils'

describe('generateOverride', () => {
  const baseModel: ModelConfig = {
    id: 'gpt-4',
    name: 'GPT-4',
    capabilities: [ModelCapability.FUNCTION_CALL, ModelCapability.REASONING],
    contextWindow: 8192,
    maxOutputTokens: 4096,
    pricing: {
      input: { perMillionTokens: 30 },
      output: { perMillionTokens: 60 }
    },
    metadata: {}
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
        input: { perMillionTokens: 25 },
        output: { perMillionTokens: 50 }
      }
    }

    const result = generateOverride(baseModel, providerModel, 'openrouter')

    expect(result).toBeDefined()
    expect(result?.providerId).toBe('openrouter')
    expect(result?.modelId).toBe('gpt-4')
    expect(result?.pricing).toEqual(providerModel.pricing)
    expect(result?.capabilities).toBeUndefined()
    expect(result?.limits).toBeUndefined()
  })

  it('should generate override for capability additions', () => {
    const providerModel: ModelConfig = {
      ...baseModel,
      capabilities: [ModelCapability.FUNCTION_CALL, ModelCapability.REASONING, ModelCapability.IMAGE_RECOGNITION]
    }

    const result = generateOverride(baseModel, providerModel, 'openrouter')

    expect(result).toBeDefined()
    expect(result?.capabilities).toEqual({
      add: [ModelCapability.IMAGE_RECOGNITION]
    })
  })

  it('should generate override for capability removals', () => {
    const providerModel: ModelConfig = {
      ...baseModel,
      capabilities: [ModelCapability.FUNCTION_CALL]
    }

    const result = generateOverride(baseModel, providerModel, 'openrouter')

    expect(result).toBeDefined()
    expect(result?.capabilities).toEqual({
      remove: [ModelCapability.REASONING]
    })
  })

  it('should generate override for capability add and remove', () => {
    const providerModel: ModelConfig = {
      ...baseModel,
      capabilities: [ModelCapability.FUNCTION_CALL, ModelCapability.IMAGE_RECOGNITION]
    }

    const result = generateOverride(baseModel, providerModel, 'openrouter')

    expect(result).toBeDefined()
    expect(result?.capabilities).toEqual({
      add: [ModelCapability.IMAGE_RECOGNITION],
      remove: [ModelCapability.REASONING]
    })
  })

  it('should generate override for contextWindow change', () => {
    const providerModel: ModelConfig = {
      ...baseModel,
      contextWindow: 128000
    }

    const result = generateOverride(baseModel, providerModel, 'openrouter')

    expect(result).toBeDefined()
    expect(result?.limits).toEqual({
      contextWindow: 128000
    })
  })

  it('should generate override for maxOutputTokens change', () => {
    const providerModel: ModelConfig = {
      ...baseModel,
      maxOutputTokens: 16384
    }

    const result = generateOverride(baseModel, providerModel, 'openrouter')

    expect(result).toBeDefined()
    expect(result?.limits).toEqual({
      maxOutputTokens: 16384
    })
  })

  it('should generate override for multiple limit changes', () => {
    const providerModel: ModelConfig = {
      ...baseModel,
      contextWindow: 128000,
      maxOutputTokens: 16384,
      maxInputTokens: 120000
    }

    const result = generateOverride(baseModel, providerModel, 'openrouter')

    expect(result).toBeDefined()
    expect(result?.limits).toEqual({
      contextWindow: 128000,
      maxOutputTokens: 16384,
      maxInputTokens: 120000
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
        temperature: { supported: true, min: 0, max: 2 }
      }
    }

    const providerModel: ModelConfig = {
      ...baseModelWithParams,
      parameters: {
        temperature: { supported: true, min: 0, max: 1 },
        topP: { supported: true, min: 0, max: 1 }
      }
    }

    const result = generateOverride(baseModelWithParams, providerModel, 'openrouter')

    expect(result).toBeDefined()
    expect(result?.parameters).toEqual({
      temperature: { supported: true, min: 0, max: 1 },
      topP: { supported: true, min: 0, max: 1 }
    })
  })

  it('should generate override with multiple differences', () => {
    const providerModel: ModelConfig = {
      ...baseModel,
      capabilities: [ModelCapability.FUNCTION_CALL, ModelCapability.REASONING, ModelCapability.IMAGE_RECOGNITION],
      contextWindow: 128000,
      pricing: {
        input: { perMillionTokens: 25 },
        output: { perMillionTokens: 50 }
      }
    }

    const result = generateOverride(baseModel, providerModel, 'openrouter')

    expect(result).toBeDefined()
    expect(result?.capabilities).toEqual({ add: [ModelCapability.IMAGE_RECOGNITION] })
    expect(result?.limits).toEqual({ contextWindow: 128000 })
    expect(result?.pricing).toEqual(providerModel.pricing)
  })

  it('should set custom priority if provided', () => {
    const providerModel: ModelConfig = {
      ...baseModel,
      contextWindow: 128000
    }

    const result = generateOverride(baseModel, providerModel, 'openrouter', { priority: 50 })

    expect(result).toBeDefined()
    expect(result?.priority).toBe(50)
  })

  it('should default priority to 0', () => {
    const providerModel: ModelConfig = {
      ...baseModel,
      contextWindow: 128000
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
      capabilities: [ModelCapability.FUNCTION_CALL]
    }

    const result = generateOverride(baseModelNoCapabilities, providerModel, 'openrouter')

    expect(result).toBeDefined()
    expect(result?.capabilities).toEqual({ add: [ModelCapability.FUNCTION_CALL] })
  })

  it('should handle provider model with no capabilities', () => {
    const providerModel: ModelConfig = {
      ...baseModel,
      capabilities: undefined
    }

    const result = generateOverride(baseModel, providerModel, 'openrouter')

    expect(result).toBeDefined()
    expect(result?.capabilities).toEqual({
      remove: [ModelCapability.FUNCTION_CALL, ModelCapability.REASONING]
    })
  })
})

describe('validateOverrideEnhanced', () => {
  const baseModel: ModelConfig = {
    id: 'gpt-4',
    name: 'GPT-4',
    capabilities: [ModelCapability.FUNCTION_CALL, ModelCapability.REASONING],
    contextWindow: 8192,
    maxOutputTokens: 4096,
    pricing: {
      input: { perMillionTokens: 30 },
      output: { perMillionTokens: 60 }
    },
    metadata: {}
  }

  it('should pass validation for valid override', () => {
    const override: ProviderModelOverride = {
      providerId: 'openrouter',
      modelId: 'gpt-4',
      limits: { contextWindow: 128000 },
      priority: 0
    }

    const result = validateOverrideEnhanced(override, baseModel)

    expect(result.valid).toBe(true)
    expect(result.errors).toHaveLength(0)
  })

  it('should error on incomplete pricing', () => {
    const override: ProviderModelOverride = {
      providerId: 'openrouter',
      modelId: 'gpt-4',
      pricing: {
        input: { perMillionTokens: 30 }
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
      providerId: 'openrouter',
      modelId: 'gpt-4',
      pricing: {
        input: { perMillionTokens: -10 },
        output: { perMillionTokens: 20 }
      },
      priority: 0
    }

    const result = validateOverrideEnhanced(override)

    expect(result.valid).toBe(false)
    expect(result.errors).toContain('Input pricing cannot be negative')
  })

  it('should error on capability conflict', () => {
    const override: ProviderModelOverride = {
      providerId: 'openrouter',
      modelId: 'gpt-4',
      capabilities: {
        add: [ModelCapability.FUNCTION_CALL, ModelCapability.IMAGE_RECOGNITION],
        remove: [ModelCapability.FUNCTION_CALL] // Conflict: in both add and remove
      },
      priority: 0
    }

    const result = validateOverrideEnhanced(override, baseModel)

    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.includes('Capability conflict'))).toBe(true)
  })

  it('should error on non-positive contextWindow', () => {
    const override: ProviderModelOverride = {
      providerId: 'openrouter',
      modelId: 'gpt-4',
      limits: { contextWindow: 0 },
      priority: 0
    }

    const result = validateOverrideEnhanced(override)

    expect(result.valid).toBe(false)
    expect(result.errors).toContain('contextWindow must be positive')
  })

  it('should error on non-positive maxOutputTokens', () => {
    const override: ProviderModelOverride = {
      providerId: 'openrouter',
      modelId: 'gpt-4',
      limits: { maxOutputTokens: -100 },
      priority: 0
    }

    const result = validateOverrideEnhanced(override)

    expect(result.valid).toBe(false)
    expect(result.errors).toContain('maxOutputTokens must be positive')
  })

  it('should warn when maxOutputTokens exceeds contextWindow', () => {
    const override: ProviderModelOverride = {
      providerId: 'openrouter',
      modelId: 'gpt-4',
      limits: {
        contextWindow: 8192,
        maxOutputTokens: 10000
      },
      priority: 0
    }

    const result = validateOverrideEnhanced(override)

    expect(result.valid).toBe(true)
    expect(result.warnings).toContain('maxOutputTokens exceeds contextWindow')
  })

  it('should warn when disabled without reason', () => {
    const override: ProviderModelOverride = {
      providerId: 'openrouter',
      modelId: 'gpt-4',
      disabled: true,
      priority: 0
    }

    const result = validateOverrideEnhanced(override, baseModel)

    expect(result.valid).toBe(true)
    expect(result.warnings).toContain('Disabled override should include a reason')
  })

  it('should pass when disabled with reason', () => {
    const override: ProviderModelOverride = {
      providerId: 'openrouter',
      modelId: 'gpt-4',
      disabled: true,
      reason: 'Deprecated model',
      priority: 0
    }

    const result = validateOverrideEnhanced(override, baseModel)

    expect(result.valid).toBe(true)
    expect(result.warnings).not.toContain('Disabled override should include a reason')
  })

  it('should warn when reducing contextWindow', () => {
    const override: ProviderModelOverride = {
      providerId: 'openrouter',
      modelId: 'gpt-4',
      limits: { contextWindow: 4096 },
      priority: 0
    }

    const result = validateOverrideEnhanced(override, baseModel)

    expect(result.valid).toBe(true)
    expect(result.warnings.some((w) => w.includes('Context window reduced'))).toBe(true)
  })
})
