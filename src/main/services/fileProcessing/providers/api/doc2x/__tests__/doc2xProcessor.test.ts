import fs from 'node:fs/promises'

import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getParseStatusMock, triggerExportTaskMock, getExportResultMock } = vi.hoisted(() => ({
  getParseStatusMock: vi.fn(),
  triggerExportTaskMock: vi.fn(),
  getExportResultMock: vi.fn()
}))

vi.mock('../utils', () => ({
  createUploadTask: vi.fn(),
  uploadFile: vi.fn(),
  getParseStatus: getParseStatusMock,
  triggerExportTask: triggerExportTaskMock,
  getExportResult: getExportResultMock
}))

import { fileProcessingTaskStore } from '../../../../runtime/FileProcessingTaskStore'
import { doc2xProcessor } from '../doc2xProcessor'

describe('doc2xProcessor', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fileProcessingTaskStore.clear()
    vi.spyOn(fs, 'access').mockRejectedValue(new Error('missing'))
  })

  it('moves parsing tasks into exporting state when parse succeeds and export starts', async () => {
    fileProcessingTaskStore.create('doc2x', 'task-1', {
      apiHost: 'https://doc2x.example.com',
      apiKey: 'secret',
      stage: 'parsing',
      createdAt: 1
    })

    getParseStatusMock.mockResolvedValueOnce({
      code: 'success',
      data: {
        status: 'success',
        progress: 100
      }
    })
    triggerExportTaskMock.mockResolvedValueOnce({
      code: 'success',
      data: {
        status: 'processing'
      }
    })

    await expect(doc2xProcessor.getMarkdownConversionTaskResult('task-1')).resolves.toEqual({
      status: 'processing',
      progress: 99,
      processorId: 'doc2x'
    })

    expect(fileProcessingTaskStore.get('doc2x', 'task-1')).toMatchObject({
      stage: 'exporting'
    })
  })

  it('persists export results and deletes task state when export completes', async () => {
    fileProcessingTaskStore.create('doc2x', 'task-2', {
      apiHost: 'https://doc2x.example.com',
      apiKey: 'secret',
      stage: 'exporting',
      createdAt: 1
    })

    getExportResultMock.mockResolvedValueOnce({
      code: 'success',
      data: {
        status: 'success',
        url: 'https://download.example.com/output.zip'
      }
    })

    const persistSpy = vi
      .spyOn(doc2xProcessor as any, 'persistMarkdownConversionResult')
      .mockResolvedValueOnce('/tmp/doc2x-output.md')

    await expect(doc2xProcessor.getMarkdownConversionTaskResult('task-2')).resolves.toEqual({
      status: 'completed',
      progress: 100,
      processorId: 'doc2x',
      markdownPath: '/tmp/doc2x-output.md'
    })

    expect(persistSpy).toHaveBeenCalledWith('task-2', 'https://download.example.com/output.zip', undefined)
    expect(fileProcessingTaskStore.get('doc2x', 'task-2')).toBeUndefined()
  })
})
