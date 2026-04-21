import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getExportResultMock, getParseStatusMock, triggerExportTaskMock } = vi.hoisted(() => ({
  getExportResultMock: vi.fn(),
  getParseStatusMock: vi.fn(),
  triggerExportTaskMock: vi.fn()
}))

vi.mock('../doc2x/utils', () => ({
  createUploadTask: vi.fn(),
  uploadFile: vi.fn(),
  getParseStatus: getParseStatusMock,
  triggerExportTask: triggerExportTaskMock,
  getExportResult: getExportResultMock
}))

const { doc2xMarkdownProvider } = await import('../doc2xMarkdownProvider')

describe('doc2xMarkdownProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('switches to exporting when export trigger is still processing without a url', async () => {
    getParseStatusMock.mockResolvedValueOnce({
      code: 'success',
      data: {
        status: 'success'
      }
    })
    triggerExportTaskMock.mockResolvedValueOnce({
      code: 'success',
      data: {
        status: 'processing',
        url: undefined
      }
    })

    await expect(
      doc2xMarkdownProvider.pollTask({
        providerTaskId: 'task-1',
        queryContext: {
          apiHost: 'https://v2.doc2x.noedgeai.com',
          apiKey: 'secret',
          stage: 'parsing'
        }
      })
    ).resolves.toEqual({
      status: 'processing',
      progress: 99,
      queryContext: {
        apiHost: 'https://v2.doc2x.noedgeai.com',
        apiKey: 'secret',
        stage: 'exporting'
      }
    })
  })

  it('keeps polling when export result reports success without a url yet', async () => {
    getExportResultMock.mockResolvedValueOnce({
      code: 'success',
      data: {
        status: 'success',
        url: undefined
      }
    })

    await expect(
      doc2xMarkdownProvider.pollTask({
        providerTaskId: 'task-1',
        queryContext: {
          apiHost: 'https://v2.doc2x.noedgeai.com',
          apiKey: 'secret',
          stage: 'exporting'
        }
      })
    ).resolves.toEqual({
      status: 'processing',
      progress: 99
    })
  })
})
