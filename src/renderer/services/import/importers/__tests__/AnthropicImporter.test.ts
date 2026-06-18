import {
  AssistantMessageStatus,
  MessageBlockStatus,
  MessageBlockType,
  type ToolMessageBlock,
  UserMessageStatus
} from '@renderer/types/newMessage'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { AnthropicImporter } from '../AnthropicImporter'

// i18n is not globally mocked for renderer tests — stub it to echo keys so
// titles/error messages are deterministic.
vi.mock('@renderer/i18n', () => ({
  default: { t: (key: string) => key }
}))

// Provide a deterministic, collision-free uuid without loading the heavy
// @renderer/utils barrel.
vi.mock('@renderer/utils', () => {
  let counter = 0
  return { uuid: () => `uuid-${++counter}` }
})

const ASSISTANT_ID = 'assistant-1'

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

    it('accepts a single conversation object (not wrapped in an array)', () => {
      expect(importer.validate(JSON.stringify(conversation()))).toBe(true)
    })

    it('rejects the ChatGPT export format (has "mapping")', () => {
      const chatgpt = { uuid: 'x', created_at: 'now', chat_messages: [], mapping: {} }
      expect(importer.validate(JSON.stringify([chatgpt]))).toBe(false)
    })

    it('rejects objects missing chat_messages', () => {
      expect(importer.validate(JSON.stringify([{ uuid: 'x', created_at: 'now' }]))).toBe(false)
    })

    it('rejects invalid JSON', () => {
      expect(importer.validate('not json {')).toBe(false)
    })
  })

  describe('parse', () => {
    it('converts a basic text conversation into a topic with messages and blocks', async () => {
      const result = await importer.parse(JSON.stringify([conversation()]), ASSISTANT_ID)

      expect(result.topics).toHaveLength(1)
      expect(result.messages).toHaveLength(2)
      expect(result.blocks).toHaveLength(2)

      const topic = result.topics[0]
      expect(topic.assistantId).toBe(ASSISTANT_ID)
      expect(topic.name).toBe('My Claude Chat')
      expect(topic.isNameManuallyEdited).toBe(true)
      expect(topic.messages).toHaveLength(2)

      const [userMsg, assistantMsg] = result.messages
      expect(userMsg.role).toBe('user')
      expect(userMsg.status).toBe(UserMessageStatus.SUCCESS)
      expect(userMsg.model).toBeUndefined()

      expect(assistantMsg.role).toBe('assistant')
      expect(assistantMsg.status).toBe(AssistantMessageStatus.SUCCESS)
      // Anthropic exports carry no model field; assistant messages are tagged
      // with a default Claude model so the logo renders.
      expect(assistantMsg.model?.provider).toBe('anthropic')
      expect(assistantMsg.model?.id).toBe('claude-sonnet-4-6')

      // Every message references its own block(s) and all blocks are MAIN_TEXT here.
      expect(result.blocks.every((b) => b.type === MessageBlockType.MAIN_TEXT)).toBe(true)
      const mainBlock = result.blocks.find((b) => b.messageId === userMsg.id)
      expect(mainBlock).toBeDefined()
      expect((mainBlock as any).content).toBe('Hello')
    })

    it('prefers text content blocks over the flat text field', async () => {
      const conv = conversation({
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
      const result = await importer.parse(JSON.stringify([conv]), ASSISTANT_ID)
      expect((result.blocks[0] as any).content).toBe('block one\n\nblock two')
    })

    it('falls back to the flat text field when there are no text content blocks', async () => {
      const conv = conversation({
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
      const result = await importer.parse(JSON.stringify([conv]), ASSISTANT_ID)
      expect((result.blocks[0] as any).content).toBe('flat fallback')
    })

    it('builds thinking and tool blocks alongside the main text', async () => {
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
          { type: 'tool_use', id: 'tool-1', name: 'web_search', input: { query: 'cherry studio' } },
          {
            type: 'tool_result',
            tool_use_id: 'tool-1',
            content: [{ type: 'text', text: 'search result text' }]
          },
          { type: 'text', text: 'Here is the answer' }
        ]
      }
      const conv = conversation({ chat_messages: [textMessage('human', 'Question'), assistant] })

      const result = await importer.parse(JSON.stringify([conv]), ASSISTANT_ID)

      const assistantMsg = result.messages.find((m) => m.role === 'assistant')!
      const assistantBlocks = result.blocks.filter((b) => b.messageId === assistantMsg.id)

      const thinking = assistantBlocks.find((b) => b.type === MessageBlockType.THINKING)
      expect(thinking).toBeDefined()
      expect((thinking as any).content).toBe('Let me reason about this')
      expect((thinking as any).thinking_millsec).toBe(2000)

      const tool = assistantBlocks.find((b) => b.type === MessageBlockType.TOOL)
      expect(tool).toBeDefined()
      expect(tool!.toolId).toBe('tool-1')
      expect(tool!.toolName).toBe('web_search')
      expect(tool!.arguments).toEqual({ query: 'cherry studio' })
      expect(tool!.content).toBe('search result text')
      expect(tool!.status).toBe(MessageBlockStatus.SUCCESS)
      expect(tool!.metadata?.rawMcpToolResponse?.tool.name).toBe('web_search')
      expect(tool!.metadata?.rawMcpToolResponse?.status).toBe('done')

      const main = assistantBlocks.find((b) => b.type === MessageBlockType.MAIN_TEXT)
      expect((main as any).content).toBe('Here is the answer')

      // All three block ids are referenced by the message in order.
      expect(assistantMsg.blocks).toEqual(assistantBlocks.map((b) => b.id))
    })

    it('marks tool blocks as errored when the tool_result has is_error', async () => {
      const assistant = {
        uuid: 'a1',
        text: '',
        sender: 'assistant' as const,
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
        content: [
          { type: 'tool_use', id: 'tool-err', name: 'broken', input: {} },
          { type: 'tool_result', tool_use_id: 'tool-err', is_error: true, content: [{ type: 'text', text: 'boom' }] }
        ]
      }
      const conv = conversation({ chat_messages: [textMessage('human', 'Q'), assistant] })
      const result = await importer.parse(JSON.stringify([conv]), ASSISTANT_ID)
      const tool = result.blocks.find((b) => b.type === MessageBlockType.TOOL) as ToolMessageBlock
      expect(tool.status).toBe(MessageBlockStatus.ERROR)
    })

    it('collapses consecutive same-sender messages, keeping the last of each run', async () => {
      const conv = conversation({
        chat_messages: [
          textMessage('human', 'first'),
          textMessage('human', 'second'),
          textMessage('assistant', 'reply')
        ]
      })
      const result = await importer.parse(JSON.stringify([conv]), ASSISTANT_ID)

      expect(result.messages).toHaveLength(2)
      const [firstMsg, secondMsg] = result.messages
      expect(firstMsg.role).toBe('user')
      const firstBlock = result.blocks.find((b) => b.messageId === firstMsg.id)
      expect((firstBlock as any).content).toBe('second')
      expect(secondMsg.role).toBe('assistant')
    })

    it('drops messages with no usable content', async () => {
      const conv = conversation({
        chat_messages: [
          textMessage('human', 'hello'),
          { uuid: 'empty', text: '', content: [], sender: 'assistant', created_at: 'x', updated_at: 'x' }
        ]
      })
      const result = await importer.parse(JSON.stringify([conv]), ASSISTANT_ID)
      expect(result.messages).toHaveLength(1)
      expect(result.messages[0].role).toBe('user')
    })

    it('falls back to summary, then untitled key, for the topic title', async () => {
      const withSummary = conversation({ name: '', summary: 'A summary', chat_messages: [textMessage('human', 'hi')] })
      const noTitle = conversation({ name: '', summary: '', chat_messages: [textMessage('human', 'hi')] })

      const r1 = await importer.parse(JSON.stringify([withSummary]), ASSISTANT_ID)
      expect(r1.topics[0].name).toBe('A summary')
      expect(r1.topics[0].isNameManuallyEdited).toBe(false)

      const r2 = await importer.parse(JSON.stringify([noTitle]), ASSISTANT_ID)
      expect(r2.topics[0].name).toBe('import.claude.untitled_conversation')
      expect(r2.topics[0].isNameManuallyEdited).toBe(false)
    })

    it('imports multiple conversations into separate topics', async () => {
      const result = await importer.parse(
        JSON.stringify([conversation(), conversation({ uuid: 'conv-2' })]),
        ASSISTANT_ID
      )
      expect(result.topics).toHaveLength(2)
    })

    it('throws when there are no conversations', async () => {
      await expect(importer.parse('[]', ASSISTANT_ID)).rejects.toThrow('import.claude.error.no_conversations')
    })

    it('throws when no conversation has usable content', async () => {
      const empty = conversation({ chat_messages: [{ uuid: 'e', text: '', content: [], sender: 'human' }] })
      await expect(importer.parse(JSON.stringify([empty]), ASSISTANT_ID)).rejects.toThrow(
        'import.claude.error.no_valid_conversations'
      )
    })
  })
})
