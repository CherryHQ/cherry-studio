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
    it('should set enabled: true on the selected tool and merge per-tool data', () => {
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
        currentDirectory: '/project-a',
        selectedCliTool: 'qwen-code'
      })

      expect(result).toEqual({
        'qwen-code': {
          enabled: true,
          modelId: 'model-1',
          envVars: 'KEY=val',
          directories: ['/project-a', '/project-b'],
          currentDirectory: '/project-a'
        }
      })
    })

    it('should skip tools where all fields are default and not selected', () => {
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
        currentDirectory: '',
        selectedCliTool: null
      })

      expect(result).toEqual({})
    })

    it('should handle missing sources gracefully', () => {
      const result = transformCodeToolsToOverrides({
        selectedModels: undefined,
        environmentVariables: undefined,
        directories: undefined,
        currentDirectory: undefined,
        selectedCliTool: undefined,
        selectedTerminal: undefined
      })

      expect(result).toEqual({})
    })

    it('should include tool override even if only model is set (not selected)', () => {
      const result = transformCodeToolsToOverrides({
        selectedModels: {
          'gemini-cli': { id: 'gem-1', provider: 'google', name: 'Gemini', group: 'default' }
        },
        environmentVariables: {},
        directories: [],
        currentDirectory: '',
        selectedCliTool: null
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
        currentDirectory: '',
        selectedCliTool: null
      })

      expect(result).toEqual({
        opencode: { envVars: 'API_KEY=123' }
      })
    })

    it('should assign global dirs only to the selected tool, not all tools with overrides', () => {
      const result = transformCodeToolsToOverrides({
        selectedModels: {
          'qwen-code': { id: 'm1', provider: 'p', name: 'n', group: 'g' }
        },
        environmentVariables: { 'claude-code': 'X=1' },
        directories: ['/dir1'],
        currentDirectory: '/dir1',
        selectedCliTool: 'qwen-code'
      })

      // Selected tool gets dirs
      expect(result['qwen-code']?.directories).toEqual(['/dir1'])
      expect(result['qwen-code']?.currentDirectory).toBe('/dir1')
      expect(result['qwen-code']?.enabled).toBe(true)

      // Non-selected tool does NOT get dirs
      expect(result['claude-code']?.directories).toBeUndefined()
      expect(result['claude-code']?.currentDirectory).toBeUndefined()
      expect(result['claude-code']?.enabled).toBeUndefined()
    })

    it('should create override with enabled: true for selected tool even if no model/env set', () => {
      const result = transformCodeToolsToOverrides({
        selectedModels: { 'qwen-code': null },
        environmentVariables: { 'qwen-code': '' },
        directories: ['/project'],
        currentDirectory: '/project',
        selectedCliTool: 'qwen-code'
      })

      expect(result).toEqual({
        'qwen-code': { enabled: true, directories: ['/project'], currentDirectory: '/project' }
      })
    })

    it('should assign non-default terminal to the selected tool', () => {
      const result = transformCodeToolsToOverrides({
        selectedModels: {},
        environmentVariables: {},
        directories: [],
        currentDirectory: '',
        selectedCliTool: 'claude-code',
        selectedTerminal: 'iTerm'
      })

      expect(result).toEqual({
        'claude-code': { enabled: true, terminal: 'iTerm' }
      })
    })

    it('should NOT include terminal when it is the default value', () => {
      const result = transformCodeToolsToOverrides({
        selectedModels: {},
        environmentVariables: {},
        directories: [],
        currentDirectory: '',
        selectedCliTool: 'claude-code',
        selectedTerminal: 'Terminal'
      })

      expect(result).toEqual({
        'claude-code': { enabled: true }
      })
    })

    it('should handle selected tool with all customizations', () => {
      const result = transformCodeToolsToOverrides({
        selectedModels: {
          'claude-code': { id: 'claude-4', provider: 'anthropic', name: 'Claude', group: 'default' }
        },
        environmentVariables: { 'claude-code': 'API_KEY=xxx' },
        directories: ['/work', '/home'],
        currentDirectory: '/work',
        selectedCliTool: 'claude-code',
        selectedTerminal: 'Warp'
      })

      expect(result).toEqual({
        'claude-code': {
          enabled: true,
          modelId: 'claude-4',
          envVars: 'API_KEY=xxx',
          directories: ['/work', '/home'],
          currentDirectory: '/work',
          terminal: 'Warp'
        }
      })
    })
  })
})
