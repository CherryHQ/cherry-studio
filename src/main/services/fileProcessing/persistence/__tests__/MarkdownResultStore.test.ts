import fs from 'node:fs/promises'

import { application } from '@application'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { mockMainLoggerService } from '../../../../../../tests/__mocks__/MainLoggerService'
const { fetchMock, pathExistsMock, persistMarkdownResultMock, persistResponseZipResultMock } = vi.hoisted(() => ({
  fetchMock: vi.fn(),
  pathExistsMock: vi.fn(),
  persistMarkdownResultMock: vi.fn(),
  persistResponseZipResultMock: vi.fn()
}))

vi.mock('electron', () => ({
  net: {
    fetch: fetchMock
  }
}))

vi.mock('../resultPersistence', () => ({
  persistMarkdownResult: persistMarkdownResultMock,
  persistResponseZipResult: persistResponseZipResultMock
}))

vi.mock('@main/utils/file', () => ({
  pathExists: pathExistsMock
}))

import {
  cleanupFileProcessingResultsDir,
  getFileProcessingResultsDir,
  markdownResultStore
} from '../MarkdownResultStore'

describe('MarkdownResultStore', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(application.getPath).mockImplementation((key: string) => `/mock/${key}`)
    pathExistsMock.mockResolvedValue(false)
  })

  it('derives file-processing result directories from the main-generated task id', () => {
    expect(getFileProcessingResultsDir('task-1')).toBe('/mock/feature.file_processing.results/task-1')
  })

  it('rejects unsafe task ids before deriving a result directory', () => {
    expect(() => getFileProcessingResultsDir('')).toThrow('Invalid file processing task id')
    expect(() => getFileProcessingResultsDir('../escape')).toThrow('Invalid file processing task id: ../escape')
    expect(() => getFileProcessingResultsDir('nested/task')).toThrow('Invalid file processing task id: nested/task')
  })

  it('cleans result directories only when they exist', async () => {
    const rmSpy = vi.spyOn(fs, 'rm').mockResolvedValue(undefined)

    pathExistsMock.mockResolvedValueOnce(false)
    await expect(cleanupFileProcessingResultsDir('task-1')).resolves.toBe(false)
    expect(rmSpy).not.toHaveBeenCalled()

    pathExistsMock.mockResolvedValueOnce(true)
    await expect(cleanupFileProcessingResultsDir('task-1')).resolves.toBe(true)
    expect(rmSpy).toHaveBeenCalledWith('/mock/feature.file_processing.results/task-1', {
      recursive: true,
      force: true
    })
  })

  it('persists inline markdown content to output.md under the task directory', async () => {
    persistMarkdownResultMock.mockResolvedValueOnce('/mock/result/output.md')

    await expect(
      markdownResultStore.persistResult({
        taskId: 'task-1',
        result: {
          kind: 'markdown',
          markdownContent: '# hello'
        }
      })
    ).resolves.toBe('/mock/result/output.md')

    expect(persistMarkdownResultMock).toHaveBeenCalledWith({
      resultsDir: '/mock/feature.file_processing.results/task-1',
      markdownContent: '# hello'
    })
  })

  it('rejects remote zip downloads whose content-type is not application/zip', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response('{"error":"not a zip"}', {
        status: 200,
        statusText: 'OK',
        headers: {
          'content-type': 'application/json'
        }
      })
    )

    await expect(
      markdownResultStore.persistResult({
        taskId: 'task-1',
        result: {
          kind: 'remote-zip-url',
          downloadUrl:
            'https://doc2x-backend.s3.cn-north-1.amazonaws.com.cn/objects/task-1/convert_md_none.zip?Expires=1&Signature=abc',
          configuredApiHost: 'https://v2.doc2x.noedgeai.com'
        }
      })
    ).rejects.toThrow('Markdown result download returned unexpected content-type: application/json')

    expect(persistResponseZipResultMock).not.toHaveBeenCalled()
  })

  it('logs remote zip persistence failures with task context and redacted download urls', async () => {
    const warnSpy = vi.spyOn(mockMainLoggerService, 'warn').mockImplementation(() => {})

    fetchMock.mockResolvedValueOnce(
      new Response('{"error":"secret"}', {
        status: 500,
        statusText: 'Internal Server Error',
        headers: {
          'content-type': 'application/json'
        }
      })
    )

    await expect(
      markdownResultStore.persistResult({
        taskId: 'task-1',
        result: {
          kind: 'remote-zip-url',
          downloadUrl: 'https://cdn.example.com/results/task-1.zip?Signature=secret&Expires=1',
          configuredApiHost: 'https://api.example.com'
        }
      })
    ).rejects.toThrow('Markdown result download failed: 500 Internal Server Error {"error":"secret"}')

    expect(warnSpy).toHaveBeenCalledWith(
      'Markdown result persistence failed',
      expect.objectContaining({
        message: 'Markdown result download failed'
      }),
      {
        taskId: 'task-1',
        resultKind: 'remote-zip-url',
        resultsDir: '/mock/feature.file_processing.results/task-1',
        downloadUrl: 'https://cdn.example.com/results/task-1.zip',
        configuredApiHost: 'https://api.example.com'
      }
    )

    warnSpy.mockRestore()
  })

  it('allows public cross-origin provider download urls', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response('zip-binary', {
        status: 200,
        statusText: 'OK',
        headers: {
          'content-type': 'application/zip'
        }
      })
    )
    persistResponseZipResultMock.mockResolvedValueOnce('/mock/result.md')

    await expect(
      markdownResultStore.persistResult({
        taskId: 'task-1',
        result: {
          kind: 'remote-zip-url',
          downloadUrl: 'https://cdn-mineru.openxlab.org.cn/pdf/task-1.zip',
          configuredApiHost: 'https://mineru.net'
        }
      })
    ).resolves.toBe('/mock/result.md')

    expect(fetchMock).toHaveBeenCalledWith('https://cdn-mineru.openxlab.org.cn/pdf/task-1.zip', {
      method: 'GET',
      redirect: 'error',
      signal: undefined
    })
    expect(persistResponseZipResultMock).toHaveBeenCalledOnce()
  })

  it('allows remote zip downloads from a trusted local apiHost', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response('zip-binary', {
        status: 200,
        statusText: 'OK',
        headers: {
          'content-type': 'application/zip'
        }
      })
    )
    persistResponseZipResultMock.mockResolvedValueOnce('/mock/result.md')

    await expect(
      markdownResultStore.persistResult({
        taskId: 'task-1',
        result: {
          kind: 'remote-zip-url',
          downloadUrl: 'http://localhost:8000/result.zip',
          configuredApiHost: 'http://127.0.0.1:8000'
        }
      })
    ).resolves.toBe('/mock/result.md')

    expect(fetchMock).toHaveBeenCalledWith('http://localhost:8000/result.zip', {
      method: 'GET',
      redirect: 'error',
      signal: undefined
    })
    expect(persistResponseZipResultMock).toHaveBeenCalledOnce()
  })
})
