import fs from 'node:fs/promises'

import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getParseStatusMock, triggerExportTaskMock, getExportResultMock, fetchMock, persistResponseZipResultMock } =
  vi.hoisted(() => ({
    getParseStatusMock: vi.fn(),
    triggerExportTaskMock: vi.fn(),
    getExportResultMock: vi.fn(),
    fetchMock: vi.fn(),
    persistResponseZipResultMock: vi.fn()
  }))

vi.mock('../utils', () => ({
  createUploadTask: vi.fn(),
  uploadFile: vi.fn(),
  getParseStatus: getParseStatusMock,
  triggerExportTask: triggerExportTaskMock,
  getExportResult: getExportResultMock
}))

vi.mock('electron', () => ({
  net: {
    fetch: fetchMock
  }
}))

vi.mock('@main/utils/file', () => ({
  getFilesDir: vi.fn(() => '/tmp/files')
}))

vi.mock('../../../../utils/resultPersistence', () => ({
  persistResponseZipResult: persistResponseZipResultMock
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
      fileId: 'file-1',
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
      fileId: 'file-2',
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

    expect(persistSpy).toHaveBeenCalledWith('file-2', 'https://download.example.com/output.zip', undefined)
    expect(fileProcessingTaskStore.get('doc2x', 'task-2')).toBeUndefined()
  })

  it('deduplicates concurrent polling for the same task while starting export', async () => {
    fileProcessingTaskStore.create('doc2x', 'task-3', {
      apiHost: 'https://doc2x.example.com',
      apiKey: 'secret',
      fileId: 'file-3',
      stage: 'parsing',
      createdAt: 1
    })

    getParseStatusMock.mockResolvedValue({
      code: 'success',
      data: {
        status: 'success',
        progress: 100
      }
    })

    let resolveExportTask: ((value: { code: string; data: { status: string } }) => void) | undefined
    triggerExportTaskMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveExportTask = resolve
        })
    )

    const firstPollPromise = doc2xProcessor.getMarkdownConversionTaskResult('task-3')
    const secondPollPromise = doc2xProcessor.getMarkdownConversionTaskResult('task-3')

    await Promise.resolve()
    await Promise.resolve()

    expect(triggerExportTaskMock).toHaveBeenCalledTimes(1)

    resolveExportTask?.({
      code: 'success',
      data: {
        status: 'processing'
      }
    })

    await expect(firstPollPromise).resolves.toEqual({
      status: 'processing',
      progress: 99,
      processorId: 'doc2x'
    })
    await expect(secondPollPromise).resolves.toEqual({
      status: 'processing',
      progress: 99,
      processorId: 'doc2x'
    })

    expect(getParseStatusMock).toHaveBeenCalledTimes(1)
    expect(fileProcessingTaskStore.get('doc2x', 'task-3')).toMatchObject({
      stage: 'exporting'
    })
  })

  it('does not let the first caller abort cancel a concurrent follower', async () => {
    fileProcessingTaskStore.create('doc2x', 'task-4', {
      apiHost: 'https://doc2x.example.com',
      apiKey: 'secret',
      fileId: 'file-4',
      stage: 'parsing',
      createdAt: 1
    })

    getParseStatusMock.mockResolvedValue({
      code: 'success',
      data: {
        status: 'success',
        progress: 100
      }
    })

    let resolveExportTask: ((value: { code: string; data: { status: string } }) => void) | undefined
    triggerExportTaskMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveExportTask = resolve
        })
    )

    const firstController = new AbortController()
    const secondController = new AbortController()

    const firstPollPromise = doc2xProcessor.getMarkdownConversionTaskResult('task-4', firstController.signal)
    const secondPollPromise = doc2xProcessor.getMarkdownConversionTaskResult('task-4', secondController.signal)

    await Promise.resolve()
    await Promise.resolve()

    firstController.abort()

    await expect(firstPollPromise).rejects.toMatchObject({
      name: 'AbortError'
    })

    resolveExportTask?.({
      code: 'success',
      data: {
        status: 'processing'
      }
    })

    await expect(secondPollPromise).resolves.toEqual({
      status: 'processing',
      progress: 99,
      processorId: 'doc2x'
    })

    expect(getParseStatusMock).toHaveBeenCalledTimes(1)
    expect(triggerExportTaskMock).toHaveBeenCalledTimes(1)
    expect(fileProcessingTaskStore.get('doc2x', 'task-4')).toMatchObject({
      stage: 'exporting'
    })
  })

  it('keeps the existing result directory when persistence fails', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        statusText: 'OK'
      })
    )
    persistResponseZipResultMock.mockRejectedValueOnce(new Error('persist failed'))
    const rmSpy = vi.spyOn(fs, 'rm').mockResolvedValue(undefined)

    await expect(
      (doc2xProcessor as any).persistMarkdownConversionResult('file-5', 'https://download.example.com/output.zip')
    ).rejects.toThrow('persist failed')

    expect(rmSpy).not.toHaveBeenCalled()
  })
})
