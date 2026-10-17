import { beforeEach, describe, expect, it, vi } from 'vitest'

import { dataApiService } from '@data/DataApiService'

// i18n is only used for display strings (assistant name, error text); return
// the defaultValue so assertions stay independent of the translation catalog.
vi.mock('@renderer/i18n/resolver', () => ({
  default: {
    t: vi.fn((_key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? _key)
  }
}))

import { importService } from '../ImportService'

/**
 * Minimal ChatGPT export shape — enough to pass `validate()` and exercise the
 * importer's message-tree conversion. Two conversations to prove topics are
 * created independently and message chains don't bleed across them.
 */
function chatgptExport() {
  const conv = (title: string, turns: Array<[role: 'user' | 'assistant', text: string]>) => {
    const mapping: Record<string, any> = { root: { id: 'root', children: ['n0'] } }
    let prev = 'root'
    turns.forEach(([role, text], i) => {
      const id = `${title}-n${i}`
      mapping[id] = {
        id,
        parent: prev,
        children: i === turns.length - 1 ? [] : [`${title}-n${i + 1}`],
        message: {
          id,
          author: { role },
          content: {
            content_type: 'text',
            parts: [text]
          },
          create_time: 1700000000 + i
        }
      }
      prev = id
    })
    // point the first child off the root
    mapping.root.children = [`${title}-n0`]
    return { title, create_time: 1700000000, update_time: 1700000100, mapping, current_node: prev }
  }

  return JSON.stringify([
    conv('Greeting', [
      ['user', 'Hi'],
      ['assistant', 'Hello!']
    ]),
    conv('Solo', [['user', 'Just me']])
  ])
}

describe('importService.importConversations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('persists assistant, topics, and messages via DataApi, all linked to the created assistant id', async () => {
    const calls: { path: string; body: any; returnedId: string }[] = []
    const onProgress = vi.fn()
    let seq = 0
    const nextId = (prefix: string) => `${prefix}_${++seq}`

    vi.mocked(dataApiService.post).mockImplementation(async (path: string, options: any) => {
      const returnedId = path === '/assistants' ? nextId('asst') : path === '/topics' ? nextId('topic') : nextId('msg')
      calls.push({ path, body: options?.body, returnedId })
      return path === '/assistants' ? { id: returnedId, name: 'ChatGPT Import', emoji: '🤖' } : { id: returnedId }
    })

    const response = await importService.importConversations(chatgptExport(), undefined, onProgress)

    expect(response.success).toBe(true)
    expect(response.assistant?.id).toBe('asst_1')
    expect(response.topicsCount).toBe(2)
    // 2 turns in "Greeting" + 1 in "Solo"
    expect(response.messagesCount).toBe(3)

    const progressValues = onProgress.mock.calls.map(([progress]) => progress)
    expect(progressValues[0]).toBe(0)
    expect(progressValues.at(-1)).toBe(100)
    expect(progressValues.some((progress) => progress > 20 && progress < 100)).toBe(true)
    expect(progressValues.every((progress, index) => index === 0 || progress >= progressValues[index - 1])).toBe(true)

    // Assistant created exactly once.
    const assistantCalls = calls.filter((c) => c.path === '/assistants')
    expect(assistantCalls).toHaveLength(1)

    // One topic per conversation, each linked to the created assistant id.
    const topicCalls = calls.filter((c) => c.path === '/topics')
    expect(topicCalls).toHaveLength(2)
    expect(topicCalls.every((c) => c.body.assistantId === 'asst_1')).toBe(true)

    // Messages chain under their topic: first message has parentId null, each
    // subsequent message's parentId equals the previous message's returned id.
    const messageCalls = calls.filter((c) => c.path.includes('/messages'))
    expect(messageCalls).toHaveLength(3)
    expect(messageCalls.map((c) => c.body.parentId)).toEqual([null, messageCalls[0].returnedId, null])

    // Text content is folded into a single AI SDK text part.
    expect(messageCalls[0].body.data.parts).toEqual([{ type: 'text', text: 'Hi' }])

    // Assistant messages freeze the producing author (with the source model
    // nested) so the header survives rename/delete; user messages do not.
    expect(messageCalls[0].body.messageSnapshot).toBeUndefined()
    expect(messageCalls[1].body.messageSnapshot).toMatchObject({
      id: 'asst_1',
      model: { id: 'gpt-5', provider: 'openai' }
    })

    // Imported messages are persisted as completed.
    expect(messageCalls.every((c) => c.body.status === 'success')).toBe(true)

    // The two conversations map to distinct topics, so each message POST targets
    // a topic created by an earlier call rather than a fixed path.
    const messagePaths = new Set(messageCalls.map((c) => c.path))
    expect(messagePaths.size).toBe(2)
  })

  it('persists Claude thinking and anonymous tool calls as AI SDK message parts', async () => {
    const messageBodies: any[] = []
    vi.mocked(dataApiService.post).mockImplementation(async (path: string, options: any) => {
      if (path === '/assistants') return { id: 'asst_claude', name: 'Claude Import', emoji: '🍒' }
      if (path === '/topics') return { id: 'topic_claude' }
      messageBodies.push(options.body)
      return { id: `message_${messageBodies.length}` }
    })

    const fileContent = JSON.stringify([
      {
        uuid: 'conversation-1',
        name: 'Claude tools',
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:10.000Z',
        chat_messages: [
          {
            uuid: 'user-1',
            sender: 'human',
            text: 'Question',
            content: [{ type: 'text', text: 'Question' }],
            created_at: '2026-01-01T00:00:00.000Z',
            updated_at: '2026-01-01T00:00:00.000Z'
          },
          {
            uuid: 'assistant-1',
            sender: 'assistant',
            text: 'Answer',
            content: [
              {
                type: 'thinking',
                thinking: 'Reasoning',
                start_timestamp: '2026-01-01T00:00:01.000Z',
                stop_timestamp: '2026-01-01T00:00:03.000Z'
              },
              { type: 'tool_use', id: null, name: 'search', input: { query: 'Cherry Studio' } },
              { type: 'tool_result', tool_use_id: null, content: [{ type: 'text', text: 'Result' }] },
              { type: 'text', text: 'Answer' }
            ],
            created_at: '2026-01-01T00:00:01.000Z',
            updated_at: '2026-01-01T00:00:04.000Z'
          }
        ]
      }
    ])

    const response = await importService.importConversations(fileContent, 'claude')
    const assistantParts = messageBodies.find((body) => body.role === 'assistant').data.parts

    expect(response).toMatchObject({ success: true, topicsCount: 1, messagesCount: 2 })
    expect(assistantParts).toEqual([
      {
        type: 'reasoning',
        text: 'Reasoning',
        state: 'done',
        providerMetadata: { cherry: { thinkingMs: 2000 } }
      },
      {
        type: 'dynamic-tool',
        toolCallId: 'assistant-1-tool-0',
        toolName: 'search',
        input: { query: 'Cherry Studio' },
        state: 'output-available',
        output: 'Result'
      },
      { type: 'text', text: 'Answer' }
    ])
  })

  it('persists source branches as sibling groups and selects the imported active leaf', async () => {
    const messageCalls: Array<{ body: any; returnedId: string }> = []
    vi.mocked(dataApiService.post).mockImplementation(async (path: string, options: any) => {
      if (path === '/assistants') return { id: 'asst_chatgpt', name: 'ChatGPT Import', emoji: '💬' }
      if (path === '/topics') return { id: 'topic_chatgpt' }
      const returnedId = `db-${messageCalls.length + 1}`
      messageCalls.push({ body: options.body, returnedId })
      return { id: returnedId }
    })

    const sourceMessage = (role: 'user' | 'assistant', text: string) => ({
      author: { role },
      content: { content_type: 'text', parts: [text] }
    })
    const fileContent = JSON.stringify([
      {
        title: 'Branched chat',
        create_time: 1,
        current_node: 'assistant-2b',
        mapping: {
          root: { children: ['user-1'] },
          'user-1': { parent: 'root', message: sourceMessage('user', 'question') },
          'assistant-1': { parent: 'user-1', message: sourceMessage('assistant', 'answer') },
          'user-2a': { parent: 'assistant-1', message: sourceMessage('user', 'first follow-up') },
          'assistant-2a': { parent: 'user-2a', message: sourceMessage('assistant', 'first reply') },
          'user-2b': { parent: 'assistant-1', message: sourceMessage('user', 'edited follow-up') },
          'assistant-2b': { parent: 'user-2b', message: sourceMessage('assistant', 'edited reply') }
        }
      }
    ])

    const response = await importService.importConversations(fileContent, 'chatgpt')

    expect(response).toMatchObject({ success: true, topicsCount: 1, messagesCount: 6 })
    expect(messageCalls.map(({ body }) => body.parentId)).toEqual([null, 'db-1', 'db-2', 'db-3', 'db-2', 'db-5'])
    expect(messageCalls[2].body.siblingsGroupId).toBe(messageCalls[4].body.siblingsGroupId)
    expect(messageCalls[2].body.siblingsGroupId).toBeGreaterThan(0)
    expect(messageCalls.every(({ body }) => body.setAsActive === false)).toBe(true)
    expect(vi.mocked(dataApiService.put)).toHaveBeenCalledWith('/topics/topic_chatgpt/active-node', {
      body: { nodeId: 'db-6' }
    })
  })

  it('returns a failure response without creating an assistant for invalid or empty exports', async () => {
    const unsupportedResponse = await importService.importConversations('definitely not json')
    const emptyClaudeResponse = await importService.importConversations('[]', 'claude')

    expect(unsupportedResponse.success).toBe(false)
    expect(emptyClaudeResponse.success).toBe(false)
    expect(vi.mocked(dataApiService.post)).not.toHaveBeenCalled()
  })

  it('returns the persistence error without reporting partial counts', async () => {
    vi.mocked(dataApiService.post).mockRejectedValueOnce(new Error('database unavailable'))

    const response = await importService.importConversations(chatgptExport())

    expect(response).toMatchObject({
      success: false,
      topicsCount: 0,
      messagesCount: 0,
      error: 'database unavailable'
    })
    expect(vi.mocked(dataApiService.post)).toHaveBeenCalledOnce()
  })
})
