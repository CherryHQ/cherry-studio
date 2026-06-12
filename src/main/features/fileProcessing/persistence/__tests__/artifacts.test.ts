import type { JobContext } from '@main/core/job/types'
import type { FilePath } from '@shared/file/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { FileProcessingJobPayload } from '../../tasks/shared'

const { persistResultMock } = vi.hoisted(() => ({
  persistResultMock: vi.fn()
}))

vi.mock('../MarkdownResultStore', () => ({
  markdownResultStore: { persistResultToPath: persistResultMock }
}))

const {
  createFileProcessingJobOutput,
  getFileProcessingFailureMessage,
  getFileProcessingMarkdownArtifactPath,
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
      file: { kind: 'entry', entryId: '019606a0-0000-7000-8000-000000000204' },
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

function createMarkdownCtx(): JobContext<FileProcessingJobPayload> {
  return createCtx({
    input: {
      feature: 'document_to_markdown',
      file: { kind: 'entry', entryId: '019606a0-0000-7000-8000-000000000204' },
      output: { kind: 'path', path: '/tmp/out.md' as FilePath },
      processorId: 'doc2x'
    }
  })
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

  it('persists a markdown artifact to the path output target', async () => {
    persistResultMock.mockResolvedValue('/tmp/out.md')

    const result = await createFileProcessingJobOutput(createMarkdownCtx(), {
      kind: 'markdown',
      markdownContent: '# hello'
    })

    expect(result).toEqual({
      artifact: { kind: 'file', format: 'markdown', path: '/tmp/out.md' }
    })
    expect(persistResultMock).toHaveBeenCalledWith({
      jobId: 'job-artifacts-1',
      result: { kind: 'markdown', markdownContent: '# hello' },
      path: '/tmp/out.md',
      signal: expect.any(AbortSignal)
    })
  })

  it('rejects a markdown output when no path output target was provided', async () => {
    await expect(
      createFileProcessingJobOutput(createCtx(), { kind: 'markdown', markdownContent: '# hello' })
    ).rejects.toThrow(/no path output target/i)
    expect(persistResultMock).not.toHaveBeenCalled()
  })

  it('propagates markdown artifact persistence failures', async () => {
    persistResultMock.mockRejectedValue(new Error('disk full'))

    await expect(
      createFileProcessingJobOutput(createMarkdownCtx(), { kind: 'markdown', markdownContent: '# hello' })
    ).rejects.toThrow('disk full')
  })
})

describe('getFileProcessingMarkdownArtifactPath', () => {
  it('returns the validated markdown artifact path from a completed job snapshot', () => {
    expect(
      getFileProcessingMarkdownArtifactPath({
        id: 'fp-job-1',
        type: 'file-processing.remote-poll',
        status: 'completed',
        input: {},
        output: {
          artifact: { kind: 'file', format: 'markdown', path: '/tmp/out.md' }
        }
      } as never)
    ).toBe('/tmp/out.md')
  })

  it('rejects completed output without a markdown file artifact', () => {
    expect(() =>
      getFileProcessingMarkdownArtifactPath({
        id: 'fp-job-1',
        type: 'file-processing.remote-poll',
        status: 'completed',
        input: {},
        output: {
          artifact: { kind: 'text', format: 'plain', text: 'hello' }
        }
      } as never)
    ).toThrow(/without a markdown path artifact/i)
  })

  it('rejects markdown artifacts with a non-absolute path', () => {
    expect(() =>
      getFileProcessingMarkdownArtifactPath({
        id: 'fp-job-1',
        type: 'file-processing.remote-poll',
        status: 'completed',
        input: {},
        output: {
          artifact: { kind: 'file', format: 'markdown', path: 'not-an-absolute-path' }
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
        path: '/tmp/out.md' as FilePath
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
