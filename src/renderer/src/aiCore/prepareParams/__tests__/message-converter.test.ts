import type { Message, Model } from '@renderer/types'
import type { FileMetadata } from '@renderer/types/file'
import { FILE_TYPE } from '@renderer/types/file'
import {
  AssistantMessageStatus,
  type FileMessageBlock,
  type ImageMessageBlock,
  type MainTextMessageBlock,
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
  __mockMainTextBlocks?: MainTextMessageBlock[]
}

vi.mock('@renderer/utils/messageUtils/find', () => ({
  getMainTextContent: (message: Message) => (message as MockableMessage).__mockContent ?? '',
  findFileBlocks: (message: Message) => (message as MockableMessage).__mockFileBlocks ?? [],
  findImageBlocks: (message: Message) => (message as MockableMessage).__mockImageBlocks ?? [],
  findThinkingBlocks: (message: Message) => (message as MockableMessage).__mockThinkingBlocks ?? [],
  findMainTextBlocks: (message: Message) => (message as MockableMessage).__mockMainTextBlocks ?? []
}))

import { convertMessagesToSdkMessages, convertMessageToSdkParam, stripMarkdownBase64Images } from '../messageConverter'

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
      type: file?.type ?? FILE_TYPE.TEXT,
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

const createThinkingBlock = (
  messageId: string,
  overrides: Partial<Omit<ThinkingMessageBlock, 'type' | 'messageId'>> = {}
): ThinkingMessageBlock => ({
  id: overrides.id ?? `thinking-block-${++blockCounter}`,
  messageId,
  type: MessageBlockType.THINKING,
  createdAt: overrides.createdAt ?? new Date(2024, 0, 1, 0, 0, blockCounter).toISOString(),
  status: overrides.status ?? MessageBlockStatus.SUCCESS,
  content: overrides.content ?? 'Let me think...',
  thinking_millsec: overrides.thinking_millsec ?? 1000,
  ...overrides
})

const createMainTextBlock = (
  messageId: string,
  overrides: Partial<Omit<MainTextMessageBlock, 'type' | 'messageId'>> = {}
): MainTextMessageBlock => ({
  id: overrides.id ?? `main-text-block-${++blockCounter}`,
  messageId,
  type: MessageBlockType.MAIN_TEXT,
  createdAt: overrides.createdAt ?? new Date(2024, 0, 1, 0, 0, blockCounter).toISOString(),
  status: overrides.status ?? MessageBlockStatus.SUCCESS,
  content: overrides.content ?? '',
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

    it('extracts base64 data from data URLs and preserves mediaType', async () => {
      const model = createModel()
      const message = createMessage('user')
      message.__mockContent = 'Check this image'
      message.__mockImageBlocks = [createImageBlock(message.id, { url: 'data:image/png;base64,iVBORw0KGgoAAAANS' })]

      const result = await convertMessageToSdkParam(message, true, model)

      expect(result).toEqual({
        role: 'user',
        content: [
          { type: 'text', text: 'Check this image' },
          { type: 'image', image: 'iVBORw0KGgoAAAANS', mediaType: 'image/png' }
        ]
      })
    })

    it('handles data URLs without mediaType gracefully', async () => {
      const model = createModel()
      const message = createMessage('user')
      message.__mockContent = 'Check this'
      message.__mockImageBlocks = [createImageBlock(message.id, { url: 'data:;base64,AAABBBCCC' })]

      const result = await convertMessageToSdkParam(message, true, model)

      expect(result).toEqual({
        role: 'user',
        content: [
          { type: 'text', text: 'Check this' },
          { type: 'image', image: 'AAABBBCCC' }
        ]
      })
    })

    it('skips malformed data URLs without comma separator', async () => {
      const model = createModel()
      const message = createMessage('user')
      message.__mockContent = 'Malformed data url'
      message.__mockImageBlocks = [createImageBlock(message.id, { url: 'data:image/pngAAABBB' })]

      const result = await convertMessageToSdkParam(message, true, model)

      expect(result).toEqual({
        role: 'user',
        content: [
          { type: 'text', text: 'Malformed data url' }
          // Malformed data URL is excluded from the content
        ]
      })
    })

    it('handles multiple large base64 images without stack overflow', async () => {
      const model = createModel()
      const message = createMessage('user')
      // Create large base64 strings (~500KB each) to simulate real-world large images
      const largeBase64 = 'A'.repeat(500_000)
      message.__mockContent = 'Check these images'
      message.__mockImageBlocks = [
        createImageBlock(message.id, { url: `data:image/png;base64,${largeBase64}` }),
        createImageBlock(message.id, { url: `data:image/png;base64,${largeBase64}` }),
        createImageBlock(message.id, { url: `data:image/png;base64,${largeBase64}` })
      ]

      // Should not throw RangeError: Maximum call stack size exceeded
      await expect(convertMessageToSdkParam(message, true, model)).resolves.toBeDefined()
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

    it('includes reasoning parts for assistant messages with thinking blocks', async () => {
      const model = createModel()
      const message = createMessage('assistant')
      message.__mockContent = 'Here is my answer'
      message.__mockThinkingBlocks = [createThinkingBlock(message.id, { content: 'Let me think...' })]

      const result = await convertMessageToSdkParam(message, false, model)

      // Reasoning blocks must come before text blocks (required by AWS Bedrock for Claude extended thinking)
      expect(result).toEqual({
        role: 'assistant',
        content: [
          { type: 'reasoning', text: 'Let me think...' },
          { type: 'text', text: 'Here is my answer' }
        ]
      })
    })

    it('excludes empty content from assistant messages', async () => {
      const model = createModel()
      const message = createMessage('assistant')
      message.__mockContent = ''
      message.__mockThinkingBlocks = [createThinkingBlock(message.id, { content: 'Thinking only' })]

      const result = await convertMessageToSdkParam(message, false, model)

      // Empty content should not create a text block
      expect(result).toEqual({
        role: 'assistant',
        content: [{ type: 'reasoning', text: 'Thinking only' }]
      })
    })

    it('excludes whitespace-only content from assistant messages', async () => {
      const model = createModel()
      const message = createMessage('assistant')
      message.__mockContent = '   \n\t  '
      message.__mockThinkingBlocks = [createThinkingBlock(message.id, { content: 'Thinking only' })]

      const result = await convertMessageToSdkParam(message, false, model)

      // Whitespace-only content should not create a text block
      expect(result).toEqual({
        role: 'assistant',
        content: [{ type: 'reasoning', text: 'Thinking only' }]
      })
    })

    it('trims content in assistant messages', async () => {
      const model = createModel()
      const message = createMessage('assistant')
      message.__mockContent = '  Trimmed answer  \n'
      message.__mockThinkingBlocks = []

      const result = await convertMessageToSdkParam(message, false, model)

      expect(result).toEqual({
        role: 'assistant',
        content: [{ type: 'text', text: 'Trimmed answer' }]
      })
    })

    it('includes thoughtSignature in providerOptions for Gemini thought signature persistence', async () => {
      const model = createModel()
      const message = createMessage('assistant')
      message.__mockContent = 'Here is my answer'
      message.__mockMainTextBlocks = [
        createMainTextBlock(message.id, {
          content: 'Here is my answer',
          metadata: { thoughtSignature: 'test-thought-signature-token' }
        })
      ]

      const result = await convertMessageToSdkParam(message, false, model)

      expect(result).toEqual({
        role: 'assistant',
        content: [
          {
            type: 'text',
            text: 'Here is my answer',
            providerOptions: {
              google: {
                thoughtSignature: 'test-thought-signature-token'
              }
            }
          }
        ]
      })
    })

    it('does not include providerOptions when no thoughtSignature is present', async () => {
      const model = createModel()
      const message = createMessage('assistant')
      message.__mockContent = 'Plain answer'
      message.__mockMainTextBlocks = [createMainTextBlock(message.id, { content: 'Plain answer' })]

      const result = await convertMessageToSdkParam(message, false, model)

      expect(result).toEqual({
        role: 'assistant',
        content: [{ type: 'text', text: 'Plain answer' }]
      })
    })

    it('uses thoughtSignature from the first matching MainTextBlock when multiple exist', async () => {
      const model = createModel()
      const message = createMessage('assistant')
      message.__mockContent = 'Answer text'
      message.__mockMainTextBlocks = [
        createMainTextBlock(message.id, { content: 'Answer text', metadata: { thoughtSignature: 'first-signature' } }),
        createMainTextBlock(message.id, {
          content: 'Another block',
          metadata: { thoughtSignature: 'second-signature' }
        })
      ]

      const result = await convertMessageToSdkParam(message, false, model)

      expect(result).toEqual({
        role: 'assistant',
        content: [
          {
            type: 'text',
            text: 'Answer text',
            providerOptions: {
              google: {
                thoughtSignature: 'first-signature'
              }
            }
          }
        ]
      })
    })

    it('combines reasoning blocks with thoughtSignature text part', async () => {
      const model = createModel()
      const message = createMessage('assistant')
      message.__mockContent = 'Final answer'
      message.__mockThinkingBlocks = [createThinkingBlock(message.id, { content: 'Thinking step' })]
      message.__mockMainTextBlocks = [
        createMainTextBlock(message.id, {
          content: 'Final answer',
          metadata: { thoughtSignature: 'sig-with-reasoning' }
        })
      ]

      const result = await convertMessageToSdkParam(message, false, model)

      expect(result).toEqual({
        role: 'assistant',
        content: [
          { type: 'reasoning', text: 'Thinking step' },
          {
            type: 'text',
            text: 'Final answer',
            providerOptions: {
              google: {
                thoughtSignature: 'sig-with-reasoning'
              }
            }
          }
        ]
      })
    })
  })

  describe('convertMessagesToSdkMessages', () => {
    it('preserves conversation history and merges images for image enhancement models', async () => {
      const model = createModel({ id: 'qwen-image-edit', name: 'Qwen Image Edit', provider: 'qwen', group: 'qwen' })
      const initialUser = createMessage('user')
      initialUser.__mockContent = 'Start editing'

      const assistant = createMessage('assistant')
      assistant.__mockContent = 'Here is the current preview'
      assistant.__mockImageBlocks = [createImageBlock(assistant.id, { url: 'https://example.com/preview.png' })]

      const finalUser = createMessage('user')
      finalUser.__mockContent = 'Increase the brightness'

      const result = await convertMessagesToSdkMessages([initialUser, assistant, finalUser], model)

      // Preserves all conversation history, only merges images into the last user message
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

    it('preserves system messages and conversation history for enhancement payloads', async () => {
      const model = createModel({ id: 'qwen-image-edit', name: 'Qwen Image Edit', provider: 'qwen', group: 'qwen' })
      const fileUser = createMessage('user')
      fileUser.__mockContent = 'Use this document as inspiration'
      fileUser.__mockFileBlocks = [createFileBlock(fileUser.id, { file: { ext: '.pdf', type: FILE_TYPE.DOCUMENT } })]
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

      // Preserves system message, conversation history, and merges images into the last user message
      expect(result).toEqual([
        { role: 'system', content: 'fileid://reference' },
        {
          role: 'user',
          content: [{ type: 'text', text: 'Use this document as inspiration' }]
        },
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

    it('returns messages as-is when no previous assistant message with images', async () => {
      const model = createModel({ id: 'qwen-image-edit', name: 'Qwen Image Edit', provider: 'qwen', group: 'qwen' })
      const user1 = createMessage('user')
      user1.__mockContent = 'Start'

      const user2 = createMessage('user')
      user2.__mockContent = 'Continue without images'

      const result = await convertMessagesToSdkMessages([user1, user2], model)

      // No images to merge, returns all messages as-is
      expect(result).toEqual([
        {
          role: 'user',
          content: [{ type: 'text', text: 'Start' }]
        },
        {
          role: 'user',
          content: [{ type: 'text', text: 'Continue without images' }]
        }
      ])
    })

    it('returns messages as-is when assistant message has no images', async () => {
      const model = createModel({ id: 'qwen-image-edit', name: 'Qwen Image Edit', provider: 'qwen', group: 'qwen' })
      const user1 = createMessage('user')
      user1.__mockContent = 'Start'

      const assistant = createMessage('assistant')
      assistant.__mockContent = 'Text only response'
      assistant.__mockImageBlocks = []

      const user2 = createMessage('user')
      user2.__mockContent = 'Follow up'

      const result = await convertMessagesToSdkMessages([user1, assistant, user2], model)

      // No images to merge, returns all messages as-is
      expect(result).toEqual([
        {
          role: 'user',
          content: [{ type: 'text', text: 'Start' }]
        },
        {
          role: 'assistant',
          content: [{ type: 'text', text: 'Text only response' }]
        },
        {
          role: 'user',
          content: [{ type: 'text', text: 'Follow up' }]
        }
      ])
    })

    it('merges images from the most recent assistant message', async () => {
      const model = createModel({ id: 'qwen-image-edit', name: 'Qwen Image Edit', provider: 'qwen', group: 'qwen' })
      const user1 = createMessage('user')
      user1.__mockContent = 'Start'

      const assistant1 = createMessage('assistant')
      assistant1.__mockContent = 'First response'
      assistant1.__mockImageBlocks = [createImageBlock(assistant1.id, { url: 'https://example.com/old.png' })]

      const user2 = createMessage('user')
      user2.__mockContent = 'Continue'

      const assistant2 = createMessage('assistant')
      assistant2.__mockContent = 'Second response'
      assistant2.__mockImageBlocks = [createImageBlock(assistant2.id, { url: 'https://example.com/new.png' })]

      const user3 = createMessage('user')
      user3.__mockContent = 'Final request'

      const result = await convertMessagesToSdkMessages([user1, assistant1, user2, assistant2, user3], model)

      // Preserves all history, merges only the most recent assistant's images
      expect(result).toEqual([
        {
          role: 'user',
          content: [{ type: 'text', text: 'Start' }]
        },
        {
          role: 'assistant',
          content: [{ type: 'text', text: 'First response' }]
        },
        {
          role: 'user',
          content: [{ type: 'text', text: 'Continue' }]
        },
        {
          role: 'assistant',
          content: [{ type: 'text', text: 'Second response' }]
        },
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Final request' },
            { type: 'image', image: 'https://example.com/new.png' }
          ]
        }
      ])
    })

    it('returns messages as-is when conversation ends with assistant message', async () => {
      const model = createModel({ id: 'qwen-image-edit', name: 'Qwen Image Edit', provider: 'qwen', group: 'qwen' })
      const user = createMessage('user')
      user.__mockContent = 'Start'

      const assistant = createMessage('assistant')
      assistant.__mockContent = 'Response with image'
      assistant.__mockImageBlocks = [createImageBlock(assistant.id, { url: 'https://example.com/image.png' })]

      const result = await convertMessagesToSdkMessages([user, assistant], model)

      // The user message is the last user message, but since the assistant comes after,
      // there's no "previous" assistant message (search starts from messages.length-2 backwards)
      // So no images to merge, returns all messages as-is
      expect(result).toEqual([
        {
          role: 'user',
          content: [{ type: 'text', text: 'Start' }]
        },
        {
          role: 'assistant',
          content: [{ type: 'text', text: 'Response with image' }]
        }
      ])
    })

    it('merges images even when last user message has empty content', async () => {
      const model = createModel({ id: 'qwen-image-edit', name: 'Qwen Image Edit', provider: 'qwen', group: 'qwen' })
      const user1 = createMessage('user')
      user1.__mockContent = 'Start'

      const assistant = createMessage('assistant')
      assistant.__mockContent = 'Here is the preview'
      assistant.__mockImageBlocks = [createImageBlock(assistant.id, { url: 'https://example.com/preview.png' })]

      const user2 = createMessage('user')
      user2.__mockContent = ''

      const result = await convertMessagesToSdkMessages([user1, assistant, user2], model)

      // Preserves history, merges images into last user message (even if empty)
      expect(result).toEqual([
        {
          role: 'user',
          content: [{ type: 'text', text: 'Start' }]
        },
        {
          role: 'assistant',
          content: [{ type: 'text', text: 'Here is the preview' }]
        },
        {
          role: 'user',
          content: [{ type: 'image', image: 'https://example.com/preview.png' }]
        }
      ])
    })

    it('strips inline base64 data URIs from assistant text to prevent HTTP 413 (#12602)', async () => {
      const model = createModel({ id: 'gpt-4o-mini' })
      const user1 = createMessage('user')
      user1.__mockContent = 'Generate an image of a cat'

      const assistant = createMessage('assistant')
      assistant.__mockContent =
        'Here is the image you requested:\n![cat](data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAA...VeryLongBase64String)\nHope you like it!'

      const user2 = createMessage('user')
      user2.__mockContent = 'Now describe what you see'

      const result = await convertMessagesToSdkMessages([user1, assistant, user2], model)

      const assistantMsg = result.find((m) => m.role === 'assistant')!
      const textPart = (assistantMsg.content as Array<{ type: string; text: string }>).find((p) => p.type === 'text')!
      // The base64 data URI should be replaced with a placeholder
      expect(textPart.text).not.toContain('data:image/')
      expect(textPart.text).toContain('![cat](image)')
      expect(textPart.text).toContain('Hope you like it!')
    })

    it('strips multiple inline base64 images from assistant text', async () => {
      const model = createModel({ id: 'gpt-4o-mini' })
      const user = createMessage('user')
      user.__mockContent = 'Generate two images'

      const assistant = createMessage('assistant')
      assistant.__mockContent = '![first](data:image/png;base64,AAABBB) and ![second](data:image/jpeg;base64,CCCDDD)'

      const result = await convertMessageToSdkParam(assistant, false, model)
      const textPart = ((result as any).content as Array<{ type: string; text: string }>).find(
        (p) => p.type === 'text'
      )!
      expect(textPart.text).toBe('![first](image) and ![second](image)')
    })

    it('preserves regular markdown images (non-base64) in assistant text', async () => {
      const model = createModel({ id: 'gpt-4o-mini' })
      const assistant = createMessage('assistant')
      assistant.__mockContent = 'Check this out: ![photo](https://example.com/photo.png)'

      const result = await convertMessageToSdkParam(assistant, false, model)
      const textPart = ((result as any).content as Array<{ type: string; text: string }>).find(
        (p) => p.type === 'text'
      )!
      expect(textPart.text).toBe('Check this out: ![photo](https://example.com/photo.png)')
    })

    it('allows using LLM conversation context for image generation', async () => {
      // This test verifies the key use case: switching from LLM to image enhancement model
      // and using the previous conversation as context for image generation
      const model = createModel({ id: 'qwen-image-edit', name: 'Qwen Image Edit', provider: 'qwen', group: 'qwen' })

      // Simulate a conversation that started with a regular LLM
      const user1 = createMessage('user')
      user1.__mockContent = 'Help me design a futuristic robot with blue lights'

      const assistant1 = createMessage('assistant')
      assistant1.__mockContent =
        'Great idea! The robot could have a sleek metallic body with glowing blue LED strips...'
      assistant1.__mockImageBlocks = [] // LLM response, no images

      const user2 = createMessage('user')
      user2.__mockContent = 'Yes, and add some chrome accents'

      const assistant2 = createMessage('assistant')
      assistant2.__mockContent = 'Perfect! Chrome accents would complement the blue lights beautifully...'
      assistant2.__mockImageBlocks = [] // Still LLM response, no images

      // User switches to image enhancement model and asks for image generation
      const user3 = createMessage('user')
      user3.__mockContent = 'Now generate an image based on our discussion'

      const result = await convertMessagesToSdkMessages([user1, assistant1, user2, assistant2, user3], model)

      // All conversation history should be preserved for context
      // No images to merge since previous assistant had no images
      expect(result).toEqual([
        {
          role: 'user',
          content: [{ type: 'text', text: 'Help me design a futuristic robot with blue lights' }]
        },
        {
          role: 'assistant',
          content: [
            {
              type: 'text',
              text: 'Great idea! The robot could have a sleek metallic body with glowing blue LED strips...'
            }
          ]
        },
        {
          role: 'user',
          content: [{ type: 'text', text: 'Yes, and add some chrome accents' }]
        },
        {
          role: 'assistant',
          content: [{ type: 'text', text: 'Perfect! Chrome accents would complement the blue lights beautifully...' }]
        },
        {
          role: 'user',
          content: [{ type: 'text', text: 'Now generate an image based on our discussion' }]
        }
      ])
    })
  })

  describe('stripMarkdownBase64Images', () => {
    it('replaces a single base64 image with placeholder', () => {
      const input = 'Here is the image:\n![cat](data:image/jpeg;base64,/9j/4AAQ)\nDone.'
      expect(stripMarkdownBase64Images(input)).toBe('Here is the image:\n![cat](image)\nDone.')
    })

    it('replaces multiple base64 images', () => {
      const input = '![a](data:image/png;base64,AAA) text ![b](data:image/jpeg;base64,BBB)'
      expect(stripMarkdownBase64Images(input)).toBe('![a](image) text ![b](image)')
    })

    it('preserves regular markdown images with http URLs', () => {
      const input = '![photo](https://example.com/photo.png)'
      expect(stripMarkdownBase64Images(input)).toBe(input)
    })

    it('preserves file:// URLs in markdown images', () => {
      const input = '![saved](file:///tmp/image.png)'
      expect(stripMarkdownBase64Images(input)).toBe(input)
    })

    it('handles empty alt text', () => {
      const input = '![](data:image/png;base64,AAABBB)'
      expect(stripMarkdownBase64Images(input)).toBe('![](image)')
    })

    it('handles text with no markdown images', () => {
      expect(stripMarkdownBase64Images('Just plain text.')).toBe('Just plain text.')
    })

    it('returns empty string for empty input', () => {
      expect(stripMarkdownBase64Images('')).toBe('')
    })

    it('handles mixed base64 and regular images', () => {
      const input =
        '![a](https://example.com/a.png) then ![b](data:image/png;base64,XXX) then ![c](https://example.com/c.png)'
      expect(stripMarkdownBase64Images(input)).toBe(
        '![a](https://example.com/a.png) then ![b](image) then ![c](https://example.com/c.png)'
      )
    })

    it('handles data URI without base64 encoding', () => {
      const input = '![svg](data:image/svg+xml,%3Csvg%3E%3C/svg%3E)'
      expect(stripMarkdownBase64Images(input)).toBe('![svg](image)')
    })

    it('does not treat bare ](data: without ![ as markdown image', () => {
      const input = 'some text ](data:image/png;base64,AAA) more text'
      expect(stripMarkdownBase64Images(input)).toBe(input)
    })

    it('handles large base64 payload without OOM', () => {
      const largeBase64 = 'A'.repeat(5_000_000)
      const input = `![big](data:image/png;base64,${largeBase64})`
      expect(stripMarkdownBase64Images(input)).toBe('![big](image)')
    })

    it('handles unclosed parenthesis gracefully', () => {
      const input = '![broken](data:image/png;base64,AAA'
      expect(stripMarkdownBase64Images(input)).toBe(input)
    })
  })
})
