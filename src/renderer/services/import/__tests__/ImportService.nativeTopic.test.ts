import { beforeEach, describe, expect, it, vi } from 'vitest'

import { dataApiService } from '@data/DataApiService'
import { toast } from '@renderer/services/toast'
import type { Message } from '@shared/data/types/message'
import { IpcError } from '@shared/ipc/errors/IpcError'

// i18n is only used for display strings and error text; return the
// defaultValue so assertions stay independent of the translation catalog.
vi.mock('@renderer/i18n/resolver', () => ({
  default: {
    t: vi.fn((_key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? _key)
  }
}))

const ipcRequest = vi.hoisted(() => vi.fn())
vi.mock('@renderer/ipc', () => ({ ipcApi: { request: ipcRequest } }))

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

  it('does not set active node when the export omitted activeSourceId', async () => {
    const puts: { path: string; body: any }[] = []
    vi.mocked(dataApiService.post).mockImplementation(async (path: string) => ({
      id: path === '/topics' ? 'new-topic' : `msg_${path}`
    }))
    vi.mocked(dataApiService.put).mockImplementation(async (path: string, options: any) => {
      puts.push({ path, body: options?.body })
      return { activeNodeId: options?.body?.nodeId }
    })
    vi.mocked(dataApiService.patch).mockResolvedValue({})

    const content = JSON.stringify(
      buildCherryTopicFile({
        topic: { name: 'No active' },
        messages: [
          makeMessage({ id: 'u1', role: 'user', parentId: 'root-1', createdAt: '2026-01-01T00:00:01.000Z' }),
          makeMessage({
            id: 'a1',
            role: 'assistant',
            parentId: 'u1',
            messageSnapshot: snapshot('Ast'),
            createdAt: '2026-01-01T00:00:02.000Z'
          })
        ],
        rootId: 'root-1',
        exportedAt: '2026-02-01T00:00:00.000Z'
      })
    )

    const response = await importService.importNativeTopic(content)

    expect(response).toMatchObject({ success: true, topicsCount: 1, messagesCount: 2 })
    expect(puts).toEqual([])
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

  it('restores embedded attachments and videos as destination-owned files', async () => {
    const posts: { path: string; body: any }[] = []
    let seq = 0
    vi.mocked(dataApiService.post).mockImplementation(async (path: string, options: any) => {
      const returnedId = path === '/topics' ? 'new-topic' : `msg_${++seq}`
      posts.push({ path, body: options?.body })
      return { id: returnedId }
    })
    vi.mocked(dataApiService.put).mockResolvedValue({ activeNodeId: 'x' })
    vi.mocked(dataApiService.patch).mockResolvedValue({})
    ipcRequest.mockImplementation(async (route: string) => {
      if (route === 'file.batch_create_internal_entries') {
        return {
          succeeded: [
            { id: 'entry-1', sourceRef: '#0' },
            { id: 'entry-2', sourceRef: '#1' }
          ],
          failed: []
        }
      }
      if (route === 'file.batch_get_physical_paths') {
        return { 'entry-1': '/files/entry-1.txt', 'entry-2': '/files/entry-2.mp4' }
      }
      throw new Error(`unexpected ipc route ${route}`)
    })

    const content = JSON.stringify(
      buildCherryTopicFile({
        topic: { name: 'With media' },
        messages: [
          makeMessage({
            id: 'u1',
            role: 'user',
            parentId: 'root-1',
            data: {
              parts: [
                { type: 'text', text: 'look' },
                {
                  type: 'file',
                  url: 'data:text/plain;base64,aGVsbG8=',
                  filename: 'notes.txt',
                  mediaType: 'text/plain'
                },
                { type: 'data-video', data: { url: 'data:video/mp4;base64,AAEC' } },
                { type: 'file', url: 'https://example.com/remote.png', filename: 'remote.png', mediaType: 'image/png' }
              ]
            },
            createdAt: '2026-01-01T00:00:01.000Z'
          })
        ],
        activeNodeId: 'u1',
        rootId: 'root-1',
        exportedAt: '2026-02-01T00:00:00.000Z'
      })
    )

    const response = await importService.importNativeTopic(content)

    expect(response).toMatchObject({ success: true, topicsCount: 1, messagesCount: 1 })

    // Embedded payloads become internal entries owned by the destination.
    const createCall = ipcRequest.mock.calls.find((call) => call[0] === 'file.batch_create_internal_entries')
    expect(createCall?.[1]).toEqual({
      items: [
        {
          source: 'bytes',
          data: new Uint8Array([104, 101, 108, 108, 111]),
          name: 'notes.txt',
          ext: 'txt',
          cleanupPolicy: 'delete_when_unreferenced'
        },
        {
          source: 'bytes',
          data: new Uint8Array([0, 1, 2]),
          name: 'video.mp4',
          ext: 'mp4',
          cleanupPolicy: 'delete_when_unreferenced'
        }
      ]
    })
    expect(ipcRequest).toHaveBeenCalledWith('file.batch_get_physical_paths', { ids: ['entry-1', 'entry-2'] })

    // The persisted parts address the fresh destination entries, so rendering
    // resolves a handle and continuation routes through text extraction.
    const messageCalls = posts.filter((call) => call.path.includes('/messages'))
    expect(messageCalls).toHaveLength(1)
    expect(messageCalls[0]?.body.data.parts).toEqual([
      { type: 'text', text: 'look' },
      {
        type: 'file',
        url: 'file:///files/entry-1.txt',
        filename: 'notes.txt',
        mediaType: 'text/plain',
        providerMetadata: { cherry: { fileEntryId: 'entry-1' } }
      },
      {
        type: 'data-video',
        data: { filePath: '/files/entry-2.mp4' },
        providerMetadata: { cherry: { fileEntryId: 'entry-2' } }
      },
      { type: 'file', url: 'https://example.com/remote.png', filename: 'remote.png', mediaType: 'image/png' }
    ])
    expect(toast.warning).not.toHaveBeenCalled()
  })

  it('drops embedded media that fails to restore and warns instead of persisting it', async () => {
    const posts: { path: string; body: any }[] = []
    let seq = 0
    vi.mocked(dataApiService.post).mockImplementation(async (path: string, options: any) => {
      const returnedId = path === '/topics' ? 'new-topic' : `msg_${++seq}`
      posts.push({ path, body: options?.body })
      return { id: returnedId }
    })
    vi.mocked(dataApiService.put).mockResolvedValue({ activeNodeId: 'x' })
    vi.mocked(dataApiService.patch).mockResolvedValue({})
    ipcRequest.mockImplementation(async (route: string) => {
      if (route === 'file.batch_create_internal_entries') {
        return { succeeded: [], failed: [{ sourceRef: '#0', error: 'disk full' }] }
      }
      if (route === 'file.batch_get_physical_paths') return {}
      throw new Error(`unexpected ipc route ${route}`)
    })

    const content = JSON.stringify(
      buildCherryTopicFile({
        topic: { name: 'Failing media' },
        messages: [
          makeMessage({
            id: 'u1',
            role: 'user',
            parentId: 'root-1',
            data: {
              parts: [
                { type: 'text', text: 'look' },
                {
                  type: 'file',
                  url: 'data:text/plain;base64,aGVsbG8=',
                  filename: 'notes.txt',
                  mediaType: 'text/plain'
                }
              ]
            },
            createdAt: '2026-01-01T00:00:01.000Z'
          })
        ],
        activeNodeId: 'u1',
        rootId: 'root-1',
        exportedAt: '2026-02-01T00:00:00.000Z'
      })
    )

    const response = await importService.importNativeTopic(content)

    expect(response.success).toBe(true)
    const messageCalls = posts.filter((call) => call.path.includes('/messages'))
    expect(messageCalls[0]?.body.data.parts).toEqual([{ type: 'text', text: 'look' }])
    expect(toast.warning).toHaveBeenCalledWith('import.cherry.skipped_attachments')
  })

  it('drops embedded media when the restore IPC throws instead of aborting the import', async () => {
    const posts: { path: string; body: any }[] = []
    let seq = 0
    vi.mocked(dataApiService.post).mockImplementation(async (path: string, options: any) => {
      const returnedId = path === '/topics' ? 'new-topic' : `msg_${++seq}`
      posts.push({ path, body: options?.body })
      return { id: returnedId }
    })
    vi.mocked(dataApiService.put).mockResolvedValue({ activeNodeId: 'x' })
    vi.mocked(dataApiService.patch).mockResolvedValue({})
    ipcRequest.mockImplementation(async (route: string) => {
      if (route === 'file.batch_create_internal_entries') {
        throw new IpcError('INTERNAL', 'worker gone')
      }
      throw new Error(`unexpected ipc route ${route}`)
    })

    const content = JSON.stringify(
      buildCherryTopicFile({
        topic: { name: 'IPC failure' },
        messages: [
          makeMessage({
            id: 'u1',
            role: 'user',
            parentId: 'root-1',
            data: {
              parts: [
                { type: 'text', text: 'look' },
                {
                  type: 'file',
                  url: 'data:text/plain;base64,aGVsbG8=',
                  filename: 'notes.txt',
                  mediaType: 'text/plain'
                },
                {
                  type: 'data-video',
                  data: { url: 'data:video/mp4;base64,AAAAIGZ0eXA=' }
                }
              ]
            },
            createdAt: '2026-01-01T00:00:01.000Z'
          })
        ],
        activeNodeId: 'u1',
        rootId: 'root-1',
        exportedAt: '2026-02-01T00:00:00.000Z'
      })
    )

    const response = await importService.importNativeTopic(content)

    expect(response.success).toBe(true)
    const messageCalls = posts.filter((call) => call.path.includes('/messages'))
    expect(messageCalls[0]?.body.data.parts).toEqual([{ type: 'text', text: 'look' }])
    expect(toast.warning).toHaveBeenCalledWith('import.cherry.skipped_attachments')
  })

  it('removes the created topic when persisting fails midway', async () => {
    let messageCalls = 0
    vi.mocked(dataApiService.post).mockImplementation(async (path: string) => {
      if (path === '/topics') return { id: 'new-topic' }
      messageCalls += 1
      if (messageCalls > 1) throw new Error('db gone')
      return { id: `msg_${messageCalls}` }
    })
    ipcRequest.mockResolvedValue({ deletedIds: ['new-topic'], deletedCount: 1 })
    vi.mocked(dataApiService.put).mockResolvedValue({ activeNodeId: 'x' })
    vi.mocked(dataApiService.patch).mockResolvedValue({})

    const response = await importService.importNativeTopic(nativeFileContent())

    expect(response.success).toBe(false)
    expect(response.topicsCount).toBe(0)
    expect(ipcRequest).toHaveBeenCalledWith('trash.topic.delete_permanently', { topicIds: ['new-topic'] })
  })

  it('purges a partially imported native topic archived by another window', async () => {
    vi.mocked(dataApiService.post).mockImplementation(async (path: string) => {
      if (path === '/topics') return { id: 'archived-native' }
      throw new Error('native persistence failed')
    })
    ipcRequest.mockRejectedValue(new IpcError('TRASH_TARGET_NOT_FOUND', 'Topic not found'))
    vi.mocked(dataApiService.delete).mockResolvedValue(undefined)

    const result = await importService.importNativeTopic(nativeFileContent(false))

    expect(result.success).toBe(false)
    expect(result.error).toBe('native persistence failed')
    expect(dataApiService.delete).toHaveBeenCalledWith('/topics/archived-native', { query: { permanent: true } })
    expect(ipcRequest).not.toHaveBeenCalledWith('trash.assistant.delete_permanently', expect.anything())
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
