/**
 * Tests for override cleanup and deduplication logic
 * Tests deduplicateOverrides(), cleanupRedundantOverrides()
 */

import { describe, expect, it } from 'vitest'

import type { ModelConfig, ProviderModelOverride } from '../schemas'
import { cleanupRedundantOverrides,deduplicateOverrides } from '../utils/override-utils'

describe('deduplicateOverrides', () => {
  it('should keep unique overrides unchanged', () => {
    const overrides: ProviderModelOverride[] = [
      {
        provider_id: 'openrouter',
        model_id: 'gpt-4',
        limits: { context_window: 128000 },
        priority: 0
      },
      {
        provider_id: 'openrouter',
        model_id: 'claude-3-opus',
        limits: { context_window: 200000 },
        priority: 0
      },
      {
        provider_id: 'aihubmix',
        model_id: 'gpt-4',
        limits: { context_window: 8192 },
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
        provider_id: 'openrouter',
        model_id: 'gpt-4',
        limits: { context_window: 128000 },
        priority: 0
      },
      {
        provider_id: 'openrouter',
        model_id: 'gpt-4',
        limits: { context_window: 8192 },
        priority: 100 // Higher priority
      }
    ]

    const result = deduplicateOverrides(overrides)

    expect(result).toHaveLength(1)
    expect(result[0].priority).toBe(100)
    expect(result[0].limits?.context_window).toBe(8192)
  })

  it('should keep first when priorities are equal', () => {
    const overrides: ProviderModelOverride[] = [
      {
        provider_id: 'openrouter',
        model_id: 'gpt-4',
        limits: { context_window: 128000 },
        priority: 50
      },
      {
        provider_id: 'openrouter',
        model_id: 'gpt-4',
        limits: { context_window: 8192 },
        priority: 50
      }
    ]

    const result = deduplicateOverrides(overrides)

    expect(result).toHaveLength(1)
    expect(result[0].limits?.context_window).toBe(128000)
  })

  it('should handle multiple duplicates with different priorities', () => {
    const overrides: ProviderModelOverride[] = [
      {
        provider_id: 'openrouter',
        model_id: 'gpt-4',
        limits: { context_window: 8192 },
        priority: 0
      },
      {
        provider_id: 'openrouter',
        model_id: 'gpt-4',
        limits: { context_window: 16384 },
        priority: 50
      },
      {
        provider_id: 'openrouter',
        model_id: 'gpt-4',
        limits: { context_window: 128000 },
        priority: 100
      },
      {
        provider_id: 'openrouter',
        model_id: 'gpt-4',
        limits: { context_window: 4096 },
        priority: 25
      }
    ]

    const result = deduplicateOverrides(overrides)

    expect(result).toHaveLength(1)
    expect(result[0].priority).toBe(100)
    expect(result[0].limits?.context_window).toBe(128000)
  })

  it('should handle empty array', () => {
    const result = deduplicateOverrides([])
    expect(result).toHaveLength(0)
  })

  it('should treat different providers as different keys', () => {
    const overrides: ProviderModelOverride[] = [
      {
        provider_id: 'openrouter',
        model_id: 'gpt-4',
        limits: { context_window: 128000 },
        priority: 50
      },
      {
        provider_id: 'aihubmix',
        model_id: 'gpt-4',
        limits: { context_window: 8192 },
        priority: 100
      }
    ]

    const result = deduplicateOverrides(overrides)

    expect(result).toHaveLength(2)
  })

  it('should treat different models as different keys', () => {
    const overrides: ProviderModelOverride[] = [
      {
        provider_id: 'openrouter',
        model_id: 'gpt-4',
        limits: { context_window: 128000 },
        priority: 0
      },
      {
        provider_id: 'openrouter',
        model_id: 'gpt-4-turbo',
        limits: { context_window: 128000 },
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
    },
    {
      id: 'claude-3-opus',
      name: 'Claude 3 Opus',
      provider: 'anthropic',
      endpoint_type: 'CHAT_COMPLETIONS',
      capabilities: ['FUNCTION_CALL', 'REASONING', 'IMAGE_RECOGNITION'],
      context_window: 200000,
      max_output_tokens: 4096
    }
  ]

  it('should remove override that matches base model exactly', () => {
    const overrides: ProviderModelOverride[] = [
      {
        provider_id: 'openrouter',
        model_id: 'gpt-4',
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
        provider_id: 'openrouter',
        model_id: 'gpt-4',
        limits: { context_window: 128000 },
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
        provider_id: 'openrouter',
        model_id: 'gpt-4',
        pricing: {
          currency: 'USD',
          input: { per_million_tokens: 25 },
          output: { per_million_tokens: 50 }
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
        provider_id: 'openrouter',
        model_id: 'gpt-4',
        capabilities: {
          add: ['IMAGE_RECOGNITION']
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
        provider_id: 'openrouter',
        model_id: 'gpt-4',
        disabled: true,
        reason: 'Not available',
        priority: 0
      }
    ]

    const result = cleanupRedundantOverrides(overrides, baseModels)

    expect(result.kept).toHaveLength(1)
    expect(result.removed).toHaveLength(0)
  })

  it('should keep override with replace_with', () => {
    const overrides: ProviderModelOverride[] = [
      {
        provider_id: 'openrouter',
        model_id: 'gpt-4',
        replace_with: 'gpt-4-turbo',
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
        provider_id: 'openrouter',
        model_id: 'gpt-4',
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
        provider_id: 'openrouter',
        model_id: 'gpt-4',
        parameters: {
          temperature: { min: 0, max: 1, default: 0.7 }
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
        provider_id: 'openrouter',
        model_id: 'non-existent-model',
        limits: { context_window: 128000 },
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
        provider_id: 'openrouter',
        model_id: 'gpt-4',
        // Redundant
        priority: 0
      },
      {
        provider_id: 'openrouter',
        model_id: 'gpt-4',
        limits: { context_window: 128000 }, // Non-redundant
        priority: 50
      },
      {
        provider_id: 'openrouter',
        model_id: 'claude-3-opus',
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
        provider_id: 'openrouter',
        model_id: 'gpt-4',
        limits: {
          context_window: 8192,
          max_output_tokens: 4096
        },
        pricing: {
          currency: 'USD',
          input: { per_million_tokens: 20 },
          output: { per_million_tokens: 40 }
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
        provider_id: 'openrouter',
        model_id: 'gpt-4',
        limits: {
          context_window: 8192,
          max_output_tokens: 4096
        },
        priority: 0
      }
    ]

    const result = cleanupRedundantOverrides(overrides, baseModels)

    expect(result.kept).toHaveLength(0)
    expect(result.removed).toHaveLength(1)
  })
})
