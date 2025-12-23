/**
 * Test merge utilities
 */

import { describe, expect, it } from 'vitest'
import { mergeModelsList, MergeStrategies } from '../utils/merge-utils'
import type { ModelConfig } from '../schemas'

describe('Merge Utilities', () => {
  describe('mergeModelsList', () => {
    it('should merge models with case-insensitive ID matching', () => {
      const existing: ModelConfig[] = [
        {
          id: 'GPT-4',
          name: 'GPT-4',
          description: 'Existing description',
          owned_by: 'openai',
          capabilities: ['FUNCTION_CALL'],
          input_modalities: ['TEXT'],
          output_modalities: ['TEXT'],
          context_window: 8000
        },
        {
          id: 'claude-3-opus',
          name: 'Claude 3 Opus',
          owned_by: 'anthropic',
          input_modalities: ['TEXT'],
          output_modalities: ['TEXT'],
          context_window: 200000
        }
      ]

      const incoming: ModelConfig[] = [
        {
          id: 'gpt-4',
          name: 'GPT-4 Updated',
          description: 'New description',
          owned_by: 'openai',
          capabilities: ['FUNCTION_CALL', 'REASONING'],
          input_modalities: ['TEXT', 'VISION'],
          output_modalities: ['TEXT'],
          context_window: 128000
        }
      ]

      const result = mergeModelsList(existing, incoming, MergeStrategies.FILL_UNDEFINED)

      // Should have 2 models total
      expect(result).toHaveLength(2)

      // Find the merged gpt-4 model
      const gpt4 = result.find((m) => m.id === 'gpt-4')
      expect(gpt4).toBeDefined()
      expect(gpt4!.id).toBe('gpt-4') // ID should be lowercase
      expect(gpt4!.description).toBe('Existing description') // Preserved from existing
      expect(gpt4!.context_window).toBe(8000) // Preserved from existing

      // Claude model should remain with lowercase ID
      const claude = result.find((m) => m.id === 'claude-3-opus')
      expect(claude).toBeDefined()
      expect(claude!.id).toBe('claude-3-opus')
    })

    it('should normalize all model IDs to lowercase', () => {
      const models: ModelConfig[] = [
        {
          id: 'GPT-4',
          name: 'GPT-4',
          owned_by: 'openai',
          input_modalities: ['TEXT'],
          output_modalities: ['TEXT'],
          context_window: 8000
        },
        {
          id: 'Claude-3-Opus',
          name: 'Claude 3 Opus',
          owned_by: 'anthropic',
          input_modalities: ['TEXT'],
          output_modalities: ['TEXT'],
          context_window: 200000
        },
        {
          id: 'Gemini-Pro',
          name: 'Gemini Pro',
          owned_by: 'google',
          input_modalities: ['TEXT'],
          output_modalities: ['TEXT'],
          context_window: 32000
        }
      ]

      const result = mergeModelsList(models, [], MergeStrategies.FILL_UNDEFINED)

      // All IDs should be lowercase
      expect(result.every((m) => m.id === m.id.toLowerCase())).toBe(true)
      expect(result.find((m) => m.id === 'gpt-4')).toBeDefined()
      expect(result.find((m) => m.id === 'claude-3-opus')).toBeDefined()
      expect(result.find((m) => m.id === 'gemini-pro')).toBeDefined()
    })

    it('should merge models with mixed case IDs from different sources', () => {
      const existing: ModelConfig[] = [
        {
          id: 'gpt-4-turbo',
          name: 'GPT-4 Turbo',
          owned_by: 'openai',
          input_modalities: ['TEXT'],
          output_modalities: ['TEXT'],
          context_window: 128000,
          pricing: {
            input: { per_million_tokens: 10, currency: 'USD' },
            output: { per_million_tokens: 30, currency: 'USD' }
          }
        }
      ]

      const incoming: ModelConfig[] = [
        {
          id: 'GPT-4-Turbo',
          name: 'GPT-4 Turbo Updated',
          owned_by: 'openai',
          input_modalities: ['TEXT', 'VISION'],
          output_modalities: ['TEXT'],
          context_window: 128000,
          pricing: {
            input: { per_million_tokens: 5, currency: 'USD' },
            output: { per_million_tokens: 15, currency: 'USD' }
          }
        }
      ]

      const result = mergeModelsList(existing, incoming, {
        preserveExisting: true,
        alwaysOverwrite: ['pricing'] // Always update pricing
      })

      expect(result).toHaveLength(1)
      const model = result[0]
      expect(model.id).toBe('gpt-4-turbo') // Lowercase
      expect(model.name).toBe('GPT-4 Turbo') // From existing (preserved)
      expect(model.pricing?.input.per_million_tokens).toBe(5) // From incoming (alwaysOverwrite)
    })

    it('should handle new models with uppercase IDs', () => {
      const existing: ModelConfig[] = []
      const incoming: ModelConfig[] = [
        {
          id: 'NEW-MODEL',
          name: 'New Model',
          owned_by: 'test',
          input_modalities: ['TEXT'],
          output_modalities: ['TEXT'],
          context_window: 4000
        }
      ]

      const result = mergeModelsList(existing, incoming, MergeStrategies.FILL_UNDEFINED)

      expect(result).toHaveLength(1)
      expect(result[0].id).toBe('new-model') // Should be lowercase
    })

    it('should deduplicate models with different case variations when merging', () => {
      const existing: ModelConfig[] = [
        {
          id: 'GPT-4',
          name: 'GPT-4 Existing',
          owned_by: 'openai',
          input_modalities: ['TEXT'],
          output_modalities: ['TEXT'],
          context_window: 8000,
          description: 'Existing model'
        }
      ]

      const incoming: ModelConfig[] = [
        {
          id: 'gpt-4',
          name: 'GPT-4 Incoming',
          owned_by: 'openai',
          input_modalities: ['TEXT'],
          output_modalities: ['TEXT'],
          context_window: 8000,
          max_output_tokens: 4096
        },
        {
          id: 'Gpt-4',
          name: 'GPT-4 Another',
          owned_by: 'openai',
          input_modalities: ['TEXT'],
          output_modalities: ['TEXT'],
          context_window: 8000
        }
      ]

      const result = mergeModelsList(existing, incoming, MergeStrategies.FILL_UNDEFINED)

      // Should only have 1 model after merging (all case variations treated as same model)
      expect(result).toHaveLength(1)
      expect(result[0].id).toBe('gpt-4') // Lowercase
      expect(result[0].description).toBe('Existing model') // Preserved from existing
      expect(result[0].max_output_tokens).toBe(4096) // Filled from incoming
    })
  })
})
