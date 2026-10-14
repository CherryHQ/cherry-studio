import { beforeEach, describe, expect, it, vi } from 'vitest'

import { AnthropicImporter } from '../AnthropicImporter'

vi.mock('@renderer/i18n/resolver', () => ({
  default: { t: (key: string) => key }
}))

const textMessage = (sender: 'human' | 'assistant', text: string, overrides = {}) => ({
  uuid: `msg-${sender}-${text}`,
  text,
  content: [{ type: 'text', text }],
  sender,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:01.000Z',
  ...overrides
})

const conversation = (overrides = {}) => ({
  uuid: 'conv-1',
  name: 'My Claude Chat',
  summary: '',
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:01:00.000Z',
  chat_messages: [textMessage('human', 'Hello'), textMessage('assistant', 'Hi there')],
  ...overrides
})

describe('AnthropicImporter', () => {
  let importer: AnthropicImporter

  beforeEach(() => {
    importer = new AnthropicImporter()
  })

  describe('metadata', () => {
    it('identifies itself as the Claude importer', () => {
      expect(importer.name).toBe('Claude')
      expect(importer.emoji).toBeTruthy()
    })
  })

  describe('validate', () => {
    it('accepts a valid Claude export array', () => {
      expect(importer.validate(JSON.stringify([conversation()]))).toBe(true)
    })

    it('rejects a conversation object that is not in the exported array format', () => {
      expect(importer.validate(JSON.stringify(conversation()))).toBe(false)
    })

    it('rejects the ChatGPT export format', () => {
      const chatgpt = { title: 'ChatGPT chat', create_time: 1, mapping: {} }
      expect(importer.validate(JSON.stringify([chatgpt]))).toBe(false)
    })

    it('rejects empty arrays and objects missing chat_messages', () => {
      expect(importer.validate('[]')).toBe(false)
      expect(importer.validate(JSON.stringify([{ uuid: 'x', created_at: 'now' }]))).toBe(false)
    })

    it('rejects invalid JSON', () => {
      expect(importer.validate('not json {')).toBe(false)
    })
  })

  describe('parse', () => {
    it('converts a basic text conversation into v2 message parts', async () => {
      const result = await importer.parse(JSON.stringify([conversation()]))

      expect(result.conversations).toHaveLength(1)
      const importedConversation = result.conversations[0]
      expect(importedConversation.name).toBe('My Claude Chat')
      expect(importedConversation.messages).toHaveLength(2)

      const [userMessage, assistantMessage] = importedConversation.messages
      expect(userMessage).toEqual({
        sourceId: 'msg-human-Hello',
        role: 'user',
        parts: [{ type: 'text', text: 'Hello' }]
      })
      expect(assistantMessage.role).toBe('assistant')
      expect(assistantMessage.parts).toEqual([{ type: 'text', text: 'Hi there' }])
      expect(assistantMessage.model).toMatchObject({ provider: 'anthropic', id: 'claude-sonnet-4-6' })
    })

    it('keeps text content blocks separate and ignores the flat text field', async () => {
      const result = await importer.parse(
        JSON.stringify([
          conversation({
            chat_messages: [
              {
                uuid: 'm1',
                text: 'flat fallback',
                content: [
                  { type: 'text', text: 'block one' },
                  { type: 'text', text: 'block two' }
                ],
                sender: 'human',
                created_at: '2026-01-01T00:00:00.000Z',
                updated_at: '2026-01-01T00:00:00.000Z'
              }
            ]
          })
        ])
      )

      expect(result.conversations[0].messages[0].parts).toEqual([
        { type: 'text', text: 'block one' },
        { type: 'text', text: 'block two' }
      ])
    })

    it('falls back to the flat text field when there are no text content blocks', async () => {
      const result = await importer.parse(
        JSON.stringify([
          conversation({
            chat_messages: [
              {
                uuid: 'm1',
                text: 'flat fallback',
                content: [],
                sender: 'human',
                created_at: '2026-01-01T00:00:00.000Z',
                updated_at: '2026-01-01T00:00:00.000Z'
              }
            ]
          })
        ])
      )

      expect(result.conversations[0].messages[0].parts).toEqual([{ type: 'text', text: 'flat fallback' }])
    })

    it('builds ordered reasoning, text, and tool parts', async () => {
      const assistant = {
        uuid: 'a1',
        text: '',
        sender: 'assistant' as const,
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:05.000Z',
        content: [
          {
            type: 'thinking',
            thinking: 'Let me reason about this',
            start_timestamp: '2026-01-01T00:00:00.000Z',
            stop_timestamp: '2026-01-01T00:00:02.000Z'
          },
          { type: 'text', text: 'I will search first' },
          { type: 'tool_use', id: 'tool-1', name: 'web_search', input: { query: 'cherry studio' } },
          {
            type: 'tool_result',
            tool_use_id: 'tool-1',
            content: [{ type: 'text', text: 'search result text' }]
          },
          { type: 'text', text: 'Here is the answer' }
        ]
      }
      const result = await importer.parse(
        JSON.stringify([conversation({ chat_messages: [textMessage('human', 'Question'), assistant] })])
      )

      expect(result.conversations[0].messages[1].parts).toEqual([
        {
          type: 'reasoning',
          text: 'Let me reason about this',
          state: 'done',
          providerMetadata: { cherry: { thinkingMs: 2000 } }
        },
        { type: 'text', text: 'I will search first' },
        {
          type: 'dynamic-tool',
          toolCallId: 'tool-1',
          toolName: 'web_search',
          input: { query: 'cherry studio' },
          state: 'output-available',
          output: 'search result text'
        },
        { type: 'text', text: 'Here is the answer' }
      ])
    })

    it('pairs anonymous tool calls with their results and preserves errors', async () => {
      const assistant = {
        uuid: 'a1',
        text: '',
        sender: 'assistant' as const,
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
        content: [
          { type: 'tool_use', id: null, name: 'broken', input: {} },
          { type: 'tool_result', tool_use_id: null, is_error: true, content: [{ type: 'text', text: 'boom' }] }
        ]
      }
      const result = await importer.parse(
        JSON.stringify([conversation({ chat_messages: [textMessage('human', 'Q'), assistant] })])
      )

      expect(result.conversations[0].messages[1].parts).toEqual([
        {
          type: 'dynamic-tool',
          toolCallId: 'a1-tool-0',
          toolName: 'broken',
          input: {},
          state: 'output-error',
          errorText: 'boom'
        }
      ])
    })

    it('preserves consecutive same-sender messages', async () => {
      const result = await importer.parse(
        JSON.stringify([
          conversation({
            chat_messages: [
              textMessage('human', 'first'),
              textMessage('human', 'second'),
              textMessage('assistant', 'reply')
            ]
          })
        ])
      )

      expect(result.conversations[0].messages.map((message) => message.role)).toEqual(['user', 'user', 'assistant'])
      expect(result.conversations[0].messages[0].parts).toEqual([{ type: 'text', text: 'first' }])
      expect(result.conversations[0].messages[1].parts).toEqual([{ type: 'text', text: 'second' }])
    })

    it('preserves every branch and selects the latest exported leaf', async () => {
      const result = await importer.parse(
        JSON.stringify([
          conversation({
            chat_messages: [
              textMessage('human', 'question', { uuid: 'user-1', parent_message_uuid: 'export-root' }),
              textMessage('assistant', 'answer', { uuid: 'assistant-1', parent_message_uuid: 'user-1' }),
              textMessage('human', 'first follow-up', { uuid: 'user-2a', parent_message_uuid: 'assistant-1' }),
              textMessage('human', 'edited follow-up', { uuid: 'user-2b', parent_message_uuid: 'assistant-1' })
            ]
          })
        ])
      )

      const importedConversation = result.conversations[0]
      expect(importedConversation.activeSourceId).toBe('user-2b')
      expect(
        importedConversation.messages.map(({ sourceId, parentSourceId }) => ({ sourceId, parentSourceId }))
      ).toEqual([
        { sourceId: 'user-1', parentSourceId: undefined },
        { sourceId: 'assistant-1', parentSourceId: 'user-1' },
        { sourceId: 'user-2a', parentSourceId: 'assistant-1' },
        { sourceId: 'user-2b', parentSourceId: 'assistant-1' }
      ])
    })

    it('drops messages with no usable content', async () => {
      const result = await importer.parse(
        JSON.stringify([
          conversation({
            chat_messages: [
              textMessage('human', 'hello'),
              { uuid: 'empty', text: '', content: [], sender: 'assistant', created_at: 'x', updated_at: 'x' }
            ]
          })
        ])
      )

      expect(result.conversations[0].messages).toHaveLength(1)
      expect(result.conversations[0].messages[0].role).toBe('user')
    })

    it('falls back to summary, then untitled key, for the conversation name', async () => {
      const withSummary = conversation({ name: '', summary: 'A summary', chat_messages: [textMessage('human', 'hi')] })
      const noTitle = conversation({ name: '', summary: '', chat_messages: [textMessage('human', 'hi')] })

      const first = await importer.parse(JSON.stringify([withSummary]))
      expect(first.conversations[0].name).toBe('A summary')

      const second = await importer.parse(JSON.stringify([noTitle]))
      expect(second.conversations[0].name).toBe('import.claude.untitled_conversation')
    })

    it('imports multiple conversations separately', async () => {
      const result = await importer.parse(JSON.stringify([conversation(), conversation({ uuid: 'conv-2' })]))
      expect(result.conversations).toHaveLength(2)
    })

    it('throws when there are no conversations', async () => {
      await expect(importer.parse('[]')).rejects.toThrow('import.claude.error.no_conversations')
    })

    it('throws when no conversation has usable content', async () => {
      const empty = conversation({ chat_messages: [{ uuid: 'e', text: '', content: [], sender: 'human' }] })
      await expect(importer.parse(JSON.stringify([empty]))).rejects.toThrow(
        'import.claude.error.no_valid_conversations'
      )
    })
  })
})
