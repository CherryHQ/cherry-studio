import { application } from '@application'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { mockMainLoggerService } from '../../../../../../tests/__mocks__/MainLoggerService'

const { fetchMock, readMarkdownFromResponseZipMock, createInternalEntryMock } = vi.hoisted(() => ({
  fetchMock: vi.fn(),
  readMarkdownFromResponseZipMock: vi.fn(),
  createInternalEntryMock: vi.fn()
}))

vi.mock('electron', () => ({
  net: {
    fetch: fetchMock
  }
}))

vi.mock('../resultPersistence', () => ({
  readMarkdownFromResponseZip: readMarkdownFromResponseZipMock
}))

import { markdownResultStore } from '../MarkdownResultStore'

const PROCESSED_FILE_ENTRY_ID = '019606a0-0000-7000-8000-000000000501'

describe('MarkdownResultStore', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(vi.mocked(application.get) as unknown as ReturnType<typeof vi.fn>).mockImplementation((name: string) => {
      if (name === 'FileManager') {
        return {
          createInternalEntry: createInternalEntryMock
        }
      }
      throw new Error(`Unexpected application.get(${name})`)
    })
    vi.mocked(application.getPath).mockImplementation((key: string) => `/mock/${key}`)
    createInternalEntryMock.mockResolvedValue({ id: PROCESSED_FILE_ENTRY_ID })
    readMarkdownFromResponseZipMock.mockResolvedValue(new TextEncoder().encode('# zip'))
  })

  it('persists inline markdown content as an internal markdown file entry', async () => {
    await expect(
      markdownResultStore.persistResult({
        jobId: 'job-1',
        result: {
          kind: 'markdown',
          markdownContent: '# hello'
        }
      })
    ).resolves.toBe(PROCESSED_FILE_ENTRY_ID)

    expect(createInternalEntryMock).toHaveBeenCalledWith({
      source: 'bytes',
      data: new TextEncoder().encode('# hello'),
      name: 'file-processing-job-1',
      ext: 'md'
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
        jobId: 'job-1',
        result: {
          kind: 'remote-zip-url',
          downloadUrl:
            'https://doc2x-backend.s3.cn-north-1.amazonaws.com.cn/objects/task-1/convert_md_none.zip?Expires=1&Signature=abc',
          configuredApiHost: 'https://v2.doc2x.noedgeai.com'
        }
      })
    ).rejects.toThrow('Markdown result download returned unexpected content-type: application/json')

    expect(readMarkdownFromResponseZipMock).not.toHaveBeenCalled()
    expect(createInternalEntryMock).not.toHaveBeenCalled()
  })

  it('logs remote zip persistence failures with job context and redacted download urls', async () => {
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
        jobId: 'job-1',
        result: {
          kind: 'remote-zip-url',
          downloadUrl: 'https://cdn.example.com/results/task-1.zip?Signature=secret&Expires=1',
          configuredApiHost: 'https://api.example.com'
        }
      })
    ).rejects.toThrow('Markdown result download failed: 500 Internal Server Error')

    expect(warnSpy).toHaveBeenCalledWith(
      'Markdown result persistence failed',
      expect.objectContaining({
        message: 'Markdown result download failed'
      }),
      {
        jobId: 'job-1',
        resultKind: 'remote-zip-url',
        downloadUrl: 'https://cdn.example.com/results/task-1.zip',
        configuredApiHost: 'https://api.example.com'
      }
    )

    warnSpy.mockRestore()
  })

  it('does not include remote zip download failure body details', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response('secret body', {
        status: 500,
        statusText: 'Internal Server Error',
        headers: {
          'content-type': 'application/json'
        }
      })
    )

    await expect(
      markdownResultStore.persistResult({
        jobId: 'job-1',
        result: {
          kind: 'remote-zip-url',
          downloadUrl: 'https://cdn.example.com/results/task-1.zip',
          configuredApiHost: 'https://api.example.com'
        }
      })
    ).rejects.toThrow('Markdown result download failed: 500 Internal Server Error')
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

    await expect(
      markdownResultStore.persistResult({
        jobId: 'job-1',
        result: {
          kind: 'remote-zip-url',
          downloadUrl: 'https://cdn-mineru.openxlab.org.cn/pdf/task-1.zip',
          configuredApiHost: 'https://mineru.net'
        }
      })
    ).resolves.toBe(PROCESSED_FILE_ENTRY_ID)

    expect(fetchMock).toHaveBeenCalledWith('https://cdn-mineru.openxlab.org.cn/pdf/task-1.zip', {
      method: 'GET',
      redirect: 'error',
      signal: undefined
    })
    expect(readMarkdownFromResponseZipMock).toHaveBeenCalledWith({
      response: expect.any(Response),
      tempDir: '/mock/feature.file_processing.temp',
      signal: undefined
    })
    expect(createInternalEntryMock).toHaveBeenCalledOnce()
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

    await expect(
      markdownResultStore.persistResult({
        jobId: 'job-1',
        result: {
          kind: 'remote-zip-url',
          downloadUrl: 'http://localhost:8000/result.zip',
          configuredApiHost: 'http://127.0.0.1:8000'
        }
      })
    ).resolves.toBe(PROCESSED_FILE_ENTRY_ID)

    expect(fetchMock).toHaveBeenCalledWith('http://localhost:8000/result.zip', {
      method: 'GET',
      redirect: 'error',
      signal: undefined
    })
    expect(readMarkdownFromResponseZipMock).toHaveBeenCalledOnce()
  })
})
