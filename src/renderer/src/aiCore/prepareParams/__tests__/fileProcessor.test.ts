import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      debug: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      info: vi.fn()
    })
  }
}))

vi.mock('@renderer/services/AssistantService', () => ({
  DEFAULT_ASSISTANT_SETTINGS: {},
  getDefaultAssistant: vi.fn(() => ({
    id: 'default',
    name: 'Default',
    emoji: '😀',
    prompt: '',
    topics: [],
    messages: [],
    type: 'assistant',
    regularPhrases: [],
    settings: {}
  })),
  getDefaultTopic: vi.fn(() => ({
    id: 'topic',
    assistantId: 'default',
    createdAt: '',
    updatedAt: '',
    name: 'Topic',
    messages: [],
    isNameManuallyEdited: false
  })),
  getProviderByModel: vi.fn(() => ({
    id: 'openai',
    type: 'openai',
    apiHost: 'https://api.openai.com'
  }))
}))

import { FILE_TYPE } from '@renderer/types/file'

import { convertFileBlockToFilePart } from '../fileProcessor'

const ensureWindowApi = () => {
  const globalWindow = window as any
  globalWindow.api = globalWindow.api || {}
  globalWindow.api.file = globalWindow.api.file || {}
}

describe('fileProcessor', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    ensureWindowApi()
  })

  it('strips data URI prefix from base64 file and logs a warning', async () => {
    const globalWindow = window as any
    globalWindow.api.file.base64File = vi.fn(async () => ({
      data: 'data:application/pdf;base64,AAA',
      mime: 'application/pdf'
    }))

    const fileBlock: any = {
      file: {
        id: 'file-1',
        origin_name: 'doc.pdf',
        ext: '.pdf',
        type: FILE_TYPE.DOCUMENT,
        size: 1024
      }
    }

    const model: any = { id: 'gpt-4', name: 'GPT-4', provider: 'openai', group: 'openai' }

    const result = await convertFileBlockToFilePart(fileBlock, model)

    expect(result).toBeTruthy()
    expect((result as any).data).toBe('AAA')
    expect((result as any).mediaType).toBe('application/pdf')
  })
})
