import type { JobContext } from '@main/core/job/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { FileProcessingJobPayload } from '../../tasks/shared'

const { persistResultMock } = vi.hoisted(() => ({
  persistResultMock: vi.fn()
}))

vi.mock('../MarkdownResultStore', () => ({
  markdownResultStore: { persistResult: persistResultMock }
}))

const {
  createFileProcessingJobOutput,
  getFileProcessingFailureMessage,
  getFileProcessingMarkdownArtifactFileEntryId,
  isMarkdownFileArtifact
} = await import('../artifacts')

function createCtx(
  overrides: Partial<JobContext<FileProcessingJobPayload>> = {}
): JobContext<FileProcessingJobPayload> {
  const controller = new AbortController()
  return {
    jobId: 'job-artifacts-1',
    input: {
      feature: 'image_to_text',
      fileEntryId: '019606a0-0000-7000-8000-000000000204',
      processorId: 'tesseract'
    },
    attempt: 0,
    signal: controller.signal,
    metadata: {},
    patchMetadata: vi.fn().mockResolvedValue(undefined),
    reportProgress: vi.fn(),
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as never,
    ...overrides
  } as JobContext<FileProcessingJobPayload>
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('createFileProcessingJobOutput', () => {
  it('returns an inline text artifact without cleanup', async () => {
    const result = await createFileProcessingJobOutput(createCtx(), { kind: 'text', text: 'hello' })

    expect(result).toEqual({ artifact: { kind: 'text', format: 'plain', text: 'hello' } })
    expect(persistResultMock).not.toHaveBeenCalled()
  })

  it('persists a markdown artifact', async () => {
    persistResultMock.mockResolvedValue('019606a0-0000-7000-8000-000000000401')

    const result = await createFileProcessingJobOutput(createCtx(), { kind: 'markdown', markdownContent: '# hello' })

    expect(result).toEqual({
      artifact: { kind: 'file', format: 'markdown', fileEntryId: '019606a0-0000-7000-8000-000000000401' }
    })
    expect(persistResultMock).toHaveBeenCalledWith({
      jobId: 'job-artifacts-1',
      result: { kind: 'markdown', markdownContent: '# hello' },
      signal: expect.any(AbortSignal)
    })
  })

  it('propagates markdown artifact persistence failures', async () => {
    persistResultMock.mockRejectedValue(new Error('disk full'))

    await expect(
      createFileProcessingJobOutput(createCtx(), { kind: 'markdown', markdownContent: '# hello' })
    ).rejects.toThrow('disk full')
  })
})

describe('getFileProcessingMarkdownArtifactFileEntryId', () => {
  it('returns the validated markdown artifact file entry id from a completed job snapshot', () => {
    expect(
      getFileProcessingMarkdownArtifactFileEntryId({
        id: 'fp-job-1',
        type: 'file-processing.remote-poll',
        status: 'completed',
        input: {},
        output: {
          artifact: { kind: 'file', format: 'markdown', fileEntryId: '019606a0-0000-7000-8000-000000000401' }
        }
      } as never)
    ).toBe('019606a0-0000-7000-8000-000000000401')
  })

  it('rejects completed output without a markdown file artifact', () => {
    expect(() =>
      getFileProcessingMarkdownArtifactFileEntryId({
        id: 'fp-job-1',
        type: 'file-processing.remote-poll',
        status: 'completed',
        input: {},
        output: {
          artifact: { kind: 'text', format: 'plain', text: 'hello' }
        }
      } as never)
    ).toThrow(/without a markdown file artifact/i)
  })

  it('rejects invalid markdown artifact file entry ids', () => {
    expect(() =>
      getFileProcessingMarkdownArtifactFileEntryId({
        id: 'fp-job-1',
        type: 'file-processing.remote-poll',
        status: 'completed',
        input: {},
        output: {
          artifact: { kind: 'file', format: 'markdown', fileEntryId: 'not-a-file-entry-id' }
        }
      } as never)
    ).toThrow()
  })
})

describe('isMarkdownFileArtifact', () => {
  it('identifies markdown file artifacts', () => {
    expect(
      isMarkdownFileArtifact({
        kind: 'file',
        format: 'markdown',
        fileEntryId: '019606a0-0000-7000-8000-000000000401'
      })
    ).toBe(true)
    expect(isMarkdownFileArtifact({ kind: 'text', format: 'plain', text: 'hello' })).toBe(false)
  })
})

describe('getFileProcessingFailureMessage', () => {
  it('returns the job error message when present', () => {
    expect(
      getFileProcessingFailureMessage({
        error: { code: 'FAILED', message: 'processor failed', retryable: false }
      } as never)
    ).toBe('processor failed')
  })

  it('returns a fallback when the job has no error message', () => {
    expect(getFileProcessingFailureMessage({ error: null } as never)).toBe('no error details')
  })
})
