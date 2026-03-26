import { terminalApps } from '@shared/config/constant'
import { describe, expect, it } from 'vitest'

import { transformCodeCli, transformCodeCliToOverrides, transformSelectedModelsToIds } from '../CodeCliTransforms'

describe('CodeCliTransforms', () => {
  describe('transformSelectedModelsToIds', () => {
    it('should build composite providerId::modelId from full Model objects', () => {
      const selectedModels = {
        'qwen-code': { id: 'model-1', provider: 'openai', name: 'GPT-4', group: 'default' },
        'claude-code': { id: 'model-2', provider: 'anthropic', name: 'Claude', group: 'default' },
        'gemini-cli': null
      }

      const result = transformSelectedModelsToIds(selectedModels)
      expect(result).toEqual({
        'qwen-code': 'openai::model-1',
        'claude-code': 'anthropic::model-2',
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

    it('should return null for models without id field', () => {
      const selectedModels = {
        'qwen-code': { name: 'No ID Model', provider: 'test', group: 'default' },
        'claude-code': { id: 'valid-id', provider: 'anthropic', name: 'Claude', group: 'default' }
      }

      const result = transformSelectedModelsToIds(selectedModels as Record<string, unknown>)
      expect(result).toEqual({
        'qwen-code': null,
        'claude-code': 'anthropic::valid-id'
      })
    })

    it('should return null for models without provider field', () => {
      const selectedModels = {
        'qwen-code': { id: 'model-1', name: 'No Provider' },
        'claude-code': { id: 'model-2', provider: 'anthropic' }
      }

      const result = transformSelectedModelsToIds(selectedModels as Record<string, unknown>)
      expect(result).toEqual({
        'qwen-code': null,
        'claude-code': 'anthropic::model-2'
      })
    })

    it('should handle non-object model values gracefully', () => {
      const selectedModels = {
        'qwen-code': 'string-value',
        'claude-code': 42,
        'gemini-cli': { id: 'valid', provider: 'test', name: 'Test', group: 'default' }
      }

      const result = transformSelectedModelsToIds(selectedModels as Record<string, unknown>)
      expect(result).toEqual({
        'qwen-code': null,
        'claude-code': null,
        'gemini-cli': 'test::valid'
      })
    })

    it('should skip invalid tool IDs', () => {
      const selectedModels = {
        'qwen-code': { id: 'model-1', provider: 'openai' },
        'unknown-tool': { id: 'model-2', provider: 'test' }
      }

      const result = transformSelectedModelsToIds(selectedModels)
      expect(result).toEqual({
        'qwen-code': 'openai::model-1'
      })
      expect(result).not.toHaveProperty('unknown-tool')
    })
  })

  describe('transformCodeCliToOverrides', () => {
    it('should set enabled: true on the selected tool and merge per-tool data', () => {
      const result = transformCodeCliToOverrides({
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
          modelId: 'openai::model-1',
          envVars: 'KEY=val',
          directories: ['/project-a', '/project-b'],
          currentDirectory: '/project-a'
        }
      })
    })

    it('should skip tools where all fields are default and not selected', () => {
      const result = transformCodeCliToOverrides({
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
      const result = transformCodeCliToOverrides({
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
      const result = transformCodeCliToOverrides({
        selectedModels: {
          'gemini-cli': { id: 'gem-1', provider: 'google', name: 'Gemini', group: 'default' }
        },
        environmentVariables: {},
        directories: [],
        currentDirectory: '',
        selectedCliTool: null
      })

      expect(result).toEqual({
        'gemini-cli': { modelId: 'google::gem-1' }
      })
    })

    it('should include tool override even if only envVars is set', () => {
      const result = transformCodeCliToOverrides({
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
      const result = transformCodeCliToOverrides({
        selectedModels: {
          'qwen-code': { id: 'm1', provider: 'p', name: 'n', group: 'g' }
        },
        environmentVariables: { 'claude-code': 'X=1' },
        directories: ['/dir1'],
        currentDirectory: '/dir1',
        selectedCliTool: 'qwen-code'
      })

      expect(result['qwen-code']?.directories).toEqual(['/dir1'])
      expect(result['qwen-code']?.currentDirectory).toBe('/dir1')
      expect(result['qwen-code']?.enabled).toBe(true)

      expect(result['claude-code']?.directories).toBeUndefined()
      expect(result['claude-code']?.currentDirectory).toBeUndefined()
      expect(result['claude-code']?.enabled).toBeUndefined()
    })

    it('should create override with enabled: true for selected tool even if no model/env set', () => {
      const result = transformCodeCliToOverrides({
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
      const result = transformCodeCliToOverrides({
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
      const result = transformCodeCliToOverrides({
        selectedModels: {},
        environmentVariables: {},
        directories: [],
        currentDirectory: '',
        selectedCliTool: 'claude-code',
        selectedTerminal: terminalApps.systemDefault
      })

      expect(result).toEqual({
        'claude-code': { enabled: true }
      })
    })

    it('should handle selected tool with all customizations', () => {
      const result = transformCodeCliToOverrides({
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
          modelId: 'anthropic::claude-4',
          envVars: 'API_KEY=xxx',
          directories: ['/work', '/home'],
          currentDirectory: '/work',
          terminal: 'Warp'
        }
      })
    })

    it('should filter out invalid tool IDs from models and env vars', () => {
      const result = transformCodeCliToOverrides({
        selectedModels: {
          'qwen-code': { id: 'model-1', provider: 'openai' },
          'invalid-tool': { id: 'model-2', provider: 'test' }
        },
        environmentVariables: { 'another-invalid': 'KEY=val' },
        directories: [],
        currentDirectory: '',
        selectedCliTool: null
      })

      expect(result).toEqual({
        'qwen-code': { modelId: 'openai::model-1' }
      })
      expect(result).not.toHaveProperty('invalid-tool')
      expect(result).not.toHaveProperty('another-invalid')
    })

    it('should ignore selected tool if it is not a valid CLI ID', () => {
      const result = transformCodeCliToOverrides({
        selectedModels: {},
        environmentVariables: {},
        directories: ['/project'],
        currentDirectory: '/project',
        selectedCliTool: 'nonexistent-tool'
      })

      expect(result).toEqual({})
    })
  })

  describe('transformCodeCli (TransformFunction wrapper)', () => {
    it('should return result keyed by feature.code_cli.overrides', () => {
      const result = transformCodeCli({
        selectedModels: {
          'claude-code': { id: 'claude-4', provider: 'anthropic', name: 'Claude', group: 'default' }
        },
        environmentVariables: { 'claude-code': 'API_KEY=xxx' },
        directories: ['/work'],
        currentDirectory: '/work',
        selectedCliTool: 'claude-code',
        selectedTerminal: 'Warp'
      })

      expect(result).toEqual({
        'feature.code_cli.overrides': {
          'claude-code': {
            enabled: true,
            modelId: 'anthropic::claude-4',
            envVars: 'API_KEY=xxx',
            directories: ['/work'],
            currentDirectory: '/work',
            terminal: 'Warp'
          }
        }
      })
    })

    it('should return empty overrides when all sources are missing', () => {
      const result = transformCodeCli({})
      expect(result).toEqual({ 'feature.code_cli.overrides': {} })
    })

    it('should handle realistic migration input with multiple tools', () => {
      const result = transformCodeCli({
        selectedModels: {
          'qwen-code': { id: 'qwen-2.5', provider: 'alibaba' },
          'claude-code': { id: 'claude-4', provider: 'anthropic' },
          'gemini-cli': null
        },
        environmentVariables: {
          'qwen-code': 'DASHSCOPE_API_KEY=sk-xxx',
          'claude-code': '',
          'gemini-cli': 'GEMINI_API_KEY=key123'
        },
        directories: ['/home/user/projects'],
        currentDirectory: '/home/user/projects',
        selectedCliTool: 'claude-code',
        selectedTerminal: 'iTerm2'
      })

      const overrides = result['feature.code_cli.overrides'] as Record<string, unknown>
      expect(overrides['qwen-code']).toEqual({
        modelId: 'alibaba::qwen-2.5',
        envVars: 'DASHSCOPE_API_KEY=sk-xxx'
      })
      expect(overrides['claude-code']).toEqual({
        enabled: true,
        modelId: 'anthropic::claude-4',
        directories: ['/home/user/projects'],
        currentDirectory: '/home/user/projects',
        terminal: 'iTerm2'
      })
      expect(overrides['gemini-cli']).toEqual({ envVars: 'GEMINI_API_KEY=key123' })
    })
  })
})
