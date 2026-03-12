/**
 * Test merge utilities
 */

import { describe, expect, it } from 'vitest'

import type { ModelConfig } from '../schemas'
import { MODALITY, MODEL_CAPABILITY } from '../schemas/enums'
import { deduplicateModels, mergeModelsList, MergeStrategies } from '../utils/merge-utils'

describe('Merge Utilities', () => {
  describe('deduplicateModels', () => {
    it('should remove duplicate models by ID', () => {
      const models: ModelConfig[] = [
        {
          id: 'gpt-4',
          name: 'GPT-4 First',
          inputModalities: [MODALITY.TEXT],
          outputModalities: [MODALITY.TEXT],
          contextWindow: 8000
        },
        {
          id: 'gpt-4',
          name: 'GPT-4 Second',
          inputModalities: [MODALITY.TEXT],
          outputModalities: [MODALITY.TEXT],
          contextWindow: 128000,
          description: 'Second model'
        },
        {
          id: 'claude-3',
          name: 'Claude 3',
          inputModalities: [MODALITY.TEXT],
          outputModalities: [MODALITY.TEXT],
          contextWindow: 200000
        }
      ]

      const result = deduplicateModels(models)

      expect(result).toHaveLength(2) // Only 2 unique models
      const gpt4 = result.find((m) => m.id === 'gpt-4')
      expect(gpt4).toBeDefined()
      expect(gpt4!.contextWindow).toBe(8000) // First occurrence wins for defined fields
      expect(gpt4!.description).toBe('Second model') // Fill undefined from subsequent
    })

    it('should handle case-insensitive deduplication', () => {
      const models: ModelConfig[] = [
        {
          id: 'GPT-4',
          name: 'GPT-4',
          inputModalities: [MODALITY.TEXT],
          outputModalities: [MODALITY.TEXT],
          contextWindow: 8000
        },
        {
          id: 'gpt-4',
          name: 'gpt-4 lowercase',
          inputModalities: [MODALITY.TEXT],
          outputModalities: [MODALITY.TEXT],
          contextWindow: 128000
        }
      ]

      const result = deduplicateModels(models)

      expect(result).toHaveLength(1)
      expect(result[0].id).toBe('gpt-4') // Lowercase
    })

    it('should merge data from duplicates to fill undefined fields', () => {
      const models: ModelConfig[] = [
        {
          id: 'model-1',
          name: 'Model 1',
          inputModalities: [MODALITY.TEXT],
          outputModalities: [MODALITY.TEXT]
          // No contextWindow, no description
        },
        {
          id: 'model-1',
          name: 'Model 1 Duplicate',
          inputModalities: [MODALITY.TEXT],
          outputModalities: [MODALITY.TEXT],
          contextWindow: 8000,
          description: 'From duplicate'
        }
      ]

      const result = deduplicateModels(models)

      expect(result).toHaveLength(1)
      expect(result[0].name).toBe('Model 1') // From first
      expect(result[0].contextWindow).toBe(8000) // Filled from duplicate
      expect(result[0].description).toBe('From duplicate') // Filled from duplicate
    })
  })

  describe('mergeModelsList', () => {
    it('should merge models with case-insensitive ID matching', () => {
      const existing: ModelConfig[] = [
        {
          id: 'GPT-4',
          name: 'GPT-4',
          description: 'Existing description',
          capabilities: [MODEL_CAPABILITY.FUNCTION_CALL],
          inputModalities: [MODALITY.TEXT],
          outputModalities: [MODALITY.TEXT],
          contextWindow: 8000
        },
        {
          id: 'claude-3-opus',
          name: 'Claude 3 Opus',
          inputModalities: [MODALITY.TEXT],
          outputModalities: [MODALITY.TEXT],
          contextWindow: 200000
        }
      ]

      const incoming: ModelConfig[] = [
        {
          id: 'gpt-4',
          name: 'GPT-4 Updated',
          description: 'New description',
          capabilities: [MODEL_CAPABILITY.FUNCTION_CALL, MODEL_CAPABILITY.REASONING],
          inputModalities: [MODALITY.TEXT, MODALITY.IMAGE],
          outputModalities: [MODALITY.TEXT],
          contextWindow: 128000
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
      expect(gpt4!.contextWindow).toBe(8000) // Preserved from existing

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
          inputModalities: [MODALITY.TEXT],
          outputModalities: [MODALITY.TEXT],
          contextWindow: 8000
        },
        {
          id: 'Claude-3-Opus',
          name: 'Claude 3 Opus',
          inputModalities: [MODALITY.TEXT],
          outputModalities: [MODALITY.TEXT],
          contextWindow: 200000
        },
        {
          id: 'Gemini-Pro',
          name: 'Gemini Pro',
          inputModalities: [MODALITY.TEXT],
          outputModalities: [MODALITY.TEXT],
          contextWindow: 32000
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
          inputModalities: [MODALITY.TEXT],
          outputModalities: [MODALITY.TEXT],
          contextWindow: 128000,
          pricing: {
            input: { perMillionTokens: 10 },
            output: { perMillionTokens: 30 }
          }
        }
      ]

      const incoming: ModelConfig[] = [
        {
          id: 'GPT-4-Turbo',
          name: 'GPT-4 Turbo Updated',
          inputModalities: [MODALITY.TEXT, MODALITY.IMAGE],
          outputModalities: [MODALITY.TEXT],
          contextWindow: 128000,
          pricing: {
            input: { perMillionTokens: 5 },
            output: { perMillionTokens: 15 }
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
      expect(model.pricing?.input.perMillionTokens).toBe(5) // From incoming (alwaysOverwrite)
    })

    it('should handle new models with uppercase IDs', () => {
      const existing: ModelConfig[] = []
      const incoming: ModelConfig[] = [
        {
          id: 'NEW-MODEL',
          name: 'New Model',
          inputModalities: [MODALITY.TEXT],
          outputModalities: [MODALITY.TEXT],
          contextWindow: 4000
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
          inputModalities: [MODALITY.TEXT],
          outputModalities: [MODALITY.TEXT],
          contextWindow: 8000,
          description: 'Existing model'
        }
      ]

      const incoming: ModelConfig[] = [
        {
          id: 'gpt-4',
          name: 'GPT-4 Incoming',
          inputModalities: [MODALITY.TEXT],
          outputModalities: [MODALITY.TEXT],
          contextWindow: 8000,
          maxOutputTokens: 4096
        },
        {
          id: 'Gpt-4',
          name: 'GPT-4 Another',
          inputModalities: [MODALITY.TEXT],
          outputModalities: [MODALITY.TEXT],
          contextWindow: 8000
        }
      ]

      const result = mergeModelsList(existing, incoming, MergeStrategies.FILL_UNDEFINED)

      // Should only have 1 model after merging (all case variations treated as same model)
      expect(result).toHaveLength(1)
      expect(result[0].id).toBe('gpt-4') // Lowercase
      expect(result[0].description).toBe('Existing model') // Preserved from existing
      expect(result[0].maxOutputTokens).toBe(4096) // Filled from incoming
    })
  })
})
