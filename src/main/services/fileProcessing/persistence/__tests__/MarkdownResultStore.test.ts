import { application } from '@application'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { fetchMock, persistMarkdownResultMock, persistResponseZipResultMock } = vi.hoisted(() => ({
  fetchMock: vi.fn(),
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

import { getFileProcessingResultsDir, markdownResultStore } from '../MarkdownResultStore'

describe('MarkdownResultStore', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(application.getPath).mockImplementation((key: string) => `/mock/${key}`)
  })

  it('derives file-processing result directories from the main-generated task id', () => {
    expect(getFileProcessingResultsDir('task-1')).toBe('/mock/feature.file_processing.results/task-1')
  })

  it('rejects unsafe task ids before deriving a result directory', () => {
    expect(() => getFileProcessingResultsDir('')).toThrow('Invalid file processing task id')
    expect(() => getFileProcessingResultsDir('../escape')).toThrow('Invalid file processing task id: ../escape')
    expect(() => getFileProcessingResultsDir('nested/task')).toThrow('Invalid file processing task id: nested/task')
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
