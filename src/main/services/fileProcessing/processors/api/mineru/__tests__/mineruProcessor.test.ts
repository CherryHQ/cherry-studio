import fs from 'node:fs/promises'

import { application } from '@main/core/application'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getBatchResultMock, mapProgressMock, fetchMock, persistResponseZipResultMock } = vi.hoisted(() => ({
  getBatchResultMock: vi.fn(),
  mapProgressMock: vi.fn(),
  fetchMock: vi.fn(),
  persistResponseZipResultMock: vi.fn()
}))

vi.mock('../utils', () => ({
  createUploadTask: vi.fn(),
  uploadFile: vi.fn(),
  getBatchResult: getBatchResultMock,
  mapProgress: mapProgressMock
}))

vi.mock('electron', () => ({
  net: {
    fetch: fetchMock
  }
}))

vi.mock('../../../../persistence/resultPersistence', () => ({
  persistResponseZipResult: persistResponseZipResultMock
}))

import { mineruProcessor } from '../mineruProcessor'

describe('mineruProcessor', () => {
  const runtimeService = application.get('FileProcessingRuntimeService')

  beforeEach(() => {
    vi.clearAllMocks()
    runtimeService.clearTasks()
    vi.spyOn(fs, 'access').mockRejectedValue(new Error('missing'))
  })

  it('maps non-final batch results to a processing response', async () => {
    runtimeService.createTask('mineru', 'task-1', {
      apiHost: 'https://mineru.example.com',
      apiKey: 'secret',
      fileId: 'file-1'
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

    expect(runtimeService.getTask('mineru', 'task-1')).toMatchObject({
      apiHost: 'https://mineru.example.com'
    })
  })

  it('persists completed results and deletes task state', async () => {
    runtimeService.createTask('mineru', 'task-2', {
      apiHost: 'https://mineru.example.com',
      apiKey: 'secret',
      fileId: 'file-2'
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

    expect(persistSpy).toHaveBeenCalledWith('file-2', 'https://download.example.com/full.zip', undefined)
    expect(runtimeService.getTask('mineru', 'task-2')).toBeUndefined()
  })

  it('keeps task state when persistence-related completion handling fails', async () => {
    runtimeService.createTask('mineru', 'task-late-failure', {
      apiHost: 'https://mineru.example.com',
      apiKey: 'secret',
      fileId: 'file-late-failure'
    })

    getBatchResultMock.mockResolvedValueOnce({
      extract_result: [
        {
          state: 'done',
          full_zip_url: 'https://download.example.com/full.zip'
        }
      ]
    })

    vi.spyOn(mineruProcessor as any, 'persistMarkdownConversionResult').mockRejectedValueOnce(
      new Error('persist failed')
    )

    await expect(mineruProcessor.getMarkdownConversionTaskResult('task-late-failure')).rejects.toThrow('persist failed')

    expect(runtimeService.getTask('mineru', 'task-late-failure')).toMatchObject({
      fileId: 'file-late-failure'
    })
  })

  it('allows retrying after a transient polling failure', async () => {
    runtimeService.createTask('mineru', 'task-retry', {
      apiHost: 'https://mineru.example.com',
      apiKey: 'secret',
      fileId: 'file-retry'
    })

    getBatchResultMock.mockRejectedValueOnce(new Error('temporary network error')).mockResolvedValueOnce({
      extract_result: [
        {
          state: 'done',
          full_zip_url: 'https://download.example.com/full.zip'
        }
      ]
    })

    vi.spyOn(mineruProcessor as any, 'persistMarkdownConversionResult').mockResolvedValueOnce('/tmp/mineru-retry.md')

    await expect(mineruProcessor.getMarkdownConversionTaskResult('task-retry')).rejects.toThrow(
      'temporary network error'
    )

    expect(runtimeService.getTask('mineru', 'task-retry')).toMatchObject({
      fileId: 'file-retry'
    })

    await expect(mineruProcessor.getMarkdownConversionTaskResult('task-retry')).resolves.toEqual({
      status: 'completed',
      progress: 100,
      processorId: 'mineru',
      markdownPath: '/tmp/mineru-retry.md'
    })

    expect(runtimeService.getTask('mineru', 'task-retry')).toBeUndefined()
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
      (mineruProcessor as any).persistMarkdownConversionResult('file-3', 'https://download.example.com/full.zip')
    ).rejects.toThrow('persist failed')

    expect(rmSpy).not.toHaveBeenCalled()
  })
})
