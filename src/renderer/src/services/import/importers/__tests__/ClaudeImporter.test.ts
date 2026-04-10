import { MessageBlockStatus, MessageBlockType } from '@renderer/types/newMessage'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ClaudeImporter } from '../ClaudeImporter'

const mockState = vi.hoisted(() => ({
  uuidCounter: 0,
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  }
}))

vi.mock('@renderer/i18n', () => ({
  default: {
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key
  }
}))

vi.mock('@renderer/utils', () => ({
  uuid: () => `uuid-${++mockState.uuidCounter}`
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: vi.fn(() => mockState.logger)
  }
}))

type ClaudeContentBlockForTest = {
  type: 'text' | 'thinking' | 'tool_use' | 'tool_result'
  text?: string
  thinking?: string
  name?: string
  input?: Record<string, unknown>
  display_content?: {
    type: string
    code?: string
    language?: string
    filename?: string
    json_block?: string
  }
  content?: unknown
}

type ClaudeMessageForTest = {
  uuid: string
  parent_message_uuid: string | null
  child_message_uuids: string[]
  sender: 'human' | 'assistant'
  content: ClaudeContentBlockForTest[] | null
  created_at: string
}

type ClaudeConversationForTest = {
  uuid: string
  name: string
  model: string | null
  created_at: string
  updated_at: string
  current_leaf_message_uuid: string
  chat_messages: ClaudeMessageForTest[]
}

const assistantId = 'assistant-1'

const stringify = (value: unknown) => JSON.stringify(value)

const cloneConversation = (conversation: ClaudeConversationForTest): ClaudeConversationForTest =>
  JSON.parse(JSON.stringify(conversation)) as ClaudeConversationForTest

const createMessage = (overrides: Partial<ClaudeMessageForTest> = {}): ClaudeMessageForTest => ({
  uuid: 'msg-1',
  parent_message_uuid: null,
  child_message_uuids: [],
  sender: 'human',
  content: [{ type: 'text', text: 'Hello' }],
  created_at: '2025-01-01T00:00:00Z',
  ...overrides
})

const createConversation = (overrides: Partial<ClaudeConversationForTest> = {}): ClaudeConversationForTest => ({
  uuid: 'conv-1',
  name: 'Test Conversation',
  model: 'claude-sonnet-4-20250514',
  created_at: '2025-01-01T00:00:00Z',
  updated_at: '2025-01-01T00:00:00Z',
  current_leaf_message_uuid: 'msg-2',
  chat_messages: [
    createMessage({
      uuid: 'msg-1',
      parent_message_uuid: null,
      child_message_uuids: ['msg-2'],
      sender: 'human',
      content: [{ type: 'text', text: 'Hello' }],
      created_at: '2025-01-01T00:00:00Z'
    }),
    createMessage({
      uuid: 'msg-2',
      parent_message_uuid: 'msg-1',
      child_message_uuids: [],
      sender: 'assistant',
      content: [{ type: 'text', text: 'Hi there!' }],
      created_at: '2025-01-01T00:00:01Z'
    })
  ],
  ...overrides
})

describe('ClaudeImporter', () => {
  let importer: ClaudeImporter

  beforeEach(() => {
    mockState.uuidCounter = 0
    vi.clearAllMocks()
    importer = new ClaudeImporter()
  })

  describe('validate', () => {
    it('accepts a single valid Claude conversation', () => {
      expect(importer.validate(stringify(createConversation()))).toBe(true)
    })

    it('accepts an array of valid Claude conversations', () => {
      const first = createConversation()
      const second = createConversation({
        uuid: 'conv-2',
        name: 'Second Conversation'
      })

      expect(importer.validate(stringify([first, second]))).toBe(true)
    })

    it('rejects ChatGPT mapping format', () => {
      const chatGptExport = {
        title: 'ChatGPT Conversation',
        mapping: {
          msg1: {
            id: 'msg1',
            message: { author: { role: 'user' }, content: { parts: ['Hello'] } }
          }
        }
      }

      expect(importer.validate(stringify(chatGptExport))).toBe(false)
    })

    it('rejects invalid JSON strings', () => {
      expect(importer.validate('{not json')).toBe(false)
    })

    it('rejects non-object JSON values', () => {
      expect(importer.validate(stringify('plain text'))).toBe(false)
      expect(importer.validate(stringify(42))).toBe(false)
      expect(importer.validate(stringify(null))).toBe(false)
      expect(importer.validate(stringify([42]))).toBe(false)
    })
  })

  describe('parse basic conversations', () => {
    it('creates topics, messages, and blocks for human and assistant text messages', async () => {
      const result = await importer.parse(stringify(createConversation()), assistantId)

      expect(result.topics).toHaveLength(1)
      expect(result.messages).toHaveLength(2)
      expect(result.blocks).toHaveLength(2)

      expect(result.topics[0]).toMatchObject({
        id: 'uuid-1',
        assistantId,
        name: 'Test Conversation',
        createdAt: '2025-01-01T00:00:00Z',
        updatedAt: '2025-01-01T00:00:00Z',
        isNameManuallyEdited: true
      })
      expect(result.topics[0].messages).toStrictEqual(result.messages)

      expect(result.messages[0]).toMatchObject({
        id: 'uuid-2',
        role: 'user',
        assistantId,
        topicId: 'uuid-1',
        createdAt: '2025-01-01T00:00:00Z',
        blocks: ['uuid-3']
      })
      expect(result.messages[1]).toMatchObject({
        id: 'uuid-4',
        role: 'assistant',
        assistantId,
        topicId: 'uuid-1',
        createdAt: '2025-01-01T00:00:01Z',
        blocks: ['uuid-5'],
        model: {
          id: 'claude-sonnet-4-20250514',
          provider: 'anthropic',
          name: 'Claude Sonnet 4',
          group: 'claude-4'
        }
      })

      expect(result.blocks[0]).toMatchObject({
        id: 'uuid-3',
        messageId: 'uuid-2',
        type: MessageBlockType.MAIN_TEXT,
        content: 'Hello',
        status: MessageBlockStatus.SUCCESS
      })
      expect(result.blocks[1]).toMatchObject({
        id: 'uuid-5',
        messageId: 'uuid-4',
        type: MessageBlockType.MAIN_TEXT,
        content: 'Hi there!',
        status: MessageBlockStatus.SUCCESS
      })
    })
  })

  describe('parse content blocks', () => {
    it('preserves text, thinking, artifact, tool call, and tool result content', async () => {
      const conversation = createConversation({
        current_leaf_message_uuid: 'msg-1',
        chat_messages: [
          createMessage({
            uuid: 'msg-1',
            sender: 'assistant',
            content: [
              { type: 'text', text: 'Intro text' },
              { type: 'thinking', thinking: 'Internal reasoning' },
              { type: 'text', text: 'After thinking' },
              { type: 'text', text: 'More text' },
              {
                type: 'tool_use',
                name: 'antArtifact',
                input: { title: 'Example' },
                display_content: {
                  type: 'artifact',
                  code: 'const answer: number = 42',
                  language: 'typescript',
                  filename: 'answer.ts'
                }
              },
              {
                type: 'tool_use',
                name: 'web_search',
                input: { query: 'Claude importer' }
              },
              {
                type: 'tool_result',
                content: 'String tool result'
              },
              {
                type: 'tool_result',
                content: [
                  { type: 'text', text: 'Array result one' },
                  { type: 'image', url: 'ignored.png' },
                  { type: 'text', text: 'Array result two' }
                ]
              }
            ],
            created_at: '2025-01-01T00:00:02Z'
          })
        ]
      })

      const result = await importer.parse(stringify(conversation), assistantId)

      expect(result.messages).toHaveLength(1)
      expect(result.blocks).toHaveLength(5)
      expect(result.blocks.map((block) => block.type)).toEqual([
        MessageBlockType.MAIN_TEXT,
        MessageBlockType.THINKING,
        MessageBlockType.MAIN_TEXT,
        MessageBlockType.MAIN_TEXT,
        MessageBlockType.MAIN_TEXT
      ])

      expect(result.blocks[0]).toMatchObject({
        type: MessageBlockType.MAIN_TEXT,
        content: 'Intro text'
      })
      expect(result.blocks[1]).toMatchObject({
        type: MessageBlockType.THINKING,
        content: 'Internal reasoning',
        thinking_millsec: 0
      })
      expect(result.blocks[2]).toMatchObject({
        type: MessageBlockType.MAIN_TEXT,
        content: 'After thinking\n\nMore text'
      })
      expect(result.blocks[3]).toMatchObject({
        type: MessageBlockType.MAIN_TEXT,
        content: '```typescript\n// answer.ts\nconst answer: number = 42\n```'
      })
      expect(result.blocks[4]).toMatchObject({
        type: MessageBlockType.MAIN_TEXT,
        content:
          '**Tool: web_search**\n```json\n{\n  "query": "Claude importer"\n}\n```\n\nString tool result\n\nArray result one\nArray result two'
      })
    })

    it('extracts artifact code from json_block display content', async () => {
      const conversation = createConversation({
        current_leaf_message_uuid: 'msg-1',
        chat_messages: [
          createMessage({
            uuid: 'msg-1',
            sender: 'assistant',
            content: [
              {
                type: 'tool_use',
                name: 'antArtifact',
                display_content: {
                  type: 'json_block',
                  json_block: JSON.stringify({
                    code: 'print("hello")',
                    language: 'python',
                    filename: 'hello.py'
                  })
                }
              }
            ]
          })
        ]
      })

      const result = await importer.parse(stringify(conversation), assistantId)

      expect(result.blocks).toHaveLength(1)
      expect(result.blocks[0]).toMatchObject({
        type: MessageBlockType.MAIN_TEXT,
        content: '```python\n// hello.py\nprint("hello")\n```'
      })
    })

    it('extracts filesystem tool code from input.file_text and infers language from path', async () => {
      const conversation = createConversation({
        current_leaf_message_uuid: 'msg-1',
        chat_messages: [
          createMessage({
            uuid: 'msg-1',
            sender: 'assistant',
            content: [
              {
                type: 'tool_use',
                name: 'create_file',
                input: {
                  path: 'src/example.tsx',
                  file_text: 'export const Example = () => null'
                }
              }
            ]
          })
        ]
      })

      const result = await importer.parse(stringify(conversation), assistantId)

      expect(result.blocks).toHaveLength(1)
      expect(result.blocks[0]).toMatchObject({
        type: MessageBlockType.MAIN_TEXT,
        content: '```typescript\n// src/example.tsx\nexport const Example = () => null\n```'
      })
    })
  })

  describe('parse null content guard', () => {
    it('skips messages with null content without throwing', async () => {
      const conversation = createConversation({
        current_leaf_message_uuid: 'msg-2',
        chat_messages: [
          createMessage({
            uuid: 'msg-1',
            parent_message_uuid: null,
            child_message_uuids: ['msg-2'],
            sender: 'human',
            content: null
          }),
          createMessage({
            uuid: 'msg-2',
            parent_message_uuid: 'msg-1',
            child_message_uuids: [],
            sender: 'assistant',
            content: [{ type: 'text', text: 'Still imports this response' }]
          })
        ]
      })

      await expect(importer.parse(stringify(conversation), assistantId)).resolves.toMatchObject({
        messages: [
          {
            role: 'assistant',
            blocks: ['uuid-4']
          }
        ],
        blocks: [
          {
            type: MessageBlockType.MAIN_TEXT,
            content: 'Still imports this response'
          }
        ]
      })
    })
  })

  describe('parse branch extraction', () => {
    const createBranchedConversation = () =>
      createConversation({
        name: 'Branched Conversation',
        current_leaf_message_uuid: 'msg-3b',
        chat_messages: [
          createMessage({
            uuid: 'msg-1',
            parent_message_uuid: null,
            child_message_uuids: ['msg-2a', 'msg-2b'],
            sender: 'human',
            content: [{ type: 'text', text: 'Root prompt' }],
            created_at: '2025-01-01T00:00:00Z'
          }),
          createMessage({
            uuid: 'msg-2a',
            parent_message_uuid: 'msg-1',
            child_message_uuids: ['msg-3a'],
            sender: 'assistant',
            content: [{ type: 'text', text: 'Branch A first answer' }],
            created_at: '2025-01-01T00:00:01Z'
          }),
          createMessage({
            uuid: 'msg-3a',
            parent_message_uuid: 'msg-2a',
            child_message_uuids: [],
            sender: 'human',
            content: [{ type: 'text', text: 'Branch A leaf' }],
            created_at: '2025-01-01T00:00:02Z'
          }),
          createMessage({
            uuid: 'msg-2b',
            parent_message_uuid: 'msg-1',
            child_message_uuids: ['msg-3b'],
            sender: 'assistant',
            content: [{ type: 'text', text: 'Branch B first answer' }],
            created_at: '2025-01-01T00:00:03Z'
          }),
          createMessage({
            uuid: 'msg-3b',
            parent_message_uuid: 'msg-2b',
            child_message_uuids: [],
            sender: 'human',
            content: [{ type: 'text', text: 'Branch B leaf' }],
            created_at: '2025-01-01T00:00:04Z'
          })
        ]
      })

    it('imports only the current leaf branch by default', async () => {
      const result = await importer.parse(stringify(createBranchedConversation()), assistantId)

      expect(result.topics).toHaveLength(1)
      expect(result.messages).toHaveLength(3)
      expect(result.blocks.map((block) => ('content' in block ? block.content : undefined))).toEqual([
        'Root prompt',
        'Branch B first answer',
        'Branch B leaf'
      ])
    })

    it('imports all leaf branches when importAllBranches is true', async () => {
      const result = await importer.parse(stringify(createBranchedConversation()), assistantId, {
        importAllBranches: true
      })

      expect(result.topics).toHaveLength(2)
      expect(result.messages).toHaveLength(6)
      expect(result.topics.map((topic) => topic.name)).toEqual([
        'Branched Conversation',
        'Branched Conversation (branch 2)'
      ])
      expect(result.topics[0].messages.map((message) => message.role)).toEqual(['user', 'assistant', 'user'])
      expect(result.topics[0].messages.map((message) => message.blocks[0])).toEqual(['uuid-3', 'uuid-5', 'uuid-7'])
      expect(result.blocks.slice(0, 3).map((block) => ('content' in block ? block.content : undefined))).toEqual([
        'Root prompt',
        'Branch B first answer',
        'Branch B leaf'
      ])
      expect(result.blocks.slice(3).map((block) => ('content' in block ? block.content : undefined))).toEqual([
        'Root prompt',
        'Branch A first answer',
        'Branch A leaf'
      ])
    })
  })

  describe('getModelBucket', () => {
    it('returns a normalized bucket for a single model', () => {
      const conversation = createConversation({
        model: 'anthropic:claude-3-5-sonnet-20241022'
      })

      expect(importer.getModelBucket(stringify(conversation))).toEqual({
        key: 'claude-3-5-sonnet',
        label: 'Claude 3.5 Sonnet'
      })
    })

    it('returns a mixed bucket when conversations use multiple models', () => {
      const first = createConversation({ model: 'claude-3-5-sonnet-20241022' })
      const second = createConversation({
        uuid: 'conv-2',
        model: 'claude-opus-4-5-20251101'
      })

      expect(importer.getModelBucket(stringify([first, second]))).toEqual({
        key: '__mixed__',
        label: 'Mixed Models'
      })
    })

    it('returns null when all conversations have null or empty models', () => {
      const first = createConversation({ model: null })
      const second = createConversation({ uuid: 'conv-2', model: '   ' })

      expect(importer.getModelBucket(stringify([first, second]))).toBeNull()
    })

    it('normalizes anthropic slash and dot prefixes and strips date suffixes', () => {
      expect(
        importer.getModelBucket(
          stringify(
            createConversation({
              model: 'anthropic/claude-opus-4-5-20251101'
            })
          )
        )
      ).toEqual({
        key: 'claude-opus-4-5',
        label: 'Claude Opus 4.5'
      })

      expect(
        importer.getModelBucket(
          stringify(
            createConversation({
              model: 'anthropic.claude-3-haiku-20240307'
            })
          )
        )
      ).toEqual({
        key: 'claude-3-haiku',
        label: 'Claude 3 Haiku'
      })
    })
  })

  describe('model display names', () => {
    it('formats known Claude model IDs into readable labels', () => {
      expect(importer.getAssistantModelLabel('claude-3-5-sonnet-20241022')).toBe('Claude 3.5 Sonnet')
      expect(importer.getAssistantModelLabel('claude-opus-4-5-20251101')).toBe('Claude Opus 4.5')
      expect(importer.getAssistantModelLabel('anthropic/claude-3-haiku-20240307')).toBe('Claude 3 Haiku')
      expect(importer.getAssistantModelLabel('claude-sonnet-4-20250514')).toBe('Claude Sonnet 4')
    })

    it('falls back to the raw model ID or unknown model label when no display name can be parsed', () => {
      expect(importer.getAssistantModelLabel('custom-claude-model')).toBe('custom-claude-model')
      expect(importer.getAssistantModelLabel(null)).toBe('Unknown Model')
    })
  })

  describe('findAllLeafNodes behavior', () => {
    it('treats messages with only dangling child UUIDs as leaves', async () => {
      const conversation = createConversation({
        current_leaf_message_uuid: 'missing-leaf',
        chat_messages: [
          createMessage({
            uuid: 'msg-1',
            child_message_uuids: ['missing-child'],
            sender: 'human',
            content: [{ type: 'text', text: 'Dangling child prompt' }]
          })
        ]
      })

      const result = await importer.parse(stringify(conversation), assistantId, {
        importAllBranches: true
      })

      expect(result.topics).toHaveLength(1)
      expect(result.messages).toHaveLength(1)
      expect(result.blocks[0]).toMatchObject({
        type: MessageBlockType.MAIN_TEXT,
        content: 'Dangling child prompt'
      })
    })
  })

  describe('fence sanitization', () => {
    it('sanitizes artifact language and filename before building code fences', async () => {
      const conversation = createConversation({
        current_leaf_message_uuid: 'msg-1',
        chat_messages: [
          createMessage({
            uuid: 'msg-1',
            sender: 'assistant',
            content: [
              {
                type: 'tool_use',
                name: 'antArtifact',
                display_content: {
                  type: 'artifact',
                  code: 'const markdown = "``` inside code"',
                  language: 'ts`\njson',
                  filename: 'bad`\nname.ts'
                }
              }
            ]
          })
        ]
      })

      const result = await importer.parse(stringify(conversation), assistantId)
      const block = result.blocks[0]

      expect(block).toMatchObject({
        type: MessageBlockType.MAIN_TEXT
      })
      expect('content' in block ? block.content : '').toBe(
        '````tsjson\n// badname.ts\nconst markdown = "``` inside code"\n````'
      )
      expect('content' in block ? block.content : '').not.toContain('ts`\njson')
      expect('content' in block ? block.content : '').not.toContain('bad`\nname.ts')
    })
  })

  describe('parse cache isolation', () => {
    it('does not reuse stale parsed content after parse clears the cache', async () => {
      const first = createConversation()
      const second = createConversation({
        name: 'Second Parse',
        chat_messages: [
          createMessage({
            uuid: 'msg-1',
            child_message_uuids: [],
            content: [{ type: 'text', text: 'Only second content' }]
          })
        ],
        current_leaf_message_uuid: 'msg-1'
      })

      expect(importer.validate(stringify(first))).toBe(true)
      await importer.parse(stringify(first), assistantId)

      const result = await importer.parse(stringify(second), assistantId)

      expect(result.topics[0].name).toBe('Second Parse')
      expect(result.blocks[0]).toMatchObject({
        type: MessageBlockType.MAIN_TEXT,
        content: 'Only second content'
      })
    })
  })

  describe('array conversations', () => {
    it('parses multiple conversations from one file', async () => {
      const first = createConversation()
      const second = cloneConversation(
        createConversation({
          uuid: 'conv-2',
          name: 'Second Conversation',
          current_leaf_message_uuid: 'second-msg-1',
          chat_messages: [
            createMessage({
              uuid: 'second-msg-1',
              child_message_uuids: [],
              content: [{ type: 'text', text: 'Second hello' }]
            })
          ]
        })
      )

      const result = await importer.parse(stringify([first, second]), assistantId)

      expect(result.topics.map((topic) => topic.name)).toEqual(['Test Conversation', 'Second Conversation'])
      expect(result.messages).toHaveLength(3)
      expect(result.blocks.map((block) => ('content' in block ? block.content : undefined))).toEqual([
        'Hello',
        'Hi there!',
        'Second hello'
      ])
    })
  })
})
