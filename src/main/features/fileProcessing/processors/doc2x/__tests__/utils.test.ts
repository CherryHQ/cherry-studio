import type * as NodeFs from 'node:fs'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import type * as Doc2xUtils from '../utils'

const { createReadStreamMock, destroyMock, fetchMock } = vi.hoisted(() => ({
  createReadStreamMock: vi.fn(() => ({
    destroy: vi.fn()
  })),
  destroyMock: vi.fn(),
  fetchMock: vi.fn()
}))

vi.mock('electron', () => ({
  net: {
    fetch: fetchMock
  }
}))

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof NodeFs>('node:fs')

  return {
    ...actual,
    createReadStream: createReadStreamMock
  }
})

import { buildDoc2xMarkdown, handleExportStage, handleParseStage } from '../documentToMarkdown/handler'
import type { PreparedDoc2xStartContext } from '../types'
import { createUploadTask, uploadFile } from '../utils'

const { getExportResultMock, getParseStatusMock, triggerExportTaskMock } = vi.hoisted(() => ({
  getExportResultMock: vi.fn(),
  getParseStatusMock: vi.fn(),
  triggerExportTaskMock: vi.fn()
}))

vi.mock('../utils', async () => {
  const actual = await vi.importActual<typeof Doc2xUtils>('../utils')

  return {
    ...actual,
    getExportResult: getExportResultMock,
    getParseStatus: getParseStatusMock,
    triggerExportTask: triggerExportTaskMock
  }
})

describe('doc2x utils', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.clearAllMocks()
    createReadStreamMock.mockReturnValue({
      destroy: destroyMock
    })
  })

  it('uploads files to public object-storage urls returned by the provider', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(null, {
        status: 200,
        statusText: 'OK'
      })
    )

    await expect(
      uploadFile(
        '/tmp/file.pdf',
        'https://doc2x-pdf.oss-cn-beijing.aliyuncs.com/tmp/task-1.pdf?X-Amz-Signature=abc',
        'https://v2.doc2x.noedgeai.com'
      )
    ).resolves.toBeUndefined()

    expect(createReadStreamMock).toHaveBeenCalledWith('/tmp/file.pdf')
    expect(fetchMock).toHaveBeenCalledWith(
      'https://doc2x-pdf.oss-cn-beijing.aliyuncs.com/tmp/task-1.pdf?X-Amz-Signature=abc',
      expect.objectContaining({
        method: 'PUT',
        body: expect.any(Object),
        duplex: 'half',
        redirect: 'error',
        signal: undefined
      })
    )
    expect(destroyMock).toHaveBeenCalled()
  })

  it('rejects unsafe upload urls before dispatching the request', async () => {
    await expect(
      uploadFile('/tmp/file.pdf', 'http://127.0.0.1:9000/upload', 'https://v2.doc2x.noedgeai.com')
    ).rejects.toThrow('Unsafe remote url: local or private addresses are not allowed (127.0.0.1)')

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('sends the selected model to preupload and omits it for the default model', async () => {
    fetchMock.mockImplementation(
      async () =>
        new Response(
          JSON.stringify({ code: 'success', data: { uid: 'uid-1', url: 'https://upload.example.com/file' } }),
          {
            status: 200
          }
        )
    )

    const context = {
      apiHost: 'https://doc2x.example.com',
      apiKey: 'secret',
      file: { path: '/tmp/file.pdf' }
    } as unknown as PreparedDoc2xStartContext

    await createUploadTask({ ...context, modelVersion: 'v3-2026' })
    expect(JSON.parse(fetchMock.mock.calls.at(-1)?.[1]?.body as string)).toEqual({ model: 'v3-2026' })

    await createUploadTask(context)
    expect(JSON.parse(fetchMock.mock.calls.at(-1)?.[1]?.body as string)).toEqual({})
  })

  it('preserves page markdown, removes boilerplate comments, and replaces markdown tables with HTML', () => {
    expect(
      buildDoc2xMarkdown([
        {
          page_idx: 1,
          md: '<!-- Meanless: header<br>1 -->\n\nbody\n\n| Name | Value |\n| --- | --- |\n| item | 42 |',
          layout: {
            blocks: [
              {
                id: 'boilerplate',
                type: 'Text',
                text: 'header',
                bbox: [0, 0, 1, 1],
                reading_order: 0,
                parent_id: '',
                src: '',
                attributes: { is_boilerplate: true }
              },
              {
                id: 'table',
                type: 'Table',
                text: '',
                bbox: [0, 0, 1, 1],
                reading_order: 2,
                parent_id: '',
                src: '',
                table_data: { html: '<table><tr><td>value</td></tr></table>' }
              },
              {
                id: 'body',
                type: 'Text',
                text: 'body',
                bbox: [0, 0, 1, 1],
                reading_order: 1,
                parent_id: '',
                src: ''
              }
            ]
          }
        }
      ])
    ).toBe('body\n\n<table><tr><td>value</td></tr></table>')
  })

  it('uses structured figure URLs when a v3 page has no Markdown fallback', () => {
    expect(
      buildDoc2xMarkdown([
        {
          page_idx: 0,
          layout: {
            blocks: [
              {
                id: 'figure',
                type: 'Figure',
                text: '',
                bbox: [0, 0, 1, 1],
                reading_order: 1,
                parent_id: '',
                src: 'https://img.example.com/figure.png'
              },
              {
                id: 'text',
                type: 'Text',
                text: 'caption',
                bbox: [0, 0, 1, 1],
                reading_order: 2,
                parent_id: '',
                src: ''
              }
            ]
          }
        }
      ])
    ).toBe('![](https://img.example.com/figure.png)\n\ncaption')
  })

  it('reconstructs empty pages in provider reading order', () => {
    expect(
      buildDoc2xMarkdown([
        {
          page_idx: 0,
          layout: {
            blocks: [
              {
                id: 'second',
                type: 'Text',
                text: 'second',
                bbox: [0, 0, 1, 1],
                reading_order: 2,
                parent_id: '',
                src: ''
              },
              {
                id: 'first',
                type: 'Text',
                text: 'first',
                bbox: [0, 0, 1, 1],
                reading_order: 1,
                parent_id: '',
                src: ''
              }
            ]
          }
        }
      ])
    ).toBe('first\n\nsecond')
  })

  it('sends v3 export options and omits v3-only fields for v2', async () => {
    const { triggerExportTask: triggerExportTaskImpl } = await vi.importActual<typeof Doc2xUtils>('../utils')
    fetchMock.mockImplementation(
      async () =>
        new Response(JSON.stringify({ code: 'success', data: { status: 'processing', url: '' } }), {
          status: 200
        })
    )

    const context = {
      apiHost: 'https://doc2x.example.com',
      apiKey: 'secret'
    }

    await triggerExportTaskImpl('uid-v2', context, { modelVersion: 'v2' })
    expect(JSON.parse(fetchMock.mock.calls.at(-1)?.[1]?.body as string)).toEqual({
      uid: 'uid-v2',
      to: 'md',
      formula_mode: 'normal'
    })

    await triggerExportTaskImpl('uid-v3', context, {
      modelVersion: 'v3-2026',
      formulaLevel: 1,
      mergeCrossPageForms: true
    })
    expect(JSON.parse(fetchMock.mock.calls.at(-1)?.[1]?.body as string)).toEqual({
      uid: 'uid-v3',
      to: 'md',
      formula_mode: 'normal',
      formula_level: 1,
      merge_cross_page_forms: true
    })
  })

  it('keeps v2 responses on the ZIP fallback even if layout blocks are present', async () => {
    getParseStatusMock.mockResolvedValueOnce({
      code: 'success',
      data: {
        status: 'success',
        result: {
          pages: [
            {
              page_idx: 0,
              md: 'legacy markdown',
              layout: {
                blocks: [
                  {
                    id: 'text',
                    type: 'Text',
                    text: 'structured text',
                    bbox: [0, 0, 1, 1],
                    reading_order: 0,
                    parent_id: '',
                    src: ''
                  }
                ]
              }
            }
          ]
        }
      }
    })
    triggerExportTaskMock.mockResolvedValueOnce({
      code: 'success',
      data: { status: 'processing' }
    })

    await expect(
      handleParseStage(
        'uid-v2',
        {
          apiHost: 'https://doc2x.example.com',
          apiKey: 'secret',
          stage: 'parsing',
          modelVersion: 'v2'
        },
        {
          apiHost: 'https://doc2x.example.com',
          apiKey: 'secret'
        }
      )
    ).resolves.toEqual({
      status: 'processing',
      progress: 99,
      remoteContext: {
        apiHost: 'https://doc2x.example.com',
        apiKey: 'secret',
        stage: 'exporting',
        modelVersion: 'v2'
      }
    })
  })

  it('keeps provider ZIP output when v3 export controls are non-default', async () => {
    getParseStatusMock.mockResolvedValueOnce({
      code: 'success',
      data: {
        status: 'success',
        result: {
          pages: [
            {
              page_idx: 0,
              md: 'provider markdown',
              layout: {
                blocks: [
                  {
                    id: 'text',
                    type: 'Text',
                    text: 'structured text',
                    bbox: [0, 0, 1, 1],
                    reading_order: 0,
                    parent_id: '',
                    src: ''
                  }
                ]
              }
            }
          ]
        }
      }
    })
    triggerExportTaskMock.mockResolvedValueOnce({
      code: 'success',
      data: { status: 'processing' }
    })

    await expect(
      handleParseStage(
        'uid-v3',
        {
          apiHost: 'https://doc2x.example.com',
          apiKey: 'secret',
          stage: 'parsing',
          modelVersion: 'v3-2026',
          formulaLevel: 1,
          mergeCrossPageForms: false
        },
        {
          apiHost: 'https://doc2x.example.com',
          apiKey: 'secret'
        }
      )
    ).resolves.toEqual({
      status: 'processing',
      progress: 99,
      remoteContext: {
        apiHost: 'https://doc2x.example.com',
        apiKey: 'secret',
        stage: 'exporting',
        modelVersion: 'v3-2026',
        formulaLevel: 1,
        mergeCrossPageForms: false
      }
    })
  })

  it('maps document-to-markdown parse and export poll states', async () => {
    getParseStatusMock.mockResolvedValueOnce({
      code: 'success',
      data: {
        status: 'processing',
        progress: 42
      }
    })

    await expect(
      handleParseStage(
        'uid-1',
        {
          apiHost: 'https://doc2x.example.com',
          apiKey: 'secret',
          stage: 'parsing'
        },
        {
          apiHost: 'https://doc2x.example.com',
          apiKey: 'secret'
        }
      )
    ).resolves.toEqual({
      status: 'processing',
      progress: 42
    })

    getParseStatusMock.mockResolvedValueOnce({
      code: 'success',
      data: {
        status: 'failed',
        detail: 'parse failed'
      }
    })

    await expect(
      handleParseStage(
        'uid-1',
        {
          apiHost: 'https://doc2x.example.com',
          apiKey: 'secret',
          stage: 'parsing'
        },
        {
          apiHost: 'https://doc2x.example.com',
          apiKey: 'secret'
        }
      )
    ).resolves.toEqual({
      status: 'failed',
      error: 'parse failed'
    })

    getParseStatusMock.mockResolvedValueOnce({
      code: 'success',
      data: {
        status: 'success'
      }
    })
    triggerExportTaskMock.mockResolvedValueOnce({
      code: 'success',
      data: {
        status: 'processing'
      }
    })

    await expect(
      handleParseStage(
        'uid-1',
        {
          apiHost: 'https://doc2x.example.com',
          apiKey: 'secret',
          stage: 'parsing'
        },
        {
          apiHost: 'https://doc2x.example.com',
          apiKey: 'secret'
        }
      )
    ).resolves.toEqual({
      status: 'processing',
      progress: 99,
      remoteContext: {
        apiHost: 'https://doc2x.example.com',
        apiKey: 'secret',
        stage: 'exporting'
      }
    })

    getExportResultMock.mockResolvedValueOnce({
      code: 'success',
      data: {
        status: 'failed'
      }
    })

    await expect(
      handleExportStage('uid-1', {
        apiHost: 'https://doc2x.example.com',
        apiKey: 'secret'
      })
    ).resolves.toEqual({
      status: 'failed',
      error: 'Doc2x markdown export failed'
    })

    getExportResultMock.mockResolvedValueOnce({
      code: 'success',
      data: {
        status: 'success',
        url: 'https://download.example.com/result.zip'
      }
    })

    await expect(
      handleExportStage('uid-1', {
        apiHost: 'https://doc2x.example.com',
        apiKey: 'secret'
      })
    ).resolves.toEqual({
      status: 'completed',
      output: {
        kind: 'remote-zip-url',
        downloadUrl: 'https://download.example.com/result.zip',
        configuredApiHost: 'https://doc2x.example.com'
      }
    })

    getExportResultMock.mockResolvedValueOnce({
      code: 'success',
      data: {
        status: 'success',
        url: 'https://download.example.com/result.zip'
      }
    })

    await expect(
      handleExportStage('uid-v3', {
        apiHost: 'https://doc2x.example.com',
        apiKey: 'secret',
        markdownContent: '# structured output'
      })
    ).resolves.toEqual({
      status: 'completed',
      output: {
        kind: 'markdown',
        markdownContent: '# structured output'
      }
    })
  })
})
