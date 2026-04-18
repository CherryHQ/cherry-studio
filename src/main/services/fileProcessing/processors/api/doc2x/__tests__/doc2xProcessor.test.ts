import fs from 'node:fs/promises'

import { application } from '@application'
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

vi.mock('../../../../persistence/resultPersistence', () => ({
  persistResponseZipResult: persistResponseZipResultMock
}))

import { doc2xProcessor } from '../doc2xProcessor'

describe('doc2xProcessor', () => {
  const runtimeService = application.get('FileProcessingRuntimeService')
  const doc2xRuntimeService = application.get('Doc2xRuntimeService') as {
    __reset?: () => void
  }

  beforeEach(() => {
    vi.clearAllMocks()
    runtimeService.clearTasks()
    doc2xRuntimeService.__reset?.()
    vi.spyOn(fs, 'access').mockRejectedValue(new Error('missing'))
  })

  it('moves parsing tasks into exporting state when parse succeeds and export starts', async () => {
    runtimeService.createTask('doc2x', 'task-1', {
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
    const controller = new AbortController()

    await expect(doc2xProcessor.getMarkdownConversionTaskResult('task-1', controller.signal)).resolves.toEqual({
      status: 'processing',
      progress: 99,
      processorId: 'doc2x'
    })

    expect(getParseStatusMock).toHaveBeenCalledWith(
      'task-1',
      expect.objectContaining({
        apiHost: 'https://doc2x.example.com',
        apiKey: 'secret',
        signal: expect.any(AbortSignal)
      })
    )
    expect(triggerExportTaskMock).toHaveBeenCalledWith(
      'task-1',
      expect.objectContaining({
        apiHost: 'https://doc2x.example.com',
        apiKey: 'secret',
        signal: expect.any(AbortSignal)
      })
    )
    expect(runtimeService.getTask('doc2x', 'task-1')).toMatchObject({
      stage: 'exporting'
    })
  })

  it('persists export results and deletes task state when export completes', async () => {
    runtimeService.createTask('doc2x', 'task-2', {
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
    const controller = new AbortController()

    const persistSpy = vi
      .spyOn(doc2xProcessor as any, 'persistMarkdownConversionResult')
      .mockResolvedValueOnce('/tmp/doc2x-output.md')

    await expect(doc2xProcessor.getMarkdownConversionTaskResult('task-2', controller.signal)).resolves.toEqual({
      status: 'completed',
      progress: 100,
      processorId: 'doc2x',
      markdownPath: '/tmp/doc2x-output.md'
    })

    expect(getExportResultMock).toHaveBeenCalledWith(
      'task-2',
      expect.objectContaining({
        apiHost: 'https://doc2x.example.com',
        apiKey: 'secret',
        signal: expect.any(AbortSignal)
      })
    )
    expect(persistSpy).toHaveBeenCalledWith(
      'file-2',
      'https://download.example.com/output.zip',
      expect.any(AbortSignal)
    )
    expect(runtimeService.getTask('doc2x', 'task-2')).toBeUndefined()
  })

  it('keeps task state when export persistence fails so polling can retry', async () => {
    runtimeService.createTask('doc2x', 'task-late-failure', {
      apiHost: 'https://doc2x.example.com',
      apiKey: 'secret',
      fileId: 'file-late-failure',
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

    vi.spyOn(doc2xProcessor as any, 'persistMarkdownConversionResult').mockRejectedValueOnce(
      new Error('persist failed')
    )

    await expect(doc2xProcessor.getMarkdownConversionTaskResult('task-late-failure')).rejects.toThrow('persist failed')

    expect(runtimeService.getTask('doc2x', 'task-late-failure')).toMatchObject({
      stage: 'exporting'
    })
  })

  it('allows retrying after a transient export query failure', async () => {
    runtimeService.createTask('doc2x', 'task-retry', {
      apiHost: 'https://doc2x.example.com',
      apiKey: 'secret',
      fileId: 'file-retry',
      stage: 'exporting',
      createdAt: 1
    })

    getExportResultMock.mockRejectedValueOnce(new Error('temporary network error')).mockResolvedValueOnce({
      code: 'success',
      data: {
        status: 'success',
        url: 'https://download.example.com/output.zip'
      }
    })

    vi.spyOn(doc2xProcessor as any, 'persistMarkdownConversionResult').mockResolvedValueOnce('/tmp/doc2x-retry.md')

    await expect(doc2xProcessor.getMarkdownConversionTaskResult('task-retry')).rejects.toThrow(
      'temporary network error'
    )

    expect(runtimeService.getTask('doc2x', 'task-retry')).toMatchObject({
      stage: 'exporting'
    })

    await expect(doc2xProcessor.getMarkdownConversionTaskResult('task-retry')).resolves.toEqual({
      status: 'completed',
      progress: 100,
      processorId: 'doc2x',
      markdownPath: '/tmp/doc2x-retry.md'
    })

    expect(runtimeService.getTask('doc2x', 'task-retry')).toBeUndefined()
  })

  it('deduplicates concurrent polling for the same task while starting export', async () => {
    runtimeService.createTask('doc2x', 'task-3', {
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
    expect(runtimeService.getTask('doc2x', 'task-3')).toMatchObject({
      stage: 'exporting'
    })
  })

  it('does not let the first caller abort cancel a concurrent follower', async () => {
    runtimeService.createTask('doc2x', 'task-4', {
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
    expect(runtimeService.getTask('doc2x', 'task-4')).toMatchObject({
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
