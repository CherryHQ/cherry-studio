/**
 * Tests for override merging logic
 * Tests mergeOverrides()
 */

import { describe, expect, it } from 'vitest'

import type { ProviderModelOverride } from '../schemas'
import { ModelCapability } from '../schemas/enums'
import { mergeOverrides } from '../utils/override-utils'

describe('mergeOverrides', () => {
  it('should preserve manual override completely when preserveManual is true', () => {
    const existing: ProviderModelOverride = {
      providerId: 'openrouter',
      modelId: 'gpt-4',
      limits: { contextWindow: 8192 },
      pricing: {
        input: { perMillionTokens: 25 },
        output: { perMillionTokens: 50 }
      },
      priority: 100 // Manual
    }

    const generated: ProviderModelOverride = {
      providerId: 'openrouter',
      modelId: 'gpt-4',
      limits: { contextWindow: 128000 },
      pricing: {
        input: { perMillionTokens: 30 },
        output: { perMillionTokens: 60 }
      },
      priority: 0
    }

    const result = mergeOverrides(existing, generated, { preserveManual: true })

    expect(result).toEqual(existing)
  })

  it('should not preserve when preserveManual is false', () => {
    const existing: ProviderModelOverride = {
      providerId: 'openrouter',
      modelId: 'gpt-4',
      limits: { contextWindow: 8192 },
      pricing: {
        input: { perMillionTokens: 25 },
        output: { perMillionTokens: 50 }
      },
      priority: 100 // Manual
    }

    const generated: ProviderModelOverride = {
      providerId: 'openrouter',
      modelId: 'gpt-4',
      limits: { contextWindow: 128000 },
      pricing: {
        input: { perMillionTokens: 30 },
        output: { perMillionTokens: 60 }
      },
      priority: 0
    }

    const result = mergeOverrides(existing, generated, { preserveManual: false })

    // Should merge, not preserve completely
    expect(result).not.toEqual(existing)
    expect(result.limits).toEqual(existing.limits) // Manual limits take precedence
    expect(result.pricing).toEqual(existing.pricing) // Manual pricing takes precedence (isManual=true)
  })

  it('should preserve manual limits but update auto pricing', () => {
    const existing: ProviderModelOverride = {
      providerId: 'openrouter',
      modelId: 'gpt-4',
      limits: { contextWindow: 8192 },
      pricing: {
        input: { perMillionTokens: 25 },
        output: { perMillionTokens: 50 }
      },
      priority: 100 // Manual
    }

    const generated: ProviderModelOverride = {
      providerId: 'openrouter',
      modelId: 'gpt-4',
      pricing: {
        input: { perMillionTokens: 30 },
        output: { perMillionTokens: 60 }
      },
      priority: 0
    }

    const result = mergeOverrides(existing, generated)

    expect(result.limits).toEqual(existing.limits)
    expect(result.pricing).toEqual(existing.pricing) // Manual pricing preserved (priority >= 100)
  })

  it('should update pricing for auto-generated overrides', () => {
    const existing: ProviderModelOverride = {
      providerId: 'openrouter',
      modelId: 'gpt-4',
      pricing: {
        input: { perMillionTokens: 25 },
        output: { perMillionTokens: 50 }
      },
      priority: 0 // Auto-generated
    }

    const generated: ProviderModelOverride = {
      providerId: 'openrouter',
      modelId: 'gpt-4',
      pricing: {
        input: { perMillionTokens: 30 },
        output: { perMillionTokens: 60 }
      },
      priority: 0
    }

    const result = mergeOverrides(existing, generated)

    expect(result.pricing).toEqual(generated.pricing) // Updated from generated
  })

  it('should merge capabilities (union of add, remove)', () => {
    const existing: ProviderModelOverride = {
      providerId: 'openrouter',
      modelId: 'gpt-4',
      capabilities: {
        add: [ModelCapability.FUNCTION_CALL],
        remove: [ModelCapability.REASONING]
      },
      priority: 50
    }

    const generated: ProviderModelOverride = {
      providerId: 'openrouter',
      modelId: 'gpt-4',
      capabilities: {
        add: [ModelCapability.IMAGE_RECOGNITION],
        remove: [ModelCapability.AUDIO_RECOGNITION]
      },
      priority: 0
    }

    const result = mergeOverrides(existing, generated)

    expect(result.capabilities?.add).toEqual(
      expect.arrayContaining([ModelCapability.FUNCTION_CALL, ModelCapability.IMAGE_RECOGNITION])
    )
    expect(result.capabilities?.remove).toEqual(
      expect.arrayContaining([ModelCapability.REASONING, ModelCapability.AUDIO_RECOGNITION])
    )
  })

  it('should deduplicate merged capabilities', () => {
    const existing: ProviderModelOverride = {
      providerId: 'openrouter',
      modelId: 'gpt-4',
      capabilities: {
        add: [ModelCapability.FUNCTION_CALL, ModelCapability.IMAGE_RECOGNITION]
      },
      priority: 50
    }

    const generated: ProviderModelOverride = {
      providerId: 'openrouter',
      modelId: 'gpt-4',
      capabilities: {
        add: [ModelCapability.FUNCTION_CALL, ModelCapability.AUDIO_RECOGNITION]
      },
      priority: 0
    }

    const result = mergeOverrides(existing, generated)

    expect(result.capabilities?.add).toHaveLength(3)
    expect(result.capabilities?.add).toEqual(
      expect.arrayContaining([
        ModelCapability.FUNCTION_CALL,
        ModelCapability.IMAGE_RECOGNITION,
        ModelCapability.AUDIO_RECOGNITION
      ])
    )
  })

  it('should prefer existing force capabilities', () => {
    const existing: ProviderModelOverride = {
      providerId: 'openrouter',
      modelId: 'gpt-4',
      capabilities: {
        force: [ModelCapability.FUNCTION_CALL]
      },
      priority: 50
    }

    const generated: ProviderModelOverride = {
      providerId: 'openrouter',
      modelId: 'gpt-4',
      capabilities: {
        force: [ModelCapability.IMAGE_RECOGNITION]
      },
      priority: 0
    }

    const result = mergeOverrides(existing, generated)

    expect(result.capabilities?.force).toEqual([ModelCapability.FUNCTION_CALL])
  })

  it('should preserve existing reasoning if present', () => {
    const existing: ProviderModelOverride = {
      providerId: 'openrouter',
      modelId: 'gpt-4',
      reasoning: {
        type: 'anthropic',
        params: { type: 'enabled', budgetTokens: 10000 }
      },
      priority: 50
    }

    const generated: ProviderModelOverride = {
      providerId: 'openrouter',
      modelId: 'gpt-4',
      reasoning: {
        type: 'openai-chat',
        params: { reasoningEffort: 'high' }
      },
      priority: 0
    }

    const result = mergeOverrides(existing, generated)

    expect(result.reasoning).toEqual(existing.reasoning)
  })

  it('should use generated reasoning if existing has none', () => {
    const existing: ProviderModelOverride = {
      providerId: 'openrouter',
      modelId: 'gpt-4',
      priority: 50
    }

    const generated: ProviderModelOverride = {
      providerId: 'openrouter',
      modelId: 'gpt-4',
      reasoning: {
        type: 'openai-chat',
        params: { reasoningEffort: 'high' }
      },
      priority: 0
    }

    const result = mergeOverrides(existing, generated)

    expect(result.reasoning).toEqual(generated.reasoning)
  })

  it('should merge parameters with existing taking precedence', () => {
    const existing: ProviderModelOverride = {
      providerId: 'openrouter',
      modelId: 'gpt-4',
      parameters: {
        temperature: { supported: true, min: 0, max: 1 }
      },
      priority: 50
    }

    const generated: ProviderModelOverride = {
      providerId: 'openrouter',
      modelId: 'gpt-4',
      parameters: {
        temperature: { supported: true, min: 0, max: 2 },
        topP: { supported: true, min: 0, max: 1 }
      },
      priority: 0
    }

    const result = mergeOverrides(existing, generated)

    expect(result.parameters?.temperature).toEqual(existing.parameters?.temperature)
    expect(result.parameters?.topP).toEqual(generated.parameters?.topP)
  })

  it('should preserve disabled and replaceWith status', () => {
    const existing: ProviderModelOverride = {
      providerId: 'openrouter',
      modelId: 'gpt-4',
      disabled: true,
      replaceWith: 'gpt-4-turbo',
      reason: 'Deprecated',
      priority: 100
    }

    const generated: ProviderModelOverride = {
      providerId: 'openrouter',
      modelId: 'gpt-4',
      limits: { contextWindow: 128000 },
      priority: 0
    }

    const result = mergeOverrides(existing, generated)

    expect(result.disabled).toBe(true)
    expect(result.replaceWith).toBe('gpt-4-turbo')
    expect(result.reason).toBe('Deprecated')
  })

  it('should maintain existing priority', () => {
    const existing: ProviderModelOverride = {
      providerId: 'openrouter',
      modelId: 'gpt-4',
      limits: { contextWindow: 8192 },
      priority: 150
    }

    const generated: ProviderModelOverride = {
      providerId: 'openrouter',
      modelId: 'gpt-4',
      limits: { contextWindow: 128000 },
      priority: 0
    }

    const result = mergeOverrides(existing, generated)

    expect(result.priority).toBe(150)
  })

  it('should use custom manual priority threshold', () => {
    const existing: ProviderModelOverride = {
      providerId: 'openrouter',
      modelId: 'gpt-4',
      limits: { contextWindow: 8192 },
      pricing: {
        input: { perMillionTokens: 25 },
        output: { perMillionTokens: 50 }
      },
      priority: 50
    }

    const generated: ProviderModelOverride = {
      providerId: 'openrouter',
      modelId: 'gpt-4',
      pricing: {
        input: { perMillionTokens: 30 },
        output: { perMillionTokens: 60 }
      },
      priority: 0
    }

    // With threshold 50, existing is considered manual
    const result = mergeOverrides(existing, generated, {
      preserveManual: true,
      manualPriorityThreshold: 50
    })

    expect(result).toEqual(existing)
  })

  it('should handle merging when only one has capabilities', () => {
    const existing: ProviderModelOverride = {
      providerId: 'openrouter',
      modelId: 'gpt-4',
      limits: { contextWindow: 8192 },
      priority: 50
    }

    const generated: ProviderModelOverride = {
      providerId: 'openrouter',
      modelId: 'gpt-4',
      capabilities: {
        add: [ModelCapability.IMAGE_RECOGNITION]
      },
      priority: 0
    }

    const result = mergeOverrides(existing, generated)

    expect(result.capabilities).toEqual(generated.capabilities)
  })

  it('should handle empty capabilities arrays', () => {
    const existing: ProviderModelOverride = {
      providerId: 'openrouter',
      modelId: 'gpt-4',
      capabilities: {
        add: [],
        remove: []
      },
      priority: 50
    }

    const generated: ProviderModelOverride = {
      providerId: 'openrouter',
      modelId: 'gpt-4',
      capabilities: {
        add: [ModelCapability.IMAGE_RECOGNITION]
      },
      priority: 0
    }

    const result = mergeOverrides(existing, generated)

    expect(result.capabilities?.add).toEqual([ModelCapability.IMAGE_RECOGNITION])
  })
})
