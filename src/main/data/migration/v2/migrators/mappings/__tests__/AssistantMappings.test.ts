import { describe, expect, it } from 'vitest'

import { transformAssistant } from '../AssistantMappings'

describe('AssistantMappings', () => {
  describe('transformAssistant', () => {
    it('should transform a full assistant record', () => {
      const source = {
        id: 'ast-1',
        name: 'My Assistant',
        prompt: 'You are helpful',
        emoji: '🤖',
        description: 'A test assistant',
        settings: { temperature: 0.7 },
        mcpMode: 'prompt',
        enableWebSearch: true,
        enableMemory: true,
        model: { id: 'gpt-4', provider: 'openai', name: 'GPT-4' },
        defaultModel: { id: 'gpt-3.5', provider: 'openai', name: 'GPT-3.5' },
        mcpServers: [{ id: 'srv-1' }, { id: 'srv-2' }],
        knowledge_bases: [{ id: 'kb-1' }]
      }

      const result = transformAssistant(source)

      expect(result.assistant).toStrictEqual({
        id: 'ast-1',
        name: 'My Assistant',
        prompt: 'You are helpful',
        emoji: '🤖',
        description: 'A test assistant',
        settings: { temperature: 0.7 },
        mcpMode: 'prompt',
        enableWebSearch: true,
        enableMemory: true
      })
      expect(result.models).toStrictEqual([
        { assistantId: 'ast-1', modelId: 'openai::gpt-4', sortOrder: 0 },
        { assistantId: 'ast-1', modelId: 'openai::gpt-3.5', sortOrder: 1 }
      ])
      expect(result.mcpServers).toStrictEqual([
        { assistantId: 'ast-1', mcpServerId: 'srv-1', sortOrder: 0 },
        { assistantId: 'ast-1', mcpServerId: 'srv-2', sortOrder: 1 }
      ])
      expect(result.knowledgeBases).toStrictEqual([{ assistantId: 'ast-1', knowledgeBaseId: 'kb-1', sortOrder: 0 }])
    })

    it('should handle minimal assistant (only required fields)', () => {
      const result = transformAssistant({ id: 'ast-2', name: 'Minimal' })

      expect(result.assistant).toStrictEqual({
        id: 'ast-2',
        name: 'Minimal',
        prompt: null,
        emoji: null,
        description: null,
        settings: null,
        mcpMode: null,
        enableWebSearch: false,
        enableMemory: false
      })
      expect(result.models).toStrictEqual([])
      expect(result.mcpServers).toStrictEqual([])
      expect(result.knowledgeBases).toStrictEqual([])
    })

    it('should default name to "Unnamed Assistant" when missing', () => {
      const result = transformAssistant({ id: 'ast-3' })
      expect(result.assistant.name).toBe('Unnamed Assistant')
    })

    it('should default name to "Unnamed Assistant" when empty', () => {
      const result = transformAssistant({ id: 'ast-3', name: '' })
      expect(result.assistant.name).toBe('Unnamed Assistant')
    })

    it('should deduplicate model IDs when model and defaultModel are the same', () => {
      const model = { id: 'gpt-4', provider: 'openai' }
      const result = transformAssistant({ id: 'ast-4', model, defaultModel: model })
      expect(result.models).toHaveLength(1)
      expect(result.models[0].modelId).toBe('openai::gpt-4')
    })

    it('should skip models with missing provider or id', () => {
      const result = transformAssistant({
        id: 'ast-5',
        model: { id: 'gpt-4' }, // no provider
        defaultModel: { provider: 'openai' } // no id
      })
      expect(result.models).toStrictEqual([])
    })

    it('should filter out mcpServers without id', () => {
      const result = transformAssistant({
        id: 'ast-6',
        mcpServers: [{ id: 'srv-1' }, { id: '' }, { name: 'no-id' }]
      })
      expect(result.mcpServers).toHaveLength(1)
      expect(result.mcpServers[0].mcpServerId).toBe('srv-1')
    })

    it('should filter out knowledge_bases without id', () => {
      const result = transformAssistant({
        id: 'ast-7',
        knowledge_bases: [{ id: 'kb-1' }, { id: '' }, { name: 'no-id' }]
      })
      expect(result.knowledgeBases).toHaveLength(1)
      expect(result.knowledgeBases[0].knowledgeBaseId).toBe('kb-1')
    })

    it('should handle non-array mcpServers and knowledge_bases', () => {
      const result = transformAssistant({
        id: 'ast-8',
        mcpServers: 'not-an-array',
        knowledge_bases: 42
      })
      expect(result.mcpServers).toStrictEqual([])
      expect(result.knowledgeBases).toStrictEqual([])
    })

    it('should handle null and undefined optional fields', () => {
      const result = transformAssistant({
        id: 'ast-9',
        name: 'Test',
        prompt: null,
        emoji: undefined,
        description: null,
        settings: undefined,
        mcpMode: null,
        enableWebSearch: undefined,
        enableMemory: null
      })

      expect(result.assistant.prompt).toBeNull()
      expect(result.assistant.emoji).toBeNull()
      expect(result.assistant.description).toBeNull()
      expect(result.assistant.settings).toBeNull()
      expect(result.assistant.mcpMode).toBeNull()
      expect(result.assistant.enableWebSearch).toBe(false)
      expect(result.assistant.enableMemory).toBe(false)
    })
  })
})
