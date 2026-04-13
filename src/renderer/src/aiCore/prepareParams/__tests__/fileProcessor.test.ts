import { type FileMessageBlock, MessageBlockStatus, MessageBlockType } from '@renderer/types/newMessage'
import { beforeEach, describe, expect, it, vi } from 'vitest'

interface FileMetadata {
  id: string
  name: string
  origin_name: string
  path: string
  size: number
  ext: string
  type: (typeof FILE_TYPE)[keyof typeof FILE_TYPE]
  created_at: string
  count: number
}

const FILE_TYPE = {
  TEXT: 'text',
  DOCUMENT: 'document'
} as const

const mockRead = vi.fn()
const mockReadForChat = vi.fn()

vi.mock('i18next', () => ({
  default: { t: (key: string, opts?: Record<string, unknown>) => `${key}${opts ? JSON.stringify(opts) : ''}` }
}))

vi.mock('@renderer/i18n', () => ({
  default: {
    t: (key: string, opts?: Record<string, unknown>) => `${key}${opts ? JSON.stringify(opts) : ''}`
  },
  getLanguageCode: vi.fn(() => 'en-US'),
  setDayjsLocale: vi.fn()
}))

vi.mock('@renderer/services/AssistantService', () => ({
  getProviderByModel: vi.fn()
}))

vi.mock('@renderer/types', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@renderer/types')>()
  return {
    ...actual,
    FILE_TYPE: {
      ...actual.FILE_TYPE,
      TEXT: 'text',
      DOCUMENT: 'document'
    }
  }
})

vi.mock('../modelCapabilities', () => ({
  getFileSizeLimit: vi.fn(() => Number.MAX_SAFE_INTEGER),
  supportsImageInput: vi.fn(() => true),
  supportsLargeFileUpload: vi.fn(() => false)
}))

vi.mock('../provider/factory', () => ({
  getAiSdkProviderId: vi.fn(() => 'openai')
}))

vi.mock('@renderer/store', () => ({
  default: {
    getState: () => ({
      preprocess: {
        defaultProvider: 'paddleocr',
        providers: [
          {
            id: 'paddleocr',
            name: 'PaddleOCR',
            apiHost: 'https://paddleocr.example.com',
            apiKey: 'test-token'
          }
        ]
      }
    })
  }
}))

vi.stubGlobal('window', {
  ...globalThis.window,
  api: {
    file: {
      read: mockRead,
      readForChat: mockReadForChat
    }
  },
  toast: {
    warning: vi.fn(),
    error: vi.fn()
  }
})

import { convertFileBlockToTextPart } from '../fileProcessor'

const createPdfFile = (): FileMetadata => ({
  id: 'file-1',
  name: 'file-1.pdf',
  origin_name: 'scan.pdf',
  path: '/tmp/scan.pdf',
  size: 1024,
  ext: '.pdf',
  type: FILE_TYPE.DOCUMENT,
  created_at: '2024-01-01T00:00:00.000Z',
  count: 1
})

const createFileBlock = (file: FileMetadata): FileMessageBlock => ({
  id: 'block-1',
  messageId: 'message-1',
  type: MessageBlockType.FILE,
  createdAt: '2024-01-01T00:00:00.000Z',
  status: MessageBlockStatus.SUCCESS,
  file
})

describe('fileProcessor', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('uses the default preprocess provider for PDF documents in chat fallback', async () => {
    const file = createPdfFile()
    const fileBlock = createFileBlock(file)
    mockReadForChat.mockResolvedValue('OCR extracted text')

    const result = await convertFileBlockToTextPart(fileBlock)

    expect(mockReadForChat).toHaveBeenCalledWith(file, {
      id: 'paddleocr',
      name: 'PaddleOCR',
      apiHost: 'https://paddleocr.example.com',
      apiKey: 'test-token'
    })
    expect(mockRead).not.toHaveBeenCalled()
    expect(result).toEqual({
      type: 'text',
      text: 'scan.pdf\nOCR extracted text'
    })
  })
})
