import type { JobContext } from '@main/core/job/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { FileProcessingJobPayload } from '../../tasks/shared'

const { loggerWarnMock, persistResultMock, cleanupResultsDirMock } = vi.hoisted(() => ({
  loggerWarnMock: vi.fn(),
  persistResultMock: vi.fn(),
  cleanupResultsDirMock: vi.fn()
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: vi.fn(() => ({
      warn: loggerWarnMock
    }))
  }
}))

vi.mock('../MarkdownResultStore', () => ({
  markdownResultStore: { persistResult: persistResultMock },
  cleanupFileProcessingResultsDir: cleanupResultsDirMock
}))

const { createFileProcessingJobOutput, getFileProcessingFailureMessage, getFileProcessingMarkdownArtifactPath } =
  await import('../artifacts')

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
  it('returns inline text artifacts without cleanup', async () => {
    const result = await createFileProcessingJobOutput(
      createCtx(),
      { kind: 'text', text: 'hello' },
      {
        feature: 'image_to_text',
        processorId: 'tesseract',
        failureMessage: 'artifact failed'
      }
    )

    expect(result).toEqual({ artifacts: [{ kind: 'text', format: 'plain', text: 'hello' }] })
    expect(persistResultMock).not.toHaveBeenCalled()
    expect(cleanupResultsDirMock).not.toHaveBeenCalled()
  })

  it('persists markdown artifacts', async () => {
    persistResultMock.mockResolvedValue('/tmp/results/job-artifacts-1/output.md')

    const result = await createFileProcessingJobOutput(
      createCtx(),
      { kind: 'markdown', markdownContent: '# hello' },
      {
        feature: 'image_to_text',
        processorId: 'tesseract',
        failureMessage: 'artifact failed'
      }
    )

    expect(result).toEqual({
      artifacts: [{ kind: 'file', format: 'markdown', path: '/tmp/results/job-artifacts-1/output.md' }]
    })
    expect(persistResultMock).toHaveBeenCalledWith({
      jobId: 'job-artifacts-1',
      result: { kind: 'markdown', markdownContent: '# hello' },
      signal: expect.any(AbortSignal)
    })
  })

  it('cleans up markdown artifacts when persistence fails', async () => {
    persistResultMock.mockRejectedValue(new Error('disk full'))
    cleanupResultsDirMock.mockResolvedValue(true)

    await expect(
      createFileProcessingJobOutput(
        createCtx(),
        { kind: 'markdown', markdownContent: '# hello' },
        {
          feature: 'image_to_text',
          processorId: 'tesseract',
          failureMessage: 'artifact failed'
        }
      )
    ).rejects.toThrow('disk full')

    expect(cleanupResultsDirMock).toHaveBeenCalledWith('job-artifacts-1')
    expect(loggerWarnMock).toHaveBeenCalledWith('artifact failed', {
      jobId: 'job-artifacts-1',
      processorId: 'tesseract',
      feature: 'image_to_text',
      cleaned: true
    })
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
          artifacts: [{ kind: 'file', format: 'markdown', path: '/tmp/fp-result/output.md' }]
        }
      } as never)
    ).toBe('/tmp/fp-result/output.md')
  })

  it('rejects completed output without a markdown file artifact', () => {
    expect(() =>
      getFileProcessingMarkdownArtifactPath({
        id: 'fp-job-1',
        type: 'file-processing.remote-poll',
        status: 'completed',
        input: {},
        output: {
          artifacts: [{ kind: 'text', format: 'plain', text: 'hello' }]
        }
      } as never)
    ).toThrow(/without a markdown file artifact/i)
  })

  it('rejects relative markdown artifact paths', () => {
    expect(() =>
      getFileProcessingMarkdownArtifactPath({
        id: 'fp-job-1',
        type: 'file-processing.remote-poll',
        status: 'completed',
        input: {},
        output: {
          artifacts: [{ kind: 'file', format: 'markdown', path: 'relative/output.md' }]
        }
      } as never)
    ).toThrow(/path must be an absolute filesystem path/i)
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
