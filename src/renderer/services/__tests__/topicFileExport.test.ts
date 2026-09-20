import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { dataApiService } from '@data/DataApiService'
import { validateCherryTopicFileContent } from '@renderer/services/import'
import { toast } from '@renderer/services/toast'
import type { Message } from '@shared/data/types/message'

vi.mock('@renderer/i18n/resolver', () => ({
  default: {
    t: vi.fn((_key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? _key)
  }
}))

const { collectTopicFileData, exportTopicAsFile } = await import('../topicFileExport')

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

const snapshot = {
  id: 'assistant-1',
  name: 'Ast',
  model: { id: 'model-1', name: 'Model 1', provider: 'provider-1' }
}

const messagesById: Record<string, Message> = {
  u1: makeMessage({ id: 'u1', role: 'user', parentId: 'root-1', createdAt: '2026-01-01T00:00:01.000Z' }),
  a1: makeMessage({
    id: 'a1',
    role: 'assistant',
    parentId: 'u1',
    messageSnapshot: snapshot,
    createdAt: '2026-01-01T00:00:02.000Z'
  }),
  u2: makeMessage({ id: 'u2', role: 'user', parentId: 'root-1', createdAt: '2026-01-01T00:00:03.000Z' }),
  a2a: makeMessage({
    id: 'a2a',
    role: 'assistant',
    parentId: 'u2',
    siblingsGroupId: 7,
    messageSnapshot: snapshot,
    createdAt: '2026-01-01T00:00:04.000Z'
  }),
  a2b: makeMessage({
    id: 'a2b',
    role: 'assistant',
    parentId: 'u2',
    siblingsGroupId: 7,
    status: 'paused',
    messageSnapshot: snapshot,
    createdAt: '2026-01-01T00:00:05.000Z'
  })
}

const treeNode = (id: string) => ({
  id,
  parentId: 'root-1',
  role: 'user' as const,
  preview: id,
  status: 'success' as const,
  createdAt: '2026-01-01T00:00:00.000Z',
  hasChildren: false
})

function mockDataApi(assistantFails = false) {
  vi.mocked(dataApiService.get).mockImplementation(async (path: string) => {
    if (path === '/topics/topic-1') {
      return {
        id: 'topic-1',
        name: 'My Topic',
        isNameManuallyEdited: true,
        assistantId: 'assistant-1',
        orderKey: 'a0',
        lastActivityAt: '2026-01-01T00:00:00.000Z',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z'
      }
    }
    if (path === '/topics/topic-1/tree') {
      return {
        nodes: [treeNode('u1'), treeNode('a1'), treeNode('u2')],
        siblingsGroups: [{ parentId: 'u2', siblingsGroupId: 7, nodes: [treeNode('a2a'), treeNode('a2b')] }],
        activeNodeId: 'a2b',
        rootId: 'root-1'
      }
    }
    if (path.startsWith('/messages/')) {
      const message = messagesById[path.slice('/messages/'.length)]
      if (!message) throw new Error(`unknown message ${path}`)
      return message
    }
    if (path === '/assistants/assistant-1') {
      if (assistantFails) throw new Error('gone')
      return { id: 'assistant-1', name: 'Ast', emoji: '🤖' }
    }
    throw new Error(`unexpected GET ${path}`)
  })
}

const rendererTopic = {
  id: 'topic-1',
  assistantId: 'assistant-1',
  name: 'My Topic',
  lastActivityAt: '2026-01-01T00:00:00.000Z',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  messages: []
} as any

describe('topicFileExport', () => {
  const saveMock = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    ;(window as any).api = { file: { save: saveMock } }
    saveMock.mockResolvedValue('/tmp/My Topic.cherry.json')
    mockDataApi()
  })

  afterEach(() => {
    delete (window as any).api
  })

  it('collects the whole tree including sibling groups into a valid file', async () => {
    const file = await collectTopicFileData('topic-1')

    expect(validateCherryTopicFileContent(JSON.stringify(file))).toBe(true)
    expect(file.topic).toEqual({ name: 'My Topic', isNameManuallyEdited: true })
    expect(file.assistant).toEqual({ name: 'Ast', emoji: '🤖' })
    expect(file.messages.map((message) => message.sourceId)).toEqual(['u1', 'a1', 'u2', 'a2a', 'a2b'])
    expect(file.messages.find((message) => message.sourceId === 'a2b')).toMatchObject({
      parentSourceId: 'u2',
      siblingsGroupId: 7,
      status: 'paused',
      messageSnapshot: snapshot
    })
    expect(file.activeSourceId).toBe('a2b')
    const fetchedIds = vi
      .mocked(dataApiService.get)
      .mock.calls.map(([path]) => path)
      .filter((path) => path.startsWith('/messages/'))
    expect(fetchedIds).toHaveLength(5)
  })

  it('omits the assistant snapshot when the assistant is gone', async () => {
    mockDataApi(true)

    const file = await collectTopicFileData('topic-1')

    expect(file.assistant).toBeUndefined()
    expect(validateCherryTopicFileContent(JSON.stringify(file))).toBe(true)
  })

  it('saves a cherry file and announces success', async () => {
    await exportTopicAsFile(rendererTopic)

    expect(saveMock).toHaveBeenCalledOnce()
    const [fileName, content] = saveMock.mock.calls[0] as [string, string]
    expect(fileName.endsWith('.cherry.json')).toBe(true)
    expect(validateCherryTopicFileContent(content)).toBe(true)
    expect(toast.success).toHaveBeenCalledOnce()
  })

  it('announces an error and writes nothing when loading fails', async () => {
    vi.mocked(dataApiService.get).mockRejectedValue(new Error('db gone'))

    await exportTopicAsFile(rendererTopic)

    expect(saveMock).not.toHaveBeenCalled()
    expect(toast.error).toHaveBeenCalledOnce()
  })
})
