import { dataApiService } from '@data/DataApiService'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// i18n is only used for display strings (assistant name, error text); return
// the defaultValue so assertions stay independent of the translation catalog.
vi.mock('@renderer/i18n', () => ({
  default: {
    t: vi.fn((_key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? _key)
  }
}))

import { importService } from '../ImportService'

/**
 * Minimal ChatGPT export shape — enough to pass `validate()` and exercise the
 * importer's root→leaf thread extraction. Two conversations to prove topics are
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
          content: { content_type: 'text', parts: [text] },
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
    let seq = 0
    const nextId = (prefix: string) => `${prefix}_${++seq}`

    vi.mocked(dataApiService.post).mockImplementation(async (path: string, options: any) => {
      const returnedId = path === '/assistants' ? nextId('asst') : path === '/topics' ? nextId('topic') : nextId('msg')
      calls.push({ path, body: options?.body, returnedId })
      return { id: returnedId }
    })

    const response = await importService.importConversations(chatgptExport())

    expect(response.success).toBe(true)
    expect(response.assistant?.id).toBe('asst_1')
    expect(response.topicsCount).toBe(2)
    // 2 turns in "Greeting" + 1 in "Solo"
    expect(response.messagesCount).toBe(3)

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
    expect(messageCalls[0].body.parentId).toBeNull()
    expect(messageCalls[1].body.parentId).toBe(messageCalls[0].returnedId)

    // Text content is folded into a single AI SDK text part.
    expect(messageCalls[0].body.data.parts).toEqual([{ type: 'text', text: 'Hi' }])

    // Assistant messages carry a model snapshot (drives the model badge); user
    // messages do not.
    expect(messageCalls[0].body.modelSnapshot).toBeUndefined()
    expect(messageCalls[1].body.modelSnapshot).toMatchObject({ id: 'gpt-5', provider: 'openai' })

    // Imported messages are persisted as completed.
    expect(messageCalls.every((c) => c.body.status === 'success')).toBe(true)

    // The two conversations map to distinct topics, so each message POST targets
    // a topic created by an earlier call rather than a fixed path.
    const messagePaths = new Set(messageCalls.map((c) => c.path))
    expect(messagePaths.size).toBe(2)
  })

  it('returns a failure response without creating an assistant for an unsupported format', async () => {
    const response = await importService.importConversations('definitely not json')

    expect(response.success).toBe(false)
    expect(vi.mocked(dataApiService.post)).not.toHaveBeenCalled()
  })
})
