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

const ipcRequest = vi.hoisted(() => vi.fn())
vi.mock('@renderer/ipc', () => ({ ipcApi: { request: ipcRequest } }))

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

  describe('managed attachments', () => {
    const fileMessage = (parts: NonNullable<Message['data']['parts']>) =>
      makeMessage({
        id: 'u1',
        role: 'user',
        parentId: 'root-1',
        data: { parts },
        createdAt: '2026-01-01T00:00:01.000Z'
      })

    function withU1Parts(parts: NonNullable<Message['data']['parts']>) {
      const original = messagesById.u1
      messagesById.u1 = fileMessage(parts)
      return () => {
        messagesById.u1 = original
      }
    }

    beforeEach(() => {
      ipcRequest.mockReset()
    })

    it('inlines managed file bytes as data urls so the file is self-contained', async () => {
      ipcRequest.mockImplementation(async (route: string) => {
        if (route === 'file.get_metadata') return { kind: 'file', size: 3 }
        return { content: new Uint8Array([1, 2, 3]), mime: 'image/png' }
      })
      const restore = withU1Parts([
        { type: 'text', text: 'look' },
        {
          type: 'file',
          url: 'file:///tmp/photo.png',
          filename: 'photo.png',
          mediaType: 'image/png',
          providerMetadata: { cherry: { fileEntryId: 'entry-1' } }
        }
      ])
      try {
        const file = await collectTopicFileData('topic-1')

        expect(ipcRequest).toHaveBeenCalledWith('file.read', {
          handle: { kind: 'path', path: '/tmp/photo.png' },
          options: { mode: 'full', encoding: 'binary' }
        })
        const parts = file.messages.find((message) => message.sourceId === 'u1')?.parts as unknown[]
        expect(parts).toEqual([
          { type: 'text', text: 'look' },
          {
            type: 'file',
            url: 'data:image/png;base64,AQID',
            filename: 'photo.png',
            mediaType: 'image/png',
            providerMetadata: { cherry: { fileEntryId: 'entry-1' } }
          }
        ])
        expect(validateCherryTopicFileContent(JSON.stringify(file))).toBe(true)
        expect(toast.warning).not.toHaveBeenCalled()
      } finally {
        restore()
      }
    })

    it('drops unreadable attachments and warns instead of losing them silently', async () => {
      ipcRequest.mockImplementation(async (route: string) => {
        if (route === 'file.get_metadata') return { kind: 'file', size: 3 }
        throw new Error('gone')
      })
      const restore = withU1Parts([
        { type: 'file', url: 'file:///tmp/photo.png', filename: 'photo.png', mediaType: 'image/png' }
      ])
      try {
        const file = await collectTopicFileData('topic-1')

        const parts = file.messages.find((message) => message.sourceId === 'u1')?.parts
        expect(parts).toEqual([])
        expect(validateCherryTopicFileContent(JSON.stringify(file))).toBe(true)
        // The i18n test double returns the key; interpolation is covered by i18n:check.
        expect(toast.warning).toHaveBeenCalledWith('chat.topics.export.topic_file_skipped_attachments')
      } finally {
        restore()
      }
    })

    it('skips over-limit attachments without reading them', async () => {
      ipcRequest.mockImplementation(async (route: string) => {
        if (route === 'file.get_metadata') return { kind: 'file', size: 11 * 1024 * 1024 }
        throw new Error('file.read must not be called for over-limit attachments')
      })
      const restore = withU1Parts([
        { type: 'file', url: 'file:///tmp/huge.mp4', filename: 'huge.mp4', mediaType: 'video/mp4' }
      ])
      try {
        const file = await collectTopicFileData('topic-1')

        expect(ipcRequest).not.toHaveBeenCalledWith('file.read', expect.anything())
        const parts = file.messages.find((message) => message.sourceId === 'u1')?.parts
        expect(parts).toEqual([])
        expect(toast.warning).toHaveBeenCalledWith('chat.topics.export.topic_file_skipped_attachments')
      } finally {
        restore()
      }
    })

    it('drops pre-embedded data urls over the cap and warns', async () => {
      const restore = withU1Parts([
        {
          type: 'file',
          url: `data:image/png;base64,${'B'.repeat(15 * 1024 * 1024)}`,
          filename: 'big.png',
          mediaType: 'image/png'
        }
      ])
      try {
        const file = await collectTopicFileData('topic-1')

        expect(ipcRequest).not.toHaveBeenCalled()
        const parts = file.messages.find((message) => message.sourceId === 'u1')?.parts
        expect(parts).toEqual([])
        expect(toast.warning).toHaveBeenCalledWith('chat.topics.export.topic_file_skipped_attachments')
      } finally {
        restore()
      }
    })

    it('keeps pre-embedded data urls within the cap', async () => {
      const restore = withU1Parts([
        { type: 'file', url: 'data:image/png;base64,AQID', filename: 'small.png', mediaType: 'image/png' }
      ])
      try {
        const file = await collectTopicFileData('topic-1')

        const parts = file.messages.find((message) => message.sourceId === 'u1')?.parts
        expect(parts).toHaveLength(1)
        expect(toast.warning).not.toHaveBeenCalled()
      } finally {
        restore()
      }
    })
  })

  describe('persisted tool outputs', () => {
    const persistedPart = {
      type: 'dynamic-tool',
      toolCallId: 'call-1',
      toolName: 'read_file',
      state: 'output-available',
      input: {},
      output: {
        $persistedToolOutput: {
          fileEntryId: 'blob-1',
          vfsFilename: 'vfs_abc.txt',
          head: 'excerpt head',
          tail: 'excerpt tail',
          totalChars: 24,
          totalLines: 2,
          shape: 'text'
        }
      }
    } as const

    function withToolPart() {
      const original = messagesById.u1
      messagesById.u1 = {
        ...original,
        data: { parts: [{ type: 'text', text: 'run' } as const, persistedPart] }
      }
      return () => {
        messagesById.u1 = original
      }
    }

    beforeEach(() => {
      ipcRequest.mockReset()
    })

    it('resolves persisted envelopes to full values so imports carry them', async () => {
      ipcRequest.mockResolvedValue({ found: true, output: 'full tool output text' })
      const restore = withToolPart()
      try {
        const file = await collectTopicFileData('topic-1')

        expect(ipcRequest).toHaveBeenCalledWith('ai.tool.get_result', {
          topicId: 'topic-1',
          messageId: 'u1',
          toolCallId: 'call-1'
        })
        const parts = file.messages.find((message) => message.sourceId === 'u1')?.parts as unknown[]
        expect(parts[1]).toMatchObject({ toolCallId: 'call-1', output: 'full tool output text' })
        expect(validateCherryTopicFileContent(JSON.stringify(file))).toBe(true)
        expect(toast.warning).not.toHaveBeenCalled()
      } finally {
        restore()
      }
    })

    it('keeps the excerpt and warns when the full output is gone', async () => {
      ipcRequest.mockResolvedValue({ found: false })
      const restore = withToolPart()
      try {
        const file = await collectTopicFileData('topic-1')

        const parts = file.messages.find((message) => message.sourceId === 'u1')?.parts as unknown[]
        expect(parts[1]).toMatchObject({ output: persistedPart.output })
        expect(validateCherryTopicFileContent(JSON.stringify(file))).toBe(true)
        expect(toast.warning).toHaveBeenCalledWith('chat.topics.export.topic_file_skipped_tool_outputs')
      } finally {
        restore()
      }
    })

    it('keeps the excerpt and warns when the full output is over the cap', async () => {
      ipcRequest.mockResolvedValue({ found: true, output: 'x'.repeat(11 * 1024 * 1024) })
      const restore = withToolPart()
      try {
        const file = await collectTopicFileData('topic-1')

        const parts = file.messages.find((message) => message.sourceId === 'u1')?.parts as unknown[]
        expect(parts[1]).toMatchObject({ output: persistedPart.output })
        expect(toast.warning).toHaveBeenCalledWith('chat.topics.export.topic_file_skipped_tool_outputs')
      } finally {
        restore()
      }
    })
  })
})
