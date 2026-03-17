/**
 * Tests for override cleanup and deduplication logic
 * Tests deduplicateOverrides(), cleanupRedundantOverrides()
 */

import { describe, expect, it } from 'vitest'

import type { ModelConfig, ProviderModelOverride } from '../schemas'
import { MODEL_CAPABILITY } from '../schemas/enums'
import { cleanupRedundantOverrides, deduplicateOverrides } from '../utils/override-utils'

describe('deduplicateOverrides', () => {
  it('should keep unique overrides unchanged', () => {
    const overrides: ProviderModelOverride[] = [
      {
        providerId: 'openrouter',
        modelId: 'gpt-4',
        limits: { contextWindow: 128000 },
        priority: 0
      },
      {
        providerId: 'openrouter',
        modelId: 'claude-3-opus',
        limits: { contextWindow: 200000 },
        priority: 0
      },
      {
        providerId: 'aihubmix',
        modelId: 'gpt-4',
        limits: { contextWindow: 8192 },
        priority: 0
      }
    ]

    const result = deduplicateOverrides(overrides)

    expect(result).toHaveLength(3)
    expect(result).toEqual(expect.arrayContaining(overrides))
  })

  it('should remove exact duplicates and keep highest priority', () => {
    const overrides: ProviderModelOverride[] = [
      {
        providerId: 'openrouter',
        modelId: 'gpt-4',
        limits: { contextWindow: 128000 },
        priority: 0
      },
      {
        providerId: 'openrouter',
        modelId: 'gpt-4',
        limits: { contextWindow: 8192 },
        priority: 100 // Higher priority
      }
    ]

    const result = deduplicateOverrides(overrides)

    expect(result).toHaveLength(1)
    expect(result[0].priority).toBe(100)
    expect(result[0].limits?.contextWindow).toBe(8192)
  })

  it('should keep first when priorities are equal', () => {
    const overrides: ProviderModelOverride[] = [
      {
        providerId: 'openrouter',
        modelId: 'gpt-4',
        limits: { contextWindow: 128000 },
        priority: 50
      },
      {
        providerId: 'openrouter',
        modelId: 'gpt-4',
        limits: { contextWindow: 8192 },
        priority: 50
      }
    ]

    const result = deduplicateOverrides(overrides)

    expect(result).toHaveLength(1)
    expect(result[0].limits?.contextWindow).toBe(128000)
  })

  it('should handle multiple duplicates with different priorities', () => {
    const overrides: ProviderModelOverride[] = [
      {
        providerId: 'openrouter',
        modelId: 'gpt-4',
        limits: { contextWindow: 8192 },
        priority: 0
      },
      {
        providerId: 'openrouter',
        modelId: 'gpt-4',
        limits: { contextWindow: 16384 },
        priority: 50
      },
      {
        providerId: 'openrouter',
        modelId: 'gpt-4',
        limits: { contextWindow: 128000 },
        priority: 100
      },
      {
        providerId: 'openrouter',
        modelId: 'gpt-4',
        limits: { contextWindow: 4096 },
        priority: 25
      }
    ]

    const result = deduplicateOverrides(overrides)

    expect(result).toHaveLength(1)
    expect(result[0].priority).toBe(100)
    expect(result[0].limits?.contextWindow).toBe(128000)
  })

  it('should handle empty array', () => {
    const result = deduplicateOverrides([])
    expect(result).toHaveLength(0)
  })

  it('should treat different providers as different keys', () => {
    const overrides: ProviderModelOverride[] = [
      {
        providerId: 'openrouter',
        modelId: 'gpt-4',
        limits: { contextWindow: 128000 },
        priority: 50
      },
      {
        providerId: 'aihubmix',
        modelId: 'gpt-4',
        limits: { contextWindow: 8192 },
        priority: 100
      }
    ]

    const result = deduplicateOverrides(overrides)

    expect(result).toHaveLength(2)
  })

  it('should treat different models as different keys', () => {
    const overrides: ProviderModelOverride[] = [
      {
        providerId: 'openrouter',
        modelId: 'gpt-4',
        limits: { contextWindow: 128000 },
        priority: 0
      },
      {
        providerId: 'openrouter',
        modelId: 'gpt-4-turbo',
        limits: { contextWindow: 128000 },
        priority: 0
      }
    ]

    const result = deduplicateOverrides(overrides)

    expect(result).toHaveLength(2)
  })
})

describe('cleanupRedundantOverrides', () => {
  const baseModels: ModelConfig[] = [
    {
      id: 'gpt-4',
      name: 'GPT-4',
      capabilities: [MODEL_CAPABILITY.FUNCTION_CALL, MODEL_CAPABILITY.REASONING],
      contextWindow: 8192,
      maxOutputTokens: 4096,
      pricing: {
        input: { perMillionTokens: 30 },
        output: { perMillionTokens: 60 }
      },
      metadata: {}
    },
    {
      id: 'claude-3-opus',
      name: 'Claude 3 Opus',
      capabilities: [MODEL_CAPABILITY.FUNCTION_CALL, MODEL_CAPABILITY.REASONING, MODEL_CAPABILITY.IMAGE_RECOGNITION],
      contextWindow: 200000,
      maxOutputTokens: 4096,
      metadata: {}
    }
  ]

  it('should remove override that matches base model exactly', () => {
    const overrides: ProviderModelOverride[] = [
      {
        providerId: 'openrouter',
        modelId: 'gpt-4',
        // No actual differences from base
        priority: 0
      }
    ]

    const result = cleanupRedundantOverrides(overrides, baseModels)

    expect(result.kept).toHaveLength(0)
    expect(result.removed).toHaveLength(1)
    expect(result.reasons['openrouter:gpt-4']).toBe('Override matches base model')
  })

  it('should keep override with different limits', () => {
    const overrides: ProviderModelOverride[] = [
      {
        providerId: 'openrouter',
        modelId: 'gpt-4',
        limits: { contextWindow: 128000 },
        priority: 0
      }
    ]

    const result = cleanupRedundantOverrides(overrides, baseModels)

    expect(result.kept).toHaveLength(1)
    expect(result.removed).toHaveLength(0)
  })

  it('should keep override with different pricing', () => {
    const overrides: ProviderModelOverride[] = [
      {
        providerId: 'openrouter',
        modelId: 'gpt-4',
        pricing: {
          input: { perMillionTokens: 25 },
          output: { perMillionTokens: 50 }
        },
        priority: 0
      }
    ]

    const result = cleanupRedundantOverrides(overrides, baseModels)

    expect(result.kept).toHaveLength(1)
    expect(result.removed).toHaveLength(0)
  })

  it('should keep override with capability changes', () => {
    const overrides: ProviderModelOverride[] = [
      {
        providerId: 'openrouter',
        modelId: 'gpt-4',
        capabilities: {
          add: [MODEL_CAPABILITY.IMAGE_RECOGNITION]
        },
        priority: 0
      }
    ]

    const result = cleanupRedundantOverrides(overrides, baseModels)

    expect(result.kept).toHaveLength(1)
    expect(result.removed).toHaveLength(0)
  })

  it('should keep override with disabled flag', () => {
    const overrides: ProviderModelOverride[] = [
      {
        providerId: 'openrouter',
        modelId: 'gpt-4',
        disabled: true,
        reason: 'Not available',
        priority: 0
      }
    ]

    const result = cleanupRedundantOverrides(overrides, baseModels)

    expect(result.kept).toHaveLength(1)
    expect(result.removed).toHaveLength(0)
  })

  it('should keep override with replaceWith', () => {
    const overrides: ProviderModelOverride[] = [
      {
        providerId: 'openrouter',
        modelId: 'gpt-4',
        replaceWith: 'gpt-4-turbo',
        priority: 0
      }
    ]

    const result = cleanupRedundantOverrides(overrides, baseModels)

    expect(result.kept).toHaveLength(1)
    expect(result.removed).toHaveLength(0)
  })

  it('should keep override with reasoning configuration', () => {
    const overrides: ProviderModelOverride[] = [
      {
        providerId: 'openrouter',
        modelId: 'gpt-4',
        reasoning: {
          type: 'anthropic',
          params: { type: 'enabled', budgetTokens: 10000 }
        },
        priority: 0
      }
    ]

    const result = cleanupRedundantOverrides(overrides, baseModels)

    expect(result.kept).toHaveLength(1)
    expect(result.removed).toHaveLength(0)
  })

  it('should keep override with parameter changes', () => {
    const overrides: ProviderModelOverride[] = [
      {
        providerId: 'openrouter',
        modelId: 'gpt-4',
        parameterSupport: {
          temperature: { supported: true, range: { min: 0, max: 1 } }
        },
        priority: 0
      }
    ]

    const result = cleanupRedundantOverrides(overrides, baseModels)

    expect(result.kept).toHaveLength(1)
    expect(result.removed).toHaveLength(0)
  })

  it('should keep override for non-existent base model', () => {
    const overrides: ProviderModelOverride[] = [
      {
        providerId: 'openrouter',
        modelId: 'non-existent-model',
        limits: { contextWindow: 128000 },
        priority: 0
      }
    ]

    const result = cleanupRedundantOverrides(overrides, baseModels)

    expect(result.kept).toHaveLength(1)
    expect(result.removed).toHaveLength(0)
  })

  it('should handle mixed redundant and non-redundant overrides', () => {
    const overrides: ProviderModelOverride[] = [
      {
        providerId: 'openrouter',
        modelId: 'gpt-4',
        // Redundant
        priority: 0
      },
      {
        providerId: 'openrouter',
        modelId: 'gpt-4',
        limits: { contextWindow: 128000 }, // Non-redundant
        priority: 50
      },
      {
        providerId: 'openrouter',
        modelId: 'claude-3-opus',
        // Redundant
        priority: 0
      }
    ]

    const result = cleanupRedundantOverrides(overrides, baseModels)

    expect(result.kept).toHaveLength(1)
    expect(result.removed).toHaveLength(2)
  })

  it('should handle empty arrays', () => {
    const result = cleanupRedundantOverrides([], baseModels)

    expect(result.kept).toHaveLength(0)
    expect(result.removed).toHaveLength(0)
    expect(Object.keys(result.reasons)).toHaveLength(0)
  })

  it('should keep override if limits match but pricing differs', () => {
    const overrides: ProviderModelOverride[] = [
      {
        providerId: 'openrouter',
        modelId: 'gpt-4',
        limits: {
          contextWindow: 8192,
          maxOutputTokens: 4096
        },
        pricing: {
          input: { perMillionTokens: 20 },
          output: { perMillionTokens: 40 }
        },
        priority: 0
      }
    ]

    const result = cleanupRedundantOverrides(overrides, baseModels)

    expect(result.kept).toHaveLength(1)
    expect(result.removed).toHaveLength(0)
  })

  it('should remove override if limits match base exactly', () => {
    const overrides: ProviderModelOverride[] = [
      {
        providerId: 'openrouter',
        modelId: 'gpt-4',
        limits: {
          contextWindow: 8192,
          maxOutputTokens: 4096
        },
        priority: 0
      }
    ]

    const result = cleanupRedundantOverrides(overrides, baseModels)

    expect(result.kept).toHaveLength(0)
    expect(result.removed).toHaveLength(1)
  })
})
