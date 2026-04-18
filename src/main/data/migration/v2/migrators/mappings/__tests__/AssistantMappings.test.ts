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
        modelId: 'openai::gpt-4',
        settings: { temperature: 0.7, mcpMode: 'prompt', enableWebSearch: true }
      })
      expect(result.mcpServers).toStrictEqual([
        { assistantId: 'ast-1', mcpServerId: 'srv-1' },
        { assistantId: 'ast-1', mcpServerId: 'srv-2' }
      ])
      expect(result.knowledgeBases).toStrictEqual([{ assistantId: 'ast-1', knowledgeBaseId: 'kb-1' }])
    })

    it('should handle minimal assistant (only required fields)', () => {
      const result = transformAssistant({ id: 'ast-2', name: 'Minimal' })

      expect(result.assistant).toStrictEqual({
        id: 'ast-2',
        name: 'Minimal',
        prompt: null,
        emoji: null,
        description: null,
        modelId: null,
        settings: null
      })
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

    it('should prefer model over defaultModel for primary modelId', () => {
      const result = transformAssistant({
        id: 'ast-4',
        model: { id: 'gpt-4', provider: 'openai' },
        defaultModel: { id: 'gpt-3.5', provider: 'openai' }
      })
      expect(result.assistant.modelId).toBe('openai::gpt-4')
    })

    it('should fall back to defaultModel when model is missing', () => {
      const result = transformAssistant({
        id: 'ast-4b',
        defaultModel: { id: 'gpt-3.5', provider: 'openai' }
      })
      expect(result.assistant.modelId).toBe('openai::gpt-3.5')
    })

    it('should set modelId to null when model has missing provider or id', () => {
      const result = transformAssistant({
        id: 'ast-5',
        model: { id: 'gpt-4' }, // no provider
        defaultModel: { provider: 'openai' } // no id
      })
      expect(result.assistant.modelId).toBeNull()
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
        mcpServers: 'not-an-array' as any,
        knowledge_bases: 42 as any
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
        enableWebSearch: undefined
      })

      expect(result.assistant.prompt).toBeNull()
      expect(result.assistant.emoji).toBeNull()
      expect(result.assistant.description).toBeNull()
      // mcpMode/enableWebSearch are merged into settings
      expect(result.assistant.settings).toBeNull()
      expect(result.tags).toStrictEqual([])
    })

    it('should extract valid tags and filter invalid entries', () => {
      const result = transformAssistant({
        id: 'ast-10',
        tags: ['work', '', 'coding', null as any, 42 as any, 'personal']
      })
      expect(result.tags).toStrictEqual(['work', 'coding', 'personal'])
    })

    it('should return empty tags when tags is not an array', () => {
      const result = transformAssistant({ id: 'ast-11', tags: 'not-an-array' as any })
      expect(result.tags).toStrictEqual([])
    })

    it('should return empty tags when tags is null or undefined', () => {
      expect(transformAssistant({ id: 'ast-12', tags: null }).tags).toStrictEqual([])
      expect(transformAssistant({ id: 'ast-13' }).tags).toStrictEqual([])
    })

    it('should build settings from top-level fields when settings object is absent', () => {
      const result = transformAssistant({
        id: 'ast-14',
        mcpMode: 'auto',
        enableWebSearch: true
      })
      expect(result.assistant.settings).toStrictEqual({ mcpMode: 'auto', enableWebSearch: true })
    })
  })
})
