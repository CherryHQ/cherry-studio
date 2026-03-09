import { describe, expect, it } from 'vitest'

import { transformCodeToolsToOverrides, transformSelectedModelsToIds } from '../CodeToolsTransforms'

describe('CodeToolsTransforms', () => {
  describe('transformSelectedModelsToIds', () => {
    it('should extract model IDs from full Model objects', () => {
      const selectedModels = {
        'qwen-code': { id: 'model-1', provider: 'openai', name: 'GPT-4', group: 'default' },
        'claude-code': { id: 'model-2', provider: 'anthropic', name: 'Claude', group: 'default' },
        'gemini-cli': null
      }

      const result = transformSelectedModelsToIds(selectedModels)
      expect(result).toEqual({
        'qwen-code': 'model-1',
        'claude-code': 'model-2',
        'gemini-cli': null
      })
    })

    it('should handle all null models', () => {
      const selectedModels = {
        'qwen-code': null,
        'claude-code': null,
        'gemini-cli': null
      }

      const result = transformSelectedModelsToIds(selectedModels)
      expect(result).toEqual({
        'qwen-code': null,
        'claude-code': null,
        'gemini-cli': null
      })
    })

    it('should handle empty object', () => {
      const result = transformSelectedModelsToIds({})
      expect(result).toEqual({})
    })

    it('should handle undefined/null input', () => {
      expect(transformSelectedModelsToIds(undefined)).toEqual({})
      expect(transformSelectedModelsToIds(null)).toEqual({})
    })

    it('should handle models without id field', () => {
      const selectedModels = {
        'qwen-code': { name: 'No ID Model', provider: 'test', group: 'default' },
        'claude-code': { id: 'valid-id', provider: 'anthropic', name: 'Claude', group: 'default' }
      }

      const result = transformSelectedModelsToIds(selectedModels as any)
      expect(result).toEqual({
        'qwen-code': null,
        'claude-code': 'valid-id'
      })
    })

    it('should handle non-object model values gracefully', () => {
      const selectedModels = {
        'qwen-code': 'string-value',
        'claude-code': 42,
        'gemini-cli': { id: 'valid', provider: 'test', name: 'Test', group: 'default' }
      }

      const result = transformSelectedModelsToIds(selectedModels as any)
      expect(result).toEqual({
        'qwen-code': null,
        'claude-code': null,
        'gemini-cli': 'valid'
      })
    })
  })

  describe('transformCodeToolsToOverrides', () => {
    it('should merge selectedModels and environmentVariables into per-tool overrides', () => {
      const result = transformCodeToolsToOverrides({
        selectedModels: {
          'qwen-code': { id: 'model-1', provider: 'openai', name: 'GPT-4', group: 'default' },
          'claude-code': null
        },
        environmentVariables: {
          'qwen-code': 'KEY=val',
          'claude-code': ''
        },
        directories: ['/project-a', '/project-b'],
        currentDirectory: '/project-a'
      })

      // claude-code has null model and empty env → no override (all defaults)
      // Only qwen-code has non-default values → gets directories too
      expect(result).toEqual({
        'qwen-code': {
          modelId: 'model-1',
          envVars: 'KEY=val',
          directories: ['/project-a', '/project-b'],
          currentDirectory: '/project-a'
        }
      })
    })

    it('should skip tools where all fields are default (null model, empty env)', () => {
      const result = transformCodeToolsToOverrides({
        selectedModels: {
          'qwen-code': null,
          'claude-code': null
        },
        environmentVariables: {
          'qwen-code': '',
          'claude-code': ''
        },
        directories: [],
        currentDirectory: ''
      })

      expect(result).toEqual({})
    })

    it('should handle missing sources gracefully', () => {
      const result = transformCodeToolsToOverrides({
        selectedModels: undefined,
        environmentVariables: undefined,
        directories: undefined,
        currentDirectory: undefined
      })

      expect(result).toEqual({})
    })

    it('should include tool override even if only model is set', () => {
      const result = transformCodeToolsToOverrides({
        selectedModels: {
          'gemini-cli': { id: 'gem-1', provider: 'google', name: 'Gemini', group: 'default' }
        },
        environmentVariables: {},
        directories: [],
        currentDirectory: ''
      })

      expect(result).toEqual({
        'gemini-cli': { modelId: 'gem-1' }
      })
    })

    it('should include tool override even if only envVars is set', () => {
      const result = transformCodeToolsToOverrides({
        selectedModels: {},
        environmentVariables: { opencode: 'API_KEY=123' },
        directories: [],
        currentDirectory: ''
      })

      expect(result).toEqual({
        opencode: { envVars: 'API_KEY=123' }
      })
    })

    it('should assign global directories/currentDirectory to all tools that have other overrides', () => {
      const result = transformCodeToolsToOverrides({
        selectedModels: { 'qwen-code': { id: 'm1', provider: 'p', name: 'n', group: 'g' } },
        environmentVariables: { 'claude-code': 'X=1' },
        directories: ['/dir1'],
        currentDirectory: '/dir1'
      })

      // Both tools that have overrides also get the global dirs
      expect(result['qwen-code']?.directories).toEqual(['/dir1'])
      expect(result['qwen-code']?.currentDirectory).toBe('/dir1')
      expect(result['claude-code']?.directories).toEqual(['/dir1'])
      expect(result['claude-code']?.currentDirectory).toBe('/dir1')
    })

    it('should create override for selectedCliTool even if no model/env set, when dirs exist', () => {
      const result = transformCodeToolsToOverrides({
        selectedModels: { 'qwen-code': null },
        environmentVariables: { 'qwen-code': '' },
        directories: ['/project'],
        currentDirectory: '/project',
        selectedCliTool: 'qwen-code'
      })

      // The selected tool gets dirs even though model/env are default
      expect(result).toEqual({
        'qwen-code': { directories: ['/project'], currentDirectory: '/project' }
      })
    })
  })
})
