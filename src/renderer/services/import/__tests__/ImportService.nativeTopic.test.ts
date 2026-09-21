import { beforeEach, describe, expect, it, vi } from 'vitest'

import { dataApiService } from '@data/DataApiService'
import type { Message } from '@shared/data/types/message'

// i18n is only used for display strings and error text; return the
// defaultValue so assertions stay independent of the translation catalog.
vi.mock('@renderer/i18n/resolver', () => ({
  default: {
    t: vi.fn((_key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? _key)
  }
}))

import { buildCherryTopicFile } from '../cherryTopicFormat'
import { importService } from '../ImportService'

function makeMessage(overrides: Partial<Message> & Pick<Message, 'id' | 'role'>): Message {
  const { id, role, ...rest } = overrides
  return {
    id,
    topicId: 'topic-1',
    parentId: null,
    role,
    data: { parts: [{ type: 'text', text: id }] },
    searchableText: id,
    status: 'success',
    siblingsGroupId: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...rest
  }
}

const snapshot = (name: string) => ({
  id: 'assistant-1',
  name,
  model: { id: 'model-1', name: 'Model 1', provider: 'provider-1' }
})

/** Branched native file: two first turns, a regenerate pair, and a paused leaf. */
function nativeFileContent(manuallyEdited = true) {
  return JSON.stringify(
    buildCherryTopicFile({
      topic: { name: 'My Topic', ...(manuallyEdited ? { isNameManuallyEdited: true } : {}) },
      assistant: { name: 'Ast', emoji: '🤖' },
      messages: [
        makeMessage({ id: 'u1', role: 'user', parentId: 'root-1', createdAt: '2026-01-01T00:00:01.000Z' }),
        makeMessage({
          id: 'a1',
          role: 'assistant',
          parentId: 'u1',
          messageSnapshot: snapshot('Ast'),
          createdAt: '2026-01-01T00:00:02.000Z'
        }),
        makeMessage({ id: 'u2', role: 'user', parentId: 'root-1', createdAt: '2026-01-01T00:00:03.000Z' }),
        makeMessage({
          id: 'a2a',
          role: 'assistant',
          parentId: 'u2',
          siblingsGroupId: 7,
          messageSnapshot: snapshot('Ast'),
          createdAt: '2026-01-01T00:00:04.000Z'
        }),
        makeMessage({
          id: 'a2b',
          role: 'assistant',
          parentId: 'u2',
          siblingsGroupId: 7,
          status: 'paused',
          messageSnapshot: snapshot('Ast'),
          createdAt: '2026-01-01T00:00:05.000Z'
        })
      ],
      activeNodeId: 'a2b',
      rootId: 'root-1',
      exportedAt: '2026-02-01T00:00:00.000Z'
    })
  )
}

describe('importService.importNativeTopic', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('recreates the topic tree without touching assistants', async () => {
    const posts: { path: string; body: any; returnedId: string }[] = []
    const puts: { path: string; body: any }[] = []
    const patches: { path: string; body: any }[] = []
    let seq = 0

    vi.mocked(dataApiService.post).mockImplementation(async (path: string, options: any) => {
      const returnedId = path === '/topics' ? 'new-topic' : `msg_${++seq}`
      posts.push({ path, body: options?.body, returnedId })
      return { id: returnedId }
    })
    vi.mocked(dataApiService.put).mockImplementation(async (path: string, options: any) => {
      puts.push({ path, body: options?.body })
      return { activeNodeId: options?.body?.nodeId }
    })
    vi.mocked(dataApiService.patch).mockImplementation(async (path: string, options: any) => {
      patches.push({ path, body: options?.body })
      return {}
    })

    const response = await importService.importNativeTopic(nativeFileContent())

    expect(response).toMatchObject({ success: true, topicsCount: 1, messagesCount: 5 })

    // Only the topic is created — the exported assistant is informational and
    // no assistant row is written on the destination.
    expect(posts.some((call) => call.path === '/assistants')).toBe(false)
    const topicCalls = posts.filter((call) => call.path === '/topics')
    expect(topicCalls).toHaveLength(1)
    expect(topicCalls[0]?.body).toEqual({ name: 'My Topic' })
    expect(patches).toEqual([{ path: '/topics/new-topic', body: { isNameManuallyEdited: true } }])

    // Parent links remap onto the newly created ids while the tree shape,
    // snapshots, sibling groups and status survive verbatim.
    const messageCalls = posts.filter((call) => call.path.includes('/messages'))
    expect(messageCalls).toHaveLength(5)
    expect(messageCalls.map((call) => call.body.parentId)).toEqual([null, 'msg_1', null, 'msg_3', 'msg_3'])
    const byParent = (parentId: string | null) => messageCalls.filter((call) => call.body.parentId === parentId)
    expect(byParent(null).map((call) => call.body.role)).toEqual(['user', 'user'])
    expect(byParent('msg_3').map((call) => call.body.siblingsGroupId)).toEqual([7, 7])
    expect(byParent('msg_3').map((call) => call.body.messageSnapshot)).toEqual([snapshot('Ast'), snapshot('Ast')])
    expect(byParent('msg_3').map((call) => call.body.status)).toEqual(['success', 'paused'])
    expect(byParent(null).every((call) => call.body.messageSnapshot === undefined)).toBe(true)

    expect(puts).toEqual([{ path: '/topics/new-topic/active-node', body: { nodeId: 'msg_5' } }])
  })

  it('lands mid-generation pending rows as error so they stay terminal and retryable', async () => {
    const posts: { path: string; body: any }[] = []
    vi.mocked(dataApiService.post).mockImplementation(async (path: string, options: any) => {
      const returnedId = path === '/topics' ? 'new-topic' : `msg_${posts.length}`
      posts.push({ path, body: options?.body })
      return { id: returnedId }
    })
    vi.mocked(dataApiService.put).mockResolvedValue({ activeNodeId: 'x' })
    vi.mocked(dataApiService.patch).mockResolvedValue({})

    const content = JSON.stringify(
      buildCherryTopicFile({
        topic: { name: 'Generating' },
        messages: [
          makeMessage({ id: 'u1', role: 'user', parentId: 'root-1', createdAt: '2026-01-01T00:00:01.000Z' }),
          makeMessage({
            id: 'a1',
            role: 'assistant',
            parentId: 'u1',
            status: 'pending',
            messageSnapshot: snapshot('Ast'),
            createdAt: '2026-01-01T00:00:02.000Z'
          })
        ],
        activeNodeId: 'a1',
        rootId: 'root-1',
        exportedAt: '2026-02-01T00:00:00.000Z'
      })
    )

    const response = await importService.importNativeTopic(content)

    expect(response).toMatchObject({ success: true, topicsCount: 1, messagesCount: 2 })
    const messageCalls = posts.filter((call) => call.path.includes('/messages'))
    expect(messageCalls.map((call) => call.body.status)).toEqual(['success', 'error'])
  })

  it('skips the rename-flag patch for auto-named topics', async () => {
    const patches: unknown[] = []
    vi.mocked(dataApiService.post).mockImplementation(async (path: string) => ({
      id: path === '/topics' ? 'new-topic' : `msg_${path}`
    }))
    vi.mocked(dataApiService.put).mockResolvedValue({ activeNodeId: 'x' })
    vi.mocked(dataApiService.patch).mockImplementation(async (path: string, options: any) => {
      patches.push({ path, body: options?.body })
      return {}
    })

    const response = await importService.importNativeTopic(nativeFileContent(false))

    expect(response.success).toBe(true)
    expect(patches).toEqual([])
  })

  it('removes the created topic when persisting fails midway', async () => {
    const deletes: { path: string; options: any }[] = []
    let messageCalls = 0
    vi.mocked(dataApiService.post).mockImplementation(async (path: string) => {
      if (path === '/topics') return { id: 'new-topic' }
      messageCalls += 1
      if (messageCalls > 1) throw new Error('db gone')
      return { id: `msg_${messageCalls}` }
    })
    vi.mocked(dataApiService.delete).mockImplementation(async (path: string, options: any) => {
      deletes.push({ path, options })
      return {}
    })
    vi.mocked(dataApiService.put).mockResolvedValue({ activeNodeId: 'x' })
    vi.mocked(dataApiService.patch).mockResolvedValue({})

    const response = await importService.importNativeTopic(nativeFileContent())

    expect(response.success).toBe(false)
    expect(response.topicsCount).toBe(0)
    expect(deletes).toEqual([{ path: '/topics/new-topic', options: { query: { permanent: true } } }])
  })

  it('fails invalid files without writing anything', async () => {
    const postSpy = vi.mocked(dataApiService.post)
    const putSpy = vi.mocked(dataApiService.put)

    const unsupported = JSON.stringify({ kind: 'cherry-studio.topic', version: 999 })
    for (const content of [unsupported, 'not json {']) {
      const response = await importService.importNativeTopic(content)
      expect(response.success).toBe(false)
      expect(response.topicsCount).toBe(0)
    }

    expect(postSpy).not.toHaveBeenCalled()
    expect(putSpy).not.toHaveBeenCalled()
  })

  it.each([undefined, 'cherry', 'Cherry'])(
    'routes native files through the assistant-free path (importerName: %s)',
    async (importerName) => {
      const posts: { path: string }[] = []
      vi.mocked(dataApiService.post).mockImplementation(async (path: string) => {
        posts.push({ path })
        return { id: path === '/topics' ? 'new-topic' : `msg_${path}` }
      })
      vi.mocked(dataApiService.put).mockResolvedValue({ activeNodeId: 'x' })
      vi.mocked(dataApiService.patch).mockResolvedValue({})

      const response = await importService.importConversations(nativeFileContent(), importerName)

      expect(response).toMatchObject({ success: true, topicsCount: 1, messagesCount: 5 })
      expect(response.assistant).toBeUndefined()
      expect(posts.some((call) => call.path === '/assistants')).toBe(false)
      expect(posts.some((call) => call.path === '/topics')).toBe(true)
    }
  )
})
