import type { Message, Model } from '@renderer/types'
import type { FileMetadata } from '@renderer/types/file'
import { FileTypes } from '@renderer/types/file'
import {
  AssistantMessageStatus,
  type FileMessageBlock,
  type ImageMessageBlock,
  MessageBlockStatus,
  MessageBlockType,
  type ThinkingMessageBlock,
  UserMessageStatus
} from '@renderer/types/newMessage'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { convertFileBlockToFilePartMock, convertFileBlockToTextPartMock } = vi.hoisted(() => ({
  convertFileBlockToFilePartMock: vi.fn(),
  convertFileBlockToTextPartMock: vi.fn()
}))

vi.mock('../fileProcessor', () => ({
  convertFileBlockToFilePart: convertFileBlockToFilePartMock,
  convertFileBlockToTextPart: convertFileBlockToTextPartMock
}))

const visionModelIds = new Set(['gpt-4o-mini', 'qwen-image-edit'])
const imageEnhancementModelIds = new Set(['qwen-image-edit'])

vi.mock('@renderer/config/models', () => ({
  isVisionModel: (model: Model) => visionModelIds.has(model.id),
  isImageEnhancementModel: (model: Model) => imageEnhancementModelIds.has(model.id)
}))

type MockableMessage = Message & {
  __mockContent?: string
  __mockFileBlocks?: FileMessageBlock[]
  __mockImageBlocks?: ImageMessageBlock[]
  __mockThinkingBlocks?: ThinkingMessageBlock[]
}

vi.mock('@renderer/utils/messageUtils/find', () => ({
  getMainTextContent: (message: Message) => (message as MockableMessage).__mockContent ?? '',
  findFileBlocks: (message: Message) => (message as MockableMessage).__mockFileBlocks ?? [],
  findImageBlocks: (message: Message) => (message as MockableMessage).__mockImageBlocks ?? [],
  findThinkingBlocks: (message: Message) => (message as MockableMessage).__mockThinkingBlocks ?? []
}))

import { convertMessagesToSdkMessages, convertMessageToSdkParam } from '../messageConverter'

let messageCounter = 0
let blockCounter = 0

const createModel = (overrides: Partial<Model> = {}): Model => ({
  id: 'gpt-4o-mini',
  name: 'GPT-4o mini',
  provider: 'openai',
  group: 'openai',
  ...overrides
})

const createMessage = (role: Message['role']): MockableMessage =>
  ({
    id: `message-${++messageCounter}`,
    role,
    assistantId: 'assistant-1',
    topicId: 'topic-1',
    createdAt: new Date(2024, 0, 1, 0, 0, messageCounter).toISOString(),
    status: role === 'assistant' ? AssistantMessageStatus.SUCCESS : UserMessageStatus.SUCCESS,
    blocks: []
  }) as MockableMessage

const createFileBlock = (
  messageId: string,
  overrides: Partial<Omit<FileMessageBlock, 'file' | 'messageId' | 'type'>> & { file?: Partial<FileMetadata> } = {}
): FileMessageBlock => {
  const { file, ...blockOverrides } = overrides
  const timestamp = new Date(2024, 0, 1, 0, 0, ++blockCounter).toISOString()
  return {
    id: blockOverrides.id ?? `file-block-${blockCounter}`,
    messageId,
    type: MessageBlockType.FILE,
    createdAt: blockOverrides.createdAt ?? timestamp,
    status: blockOverrides.status ?? MessageBlockStatus.SUCCESS,
    file: {
      id: file?.id ?? `file-${blockCounter}`,
      name: file?.name ?? 'document.txt',
      origin_name: file?.origin_name ?? 'document.txt',
      path: file?.path ?? '/tmp/document.txt',
      size: file?.size ?? 1024,
      ext: file?.ext ?? '.txt',
      type: file?.type ?? FileTypes.TEXT,
      created_at: file?.created_at ?? timestamp,
      count: file?.count ?? 1,
      ...file
    },
    ...blockOverrides
  }
}

const createImageBlock = (
  messageId: string,
  overrides: Partial<Omit<ImageMessageBlock, 'type' | 'messageId'>> = {}
): ImageMessageBlock => ({
  id: overrides.id ?? `image-block-${++blockCounter}`,
  messageId,
  type: MessageBlockType.IMAGE,
  createdAt: overrides.createdAt ?? new Date(2024, 0, 1, 0, 0, blockCounter).toISOString(),
  status: overrides.status ?? MessageBlockStatus.SUCCESS,
  url: overrides.url ?? 'https://example.com/image.png',
  ...overrides
})

describe('messageConverter', () => {
  beforeEach(() => {
    convertFileBlockToFilePartMock.mockReset()
    convertFileBlockToTextPartMock.mockReset()
    convertFileBlockToFilePartMock.mockResolvedValue(null)
    convertFileBlockToTextPartMock.mockResolvedValue(null)
    messageCounter = 0
    blockCounter = 0
  })

  describe('convertMessageToSdkParam', () => {
    it('includes text and image parts for user messages on vision models', async () => {
      const model = createModel()
      const message = createMessage('user')
      message.__mockContent = 'Describe this picture'
      message.__mockImageBlocks = [createImageBlock(message.id, { url: 'https://example.com/cat.png' })]

      const result = await convertMessageToSdkParam(message, true, model)

      expect(result).toEqual({
        role: 'user',
        content: [
          { type: 'text', text: 'Describe this picture' },
          { type: 'image', image: 'https://example.com/cat.png' }
        ]
      })
    })

    it('returns file instructions as a system message when native uploads succeed', async () => {
      const model = createModel()
      const message = createMessage('user')
      message.__mockContent = 'Summarize the PDF'
      message.__mockFileBlocks = [createFileBlock(message.id)]
      convertFileBlockToFilePartMock.mockResolvedValueOnce({
        type: 'file',
        filename: 'document.pdf',
        mediaType: 'application/pdf',
        data: 'fileid://remote-file'
      })

      const result = await convertMessageToSdkParam(message, false, model)

      expect(result).toEqual([
        {
          role: 'system',
          content: 'fileid://remote-file'
        },
        {
          role: 'user',
          content: [{ type: 'text', text: 'Summarize the PDF' }]
        }
      ])
    })
  })

  describe('convertMessagesToSdkMessages', () => {
    it('appends assistant images to the final user message for image enhancement models', async () => {
      const model = createModel({ id: 'qwen-image-edit', name: 'Qwen Image Edit', provider: 'qwen', group: 'qwen' })
      const initialUser = createMessage('user')
      initialUser.__mockContent = 'Start editing'

      const assistant = createMessage('assistant')
      assistant.__mockContent = 'Here is the current preview'
      assistant.__mockImageBlocks = [createImageBlock(assistant.id, { url: 'https://example.com/preview.png' })]

      const finalUser = createMessage('user')
      finalUser.__mockContent = 'Increase the brightness'

      const result = await convertMessagesToSdkMessages([initialUser, assistant, finalUser], model)

      expect(result).toEqual([
        {
          role: 'user',
          content: [{ type: 'text', text: 'Start editing' }]
        },
        {
          role: 'assistant',
          content: [{ type: 'text', text: 'Here is the current preview' }]
        },
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Increase the brightness' },
            { type: 'image', image: 'https://example.com/preview.png' }
          ]
        }
      ])
    })

    it('preserves preceding system instructions when building enhancement payloads', async () => {
      const model = createModel({ id: 'qwen-image-edit', name: 'Qwen Image Edit', provider: 'qwen', group: 'qwen' })
      const fileUser = createMessage('user')
      fileUser.__mockContent = 'Use this document as inspiration'
      fileUser.__mockFileBlocks = [createFileBlock(fileUser.id, { file: { ext: '.pdf', type: FileTypes.DOCUMENT } })]
      convertFileBlockToFilePartMock.mockResolvedValueOnce({
        type: 'file',
        filename: 'reference.pdf',
        mediaType: 'application/pdf',
        data: 'fileid://reference'
      })

      const assistant = createMessage('assistant')
      assistant.__mockContent = 'Generated previews ready'
      assistant.__mockImageBlocks = [createImageBlock(assistant.id, { url: 'https://example.com/reference.png' })]

      const finalUser = createMessage('user')
      finalUser.__mockContent = 'Apply the edits'

      const result = await convertMessagesToSdkMessages([fileUser, assistant, finalUser], model)

      expect(result).toEqual([
        { role: 'system', content: 'fileid://reference' },
        { role: 'user', content: [{ type: 'text', text: 'Use this document as inspiration' }] },
        {
          role: 'assistant',
          content: [{ type: 'text', text: 'Generated previews ready' }]
        },
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Apply the edits' },
            { type: 'image', image: 'https://example.com/reference.png' }
          ]
        }
      ])
    })
  })
})
