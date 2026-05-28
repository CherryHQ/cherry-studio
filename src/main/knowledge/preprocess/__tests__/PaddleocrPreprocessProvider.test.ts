import { fileStorage } from '@main/services/FileStorage'
import type { FileMetadata, PreprocessProvider } from '@types'
import { net } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@main/services/WindowService', () => ({
  windowService: {
    getMainWindow: vi.fn(() => undefined)
  }
}))

import PaddleocrPreprocessProvider from '../PaddleocrPreprocessProvider'

const providerConfig: PreprocessProvider = {
  id: 'paddleocr',
  name: 'PaddleOCR',
  apiHost: 'https://paddleocr.example.com',
  apiKey: 'test-token'
}

const file: FileMetadata = {
  id: 'file-1',
  name: 'file-1.pdf',
  origin_name: 'scan.pdf',
  path: '/tmp/scan.pdf',
  size: 1024,
  ext: '.pdf',
  type: 'document',
  created_at: '2024-01-01T00:00:00.000Z',
  count: 1
}

describe('PaddleocrPreprocessProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(fileStorage, 'getFilePathById').mockReturnValue('/mock/files/file-1.pdf')
  })

  it('preserves HTTP response body when the PaddleOCR API returns an error', async () => {
    const provider = new PaddleocrPreprocessProvider(providerConfig)

    vi.spyOn(provider as any, 'validateFile').mockResolvedValue(Buffer.from('pdf'))
    vi.spyOn(provider as any, 'sendPreprocessProgress').mockResolvedValue(undefined)
    vi.mocked(net.fetch).mockResolvedValue({
      ok: false,
      status: 400,
      statusText: 'Bad Request',
      text: vi.fn().mockResolvedValue('quota exceeded')
    } as any)

    await expect(provider.parseFile('source-1', file)).rejects.toThrow(/quota exceeded/)
  })
})
