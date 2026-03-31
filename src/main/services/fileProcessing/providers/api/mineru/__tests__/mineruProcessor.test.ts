import fs from 'node:fs/promises'

import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getBatchResultMock, mapProgressMock } = vi.hoisted(() => ({
  getBatchResultMock: vi.fn(),
  mapProgressMock: vi.fn()
}))

vi.mock('../utils', () => ({
  createUploadTask: vi.fn(),
  uploadFile: vi.fn(),
  getBatchResult: getBatchResultMock,
  mapProgress: mapProgressMock
}))

import { fileProcessingTaskStore } from '../../../../runtime/FileProcessingTaskStore'
import { mineruProcessor } from '../mineruProcessor'

describe('mineruProcessor', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fileProcessingTaskStore.clear()
    vi.spyOn(fs, 'access').mockRejectedValue(new Error('missing'))
  })

  it('maps non-final batch results to a processing response', async () => {
    fileProcessingTaskStore.create('mineru', 'task-1', {
      apiHost: 'https://mineru.example.com',
      apiKey: 'secret'
    })

    getBatchResultMock.mockResolvedValueOnce({
      extract_result: [
        {
          state: 'running'
        }
      ]
    })
    mapProgressMock.mockReturnValueOnce(42)

    await expect(mineruProcessor.getMarkdownConversionTaskResult('task-1')).resolves.toEqual({
      status: 'processing',
      progress: 42,
      processorId: 'mineru'
    })

    expect(fileProcessingTaskStore.get('mineru', 'task-1')).toMatchObject({
      apiHost: 'https://mineru.example.com'
    })
  })

  it('persists completed results and deletes task state', async () => {
    fileProcessingTaskStore.create('mineru', 'task-2', {
      apiHost: 'https://mineru.example.com',
      apiKey: 'secret'
    })

    getBatchResultMock.mockResolvedValueOnce({
      extract_result: [
        {
          state: 'done',
          full_zip_url: 'https://download.example.com/full.zip'
        }
      ]
    })

    const persistSpy = vi
      .spyOn(mineruProcessor as any, 'persistMarkdownConversionResult')
      .mockResolvedValueOnce('/tmp/mineru-output.md')

    await expect(mineruProcessor.getMarkdownConversionTaskResult('task-2')).resolves.toEqual({
      status: 'completed',
      progress: 100,
      processorId: 'mineru',
      markdownPath: '/tmp/mineru-output.md'
    })

    expect(persistSpy).toHaveBeenCalledWith('task-2', 'https://download.example.com/full.zip', undefined)
    expect(fileProcessingTaskStore.get('mineru', 'task-2')).toBeUndefined()
  })
})
