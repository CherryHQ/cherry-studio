import { describe, expect, it, vi } from 'vitest'

vi.mock('@renderer/i18n', () => ({
  default: {
    t: (key: string) => key
  }
}))

import { MessageBlockStatus, MessageBlockType } from '@renderer/types/newMessage'

describe('ChatBoxImporter', () => {
  it('validates ChatBox exported-data.json shape', async () => {
    const { ChatBoxImporter } = await import('../ChatBoxImporter')
    const importer = new ChatBoxImporter()

    const chatboxExport = JSON.stringify({
      __exported_at: '2025-12-18T22:52:30.517Z',
      'chat-sessions-list': [{ id: 's1', name: 'Session 1', starred: true, type: 'chat' }],
      'session:s1': { id: 's1', name: 'Session 1', starred: true, messages: [] }
    })

    expect(importer.validate(chatboxExport)).toBe(true)
    expect(importer.validate(JSON.stringify([{ title: 'x', create_time: 1, mapping: {} }]))).toBe(false)
    expect(importer.validate('not json')).toBe(false)
  })

  it('throws parse errors for invalid exports', async () => {
    const { ChatBoxImporter } = await import('../ChatBoxImporter')
    const importer = new ChatBoxImporter()

    await expect(importer.parse('not json', 'assistant-1')).rejects.toThrow('import.chatbox.error.invalid_json')
    await expect(importer.parse(JSON.stringify([]), 'assistant-1')).rejects.toThrow('import.chatbox.error.invalid_json')

    await expect(
      importer.parse(
        JSON.stringify({
          __exported_at: '2025-12-18T22:52:30.517Z',
          'chat-sessions-list': []
        }),
        'assistant-1'
      )
    ).rejects.toThrow('import.chatbox.error.no_conversations')

    await expect(
      importer.parse(
        JSON.stringify({
          __exported_at: '2025-12-18T22:52:30.517Z',
          'chat-sessions-list': [{ id: 's1', name: 'Session 1', starred: true, type: 'chat' }],
          'session:s1': {
            id: 's1',
            name: 'Session 1',
            messages: [{ id: 'm1', role: 'unknown', contentParts: [{ type: 'text', text: 'skip' }] }]
          }
        }),
        'assistant-1'
      )
    ).rejects.toThrow('import.chatbox.error.no_valid_conversations')
  })

  it('parses sessions, messages, and blocks (text/image/tool-call)', async () => {
    const { ChatBoxImporter } = await import('../ChatBoxImporter')
    const importer = new ChatBoxImporter()

    const exportedAt = '2025-12-18T22:52:30.517Z'

    const chatboxExport = JSON.stringify({
      __exported_at: exportedAt,
      settings: {
        apiKey: 'should-not-be-imported'
      },
      'chat-sessions-list': [{ id: 's1', name: 'Session 1', starred: true, type: 'chat' }],
      'session:s1': {
        id: 's1',
        name: 'Session 1',
        starred: true,
        messages: [
          {
            id: 'm1',
            role: 'user',
            timestamp: 1721205396827,
            contentParts: [
              { type: 'text', text: 'Hello' },
              { type: 'image', url: 'https://example.com/a.png' },
              { type: 'text', text: 'After image' }
            ]
          },
          {
            id: 'm2',
            role: 'assistant',
            contentParts: [
              {
                type: 'tool-call',
                state: 'error',
                toolCallId: 'tc1',
                toolName: 'web_search',
                args: { query: 'x' },
                result: { error: { name: 'Error', message: 'fail', stack: 'stack' } }
              },
              { type: 'text', text: 'Tool result' }
            ],
            pictures: [{ url: 'https://example.com/b.png' }]
          }
        ]
      }
    })

    const result = await importer.parse(chatboxExport, 'assistant-1')

    expect(result.topics).toHaveLength(1)
    expect(result.messages).toHaveLength(2)
    expect(result.blocks).toHaveLength(6)
    expect(result.stats?.skippedMessagesCount).toBe(0)
    expect(result.stats?.skippedTopicsCount).toBe(0)

    const topic = result.topics[0]
    expect(topic.assistantId).toBe('assistant-1')
    expect(topic.name).toBe('Session 1')
    expect(topic.pinned).toBe(true)
    expect(topic.messages).toHaveLength(2)

    const [userMessage, assistantMessage] = result.messages
    expect(userMessage.role).toBe('user')
    expect(assistantMessage.role).toBe('assistant')

    const blocksByMessage = new Map<string, { type: string; id: string }[]>()
    for (const block of result.blocks) {
      const list = blocksByMessage.get(block.messageId) ?? []
      list.push({ id: block.id, type: block.type })
      blocksByMessage.set(block.messageId, list)
    }

    expect(blocksByMessage.get(userMessage.id)?.map((b) => b.type)).toEqual([
      MessageBlockType.MAIN_TEXT,
      MessageBlockType.IMAGE,
      MessageBlockType.MAIN_TEXT
    ])

    const assistantBlockTypes = blocksByMessage.get(assistantMessage.id)?.map((b) => b.type)
    expect(assistantBlockTypes).toEqual([MessageBlockType.TOOL, MessageBlockType.MAIN_TEXT, MessageBlockType.IMAGE])

    const toolBlock = result.blocks.find((b) => b.messageId === assistantMessage.id && b.type === MessageBlockType.TOOL)
    expect(toolBlock).toBeDefined()
    expect(toolBlock?.status).toBe(MessageBlockStatus.ERROR)
    expect(toolBlock && 'toolId' in toolBlock ? toolBlock.toolId : null).toBe('tc1')
  })

  it('parses system role, falls back to content, and skips unknown roles', async () => {
    const { ChatBoxImporter } = await import('../ChatBoxImporter')
    const importer = new ChatBoxImporter()

    const chatboxExport = JSON.stringify({
      __exported_at: '2025-12-18T22:52:30.517Z',
      'chat-sessions-list': [{ id: 's1', name: 'Session 1', starred: false, type: 'chat' }],
      'session:s1': {
        id: 's1',
        name: 'Session 1',
        messages: [
          {
            id: 'm0',
            role: 'system',
            contentParts: [{ type: 'text', text: 'System message' }]
          },
          {
            id: 'm1',
            role: 'unknown',
            contentParts: [{ type: 'text', text: 'Should be skipped' }]
          },
          {
            id: 'm2',
            role: 'assistant',
            contentParts: [],
            content: 'Fallback content'
          }
        ]
      }
    })

    const result = await importer.parse(chatboxExport, 'assistant-1')
    expect(result.messages.map((m) => m.role)).toEqual(['system', 'assistant'])
    expect(result.stats?.skippedMessagesCount).toBe(1)
    expect(result.stats?.skippedTopicsCount).toBe(0)

    const systemMessage = result.messages.find((m) => m.role === 'system')
    const assistantMessage = result.messages.find((m) => m.role === 'assistant')
    expect(systemMessage).toBeDefined()
    expect(assistantMessage).toBeDefined()

    const blocksByMessage = new Map<string, { type: MessageBlockType; content?: string }[]>()
    for (const block of result.blocks) {
      const list = blocksByMessage.get(block.messageId) ?? []
      list.push({
        type: block.type,
        content: 'content' in block ? (block.content as string) : undefined
      })
      blocksByMessage.set(block.messageId, list)
    }

    expect(blocksByMessage.get(systemMessage!.id)).toEqual([
      { type: MessageBlockType.MAIN_TEXT, content: 'System message' }
    ])
    expect(blocksByMessage.get(assistantMessage!.id)).toEqual([
      { type: MessageBlockType.MAIN_TEXT, content: 'Fallback content' }
    ])
  })
})
