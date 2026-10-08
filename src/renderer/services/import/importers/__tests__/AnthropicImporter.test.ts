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

// The claude.ai API response that browser-extension exporters dump: a single
// conversation object whose messages always leave the flattened `text` empty.
const ROOT_SENTINEL = '00000000-0000-4000-8000-000000000000'

const apiMessage = (sender: 'human' | 'assistant', uuid: string, text: string, overrides = {}) => ({
  uuid,
  text: '',
  content: [{ type: 'text', text }],
  sender,
  index: 0,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:01.000Z',
  truncated: false,
  attachments: [],
  files: [],
  files_v2: [],
  sync_sources: [],
  parent_message_uuid: ROOT_SENTINEL,
  ...overrides
})

const apiConversation = (overrides = {}) => ({
  uuid: 'api-conv-1',
  name: 'API Export Chat',
  summary: '',
  model: 'claude-sonnet-4-5-20250929',
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:01:00.000Z',
  settings: {},
  is_starred: false,
  is_temporary: false,
  platform: 'web',
  current_leaf_message_uuid: 'api-assistant-1',
  chat_messages: [
    apiMessage('human', 'api-user-1', 'What is the capital of France?'),
    apiMessage('assistant', 'api-assistant-1', 'Paris.', { parent_message_uuid: 'api-user-1' })
  ],
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

    it('accepts a single conversation object, as browser-extension exporters emit', () => {
      expect(importer.validate(JSON.stringify(conversation()))).toBe(true)
      expect(importer.validate(JSON.stringify(apiConversation()))).toBe(true)
    })

    it('rejects single objects that are not Claude conversations', () => {
      expect(importer.validate(JSON.stringify({ title: 'ChatGPT chat', create_time: 1, mapping: {} }))).toBe(false)
      expect(importer.validate(JSON.stringify({ uuid: 'x', created_at: 'now' }))).toBe(false)
      expect(importer.validate(JSON.stringify({ hello: 'world' }))).toBe(false)
      expect(importer.validate('null')).toBe(false)
      expect(importer.validate('42')).toBe(false)
      expect(importer.validate('"a string"')).toBe(false)
    })

    it('rejects unrelated JSON whose chat_messages entries are not Claude messages', () => {
      const lookalike = {
        uuid: 'batch-7',
        created_at: '2026-01-01T00:00:00.000Z',
        chat_messages: [{ id: 1, body: 'not a claude message' }]
      }
      expect(importer.validate(JSON.stringify(lookalike))).toBe(false)
      expect(importer.validate(JSON.stringify([lookalike]))).toBe(false)
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

  describe('parse (API-style exports)', () => {
    it('imports messages whose text lives only in content blocks', async () => {
      const result = await importer.parse(JSON.stringify(apiConversation()))

      const importedConversation = result.conversations[0]
      expect(importedConversation.name).toBe('API Export Chat')
      expect(importedConversation.messages).toHaveLength(2)

      const [userMessage, assistantMessage] = importedConversation.messages
      expect(userMessage.role).toBe('user')
      expect(userMessage.parts).toEqual([{ type: 'text', text: 'What is the capital of France?' }])
      expect(assistantMessage.role).toBe('assistant')
      expect(assistantMessage.parts).toEqual([{ type: 'text', text: 'Paris.' }])
    })

    it('parses the array form of an API-style export', async () => {
      const result = await importer.parse(JSON.stringify([apiConversation(), apiConversation({ uuid: 'api-conv-2' })]))
      expect(result.conversations).toHaveLength(2)
      expect(result.conversations[0].messages).toHaveLength(2)
    })

    it('tolerates messages missing the text and content fields', async () => {
      const result = await importer.parse(
        JSON.stringify(
          apiConversation({
            current_leaf_message_uuid: undefined,
            chat_messages: [
              apiMessage('human', 'q1', 'What is the capital of France?'),
              { uuid: 'partial', sender: 'assistant', parent_message_uuid: 'q1' }
            ]
          })
        )
      )

      expect(result.conversations[0].messages.map((message) => message.sourceId)).toEqual(['q1'])
    })

    it('keeps tool-only turns with an omitted text key and skips text blocks missing their text', async () => {
      const result = await importer.parse(
        JSON.stringify(
          apiConversation({
            current_leaf_message_uuid: undefined,
            chat_messages: [
              apiMessage('human', 'q1', 'What is the capital of France?'),
              {
                uuid: 'tool-turn',
                sender: 'assistant',
                parent_message_uuid: 'q1',
                content: [
                  { type: 'text' }, // malformed block without a text property
                  { type: 'tool_use', id: 'call-1', name: 'lookup', input: { q: 'capital' } }
                ]
              }
            ]
          })
        )
      )

      const messages = result.conversations[0].messages
      expect(messages.map((message) => message.sourceId)).toEqual(['q1', 'tool-turn'])
      expect(messages[1].parts).toEqual([
        {
          type: 'dynamic-tool',
          toolCallId: 'call-1',
          toolName: 'lookup',
          input: { q: 'capital' },
          state: 'input-available'
        }
      ])
    })

    it('honors current_leaf_message_uuid when the active leaf is not the last exported message', async () => {
      const result = await importer.parse(
        JSON.stringify(
          apiConversation({
            current_leaf_message_uuid: 'reply-a',
            chat_messages: [
              apiMessage('human', 'q1', 'What is the capital of France?'),
              apiMessage('assistant', 'reply-a', 'Paris.', { parent_message_uuid: 'q1' }),
              apiMessage('assistant', 'reply-b', 'The capital is Paris.', { parent_message_uuid: 'q1' })
            ]
          })
        )
      )

      const importedConversation = result.conversations[0]
      expect(importedConversation.activeSourceId).toBe('reply-a')
      // The root sentinel is not an exported message, so it resolves to no parent
      expect(
        importedConversation.messages.map(({ sourceId, parentSourceId }) => ({ sourceId, parentSourceId }))
      ).toEqual([
        { sourceId: 'q1', parentSourceId: undefined },
        { sourceId: 'reply-a', parentSourceId: 'q1' },
        { sourceId: 'reply-b', parentSourceId: 'q1' }
      ])
    })

    it('walks up to the nearest usable ancestor when the active leaf was filtered out', async () => {
      const result = await importer.parse(
        JSON.stringify(
          apiConversation({
            current_leaf_message_uuid: 'empty-leaf',
            chat_messages: [
              apiMessage('human', 'q1', 'What is the capital of France?'),
              apiMessage('assistant', 'a1', 'Paris.', { parent_message_uuid: 'q1' }),
              apiMessage('human', 'empty-leaf', '   ', { parent_message_uuid: 'a1' })
            ]
          })
        )
      )

      expect(result.conversations[0].messages.map((message) => message.sourceId)).toEqual(['q1', 'a1'])
      expect(result.conversations[0].activeSourceId).toBe('a1')
    })

    it('survives cyclic parent pointers in malformed exports instead of hanging', async () => {
      const result = await importer.parse(
        JSON.stringify(
          apiConversation({
            current_leaf_message_uuid: 'cycle-a',
            chat_messages: [
              apiMessage('human', 'cycle-a', '   ', { parent_message_uuid: 'cycle-b' }),
              apiMessage('assistant', 'cycle-b', '   ', { parent_message_uuid: 'cycle-a' }),
              apiMessage('human', 'q1', 'What is the capital of France?', { parent_message_uuid: 'cycle-a' }),
              apiMessage('assistant', 'a1', 'Paris.', { parent_message_uuid: 'q1' })
            ]
          })
        )
      )

      const conversation = result.conversations[0]
      expect(conversation.messages.map((message) => message.sourceId)).toEqual(['q1', 'a1'])
      // q1's parent chain enters the cycle and resolves to a root, not a dangling id
      expect(conversation.messages[0].parentSourceId).toBeUndefined()
      // the leaf pointer into the cycle falls back to export order
      expect(conversation.activeSourceId).toBe('a1')
    })

    it('falls back to the last exported message for missing or unknown leaf pointers', async () => {
      const withoutPointer = await importer.parse(
        JSON.stringify(apiConversation({ current_leaf_message_uuid: undefined }))
      )
      expect(withoutPointer.conversations[0].activeSourceId).toBe('api-assistant-1')

      const danglingPointer = await importer.parse(
        JSON.stringify(apiConversation({ current_leaf_message_uuid: 'not-in-this-export' }))
      )
      expect(danglingPointer.conversations[0].activeSourceId).toBe('api-assistant-1')
    })

    it.each([
      ['claude-3-5-sonnet-20241022', 'Claude 3.5 Sonnet', 'Claude 3.5'],
      ['claude-3-opus-20240229', 'Claude 3 Opus', 'Claude 3'],
      ['claude-opus-4-1-20250805', 'Claude Opus 4.1', 'Claude 4.1'],
      ['claude-sonnet-4-5-20250929', 'Claude Sonnet 4.5', 'Claude 4.5'],
      ['claude-3-5-haiku-latest', 'Claude 3.5 Haiku', 'Claude 3.5'],
      ['claude-next-9000', 'claude-next-9000', 'Claude']
    ])('preserves the exported model id %s', async (model, name, group) => {
      const result = await importer.parse(JSON.stringify(apiConversation({ model })))

      expect(result.conversations[0].messages[1].model).toEqual({ id: model, provider: 'anthropic', name, group })
      expect(result.conversations[0].messages[0].model).toBeUndefined()
    })

    it('falls back to the default model when the export carries no model id', async () => {
      const defaultModel = {
        id: 'claude-sonnet-4-6',
        provider: 'anthropic',
        name: 'Claude Sonnet 4.6',
        group: 'Claude 4.6'
      }

      const nullModel = await importer.parse(JSON.stringify(apiConversation({ model: null })))
      expect(nullModel.conversations[0].messages[1].model).toEqual(defaultModel)

      const blankModel = await importer.parse(JSON.stringify(apiConversation({ model: '   ' })))
      expect(blankModel.conversations[0].messages[1].model).toEqual(defaultModel)
    })

    it('keeps the default model for official exports, which have no model field', async () => {
      const official = conversation()
      expect('model' in official).toBe(false)

      const result = await importer.parse(JSON.stringify([official]))

      expect(result.conversations[0].messages[1].model).toEqual({
        id: 'claude-sonnet-4-6',
        provider: 'anthropic',
        name: 'Claude Sonnet 4.6',
        group: 'Claude 4.6'
      })
      expect(result.conversations[0].messages[1].parts).toEqual([{ type: 'text', text: 'Hi there' }])
    })
  })
})
