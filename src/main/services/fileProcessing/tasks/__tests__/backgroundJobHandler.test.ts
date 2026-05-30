/**
 * Unit tests for backgroundJobHandler.
 *
 * The capability handler + processor registry + result-persistence layer are
 * mocked at the module boundary; only the JobHandler's execute() orchestration
 * is exercised here (control flow, abort handling, artifact cleanup on
 * post-success failure).
 */
import type { JobContext } from '@main/core/job/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { FileProcessingJobPayload } from '../shared'

const {
  appGetMock,
  fileManagerGetByIdMock,
  fileManagerGetMetadataMock,
  toFileInfoMock,
  resolveProcessorConfigByFeatureMock,
  processorRegistryMock,
  persistResultMock,
  cleanupResultsDirMock,
  capabilityHandlerMock,
  preparedExecuteMock
} = vi.hoisted(() => ({
  appGetMock: vi.fn(),
  fileManagerGetByIdMock: vi.fn(),
  fileManagerGetMetadataMock: vi.fn(),
  toFileInfoMock: vi.fn(),
  resolveProcessorConfigByFeatureMock: vi.fn(),
  processorRegistryMock: {} as Record<string, unknown>,
  persistResultMock: vi.fn(),
  cleanupResultsDirMock: vi.fn(),
  capabilityHandlerMock: {
    mode: 'background' as 'background' | 'remote-poll',
    prepare: vi.fn()
  },
  preparedExecuteMock: vi.fn()
}))

vi.mock('@application', () => ({
  application: { get: appGetMock }
}))

vi.mock('@main/services/file/toFileInfo', () => ({
  toFileInfo: toFileInfoMock
}))

vi.mock('../../config/resolveProcessorConfig', () => ({
  resolveProcessorConfigByFeature: resolveProcessorConfigByFeatureMock
}))

vi.mock('../../processors/registry', () => ({
  processorRegistry: processorRegistryMock
}))

vi.mock('../../persistence/MarkdownResultStore', () => ({
  markdownResultStore: { persistResult: persistResultMock },
  cleanupFileProcessingResultsDir: cleanupResultsDirMock
}))

const { backgroundJobHandler } = await import('../backgroundJobHandler')

const FILE_ENTRY_ID = '019606a0-0000-7000-8000-000000000201'
const FAKE_ENTRY = {
  id: FILE_ENTRY_ID,
  origin: 'external',
  name: 'photo',
  ext: 'png',
  externalPath: '/tmp/photo.png',
  createdAt: 1,
  updatedAt: 1
}
const FAKE_FILE_INFO = {
  path: '/tmp/photo.png',
  name: 'photo',
  ext: 'png',
  size: 1024,
  mime: 'image/png',
  type: 'image',
  createdAt: 1,
  modifiedAt: 1
}

function createCtx(
  overrides: Partial<JobContext<FileProcessingJobPayload>> = {}
): JobContext<FileProcessingJobPayload> {
  const controller = new AbortController()
  return {
    jobId: 'job-1',
    input: { feature: 'image_to_text', fileEntryId: FILE_ENTRY_ID, processorId: 'tesseract' },
    attempt: 0,
    signal: controller.signal,
    metadata: {},
    patchMetadata: vi.fn().mockResolvedValue(undefined),
    reportProgress: vi.fn(),
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as never,
    ...overrides
  } as JobContext<FileProcessingJobPayload>
}

function setupCapability(prepared: unknown) {
  capabilityHandlerMock.prepare.mockResolvedValue(prepared)
  processorRegistryMock.tesseract = {
    capabilities: { image_to_text: capabilityHandlerMock },
    isAvailable: () => true
  }
  resolveProcessorConfigByFeatureMock.mockReturnValue({
    id: 'tesseract',
    capabilities: [{ feature: 'image_to_text', inputs: ['image'] }]
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  appGetMock.mockImplementation((name: string) => {
    if (name === 'FileManager') {
      return {
        getById: fileManagerGetByIdMock,
        getMetadata: fileManagerGetMetadataMock
      }
    }
    throw new Error(`Unexpected application.get(${name})`)
  })
  fileManagerGetMetadataMock.mockResolvedValue({
    kind: 'file',
    type: 'other',
    size: 1024,
    mime: 'application/octet-stream',
    createdAt: 1,
    modifiedAt: 1
  })
  fileManagerGetByIdMock.mockResolvedValue(FAKE_ENTRY)
  toFileInfoMock.mockResolvedValue(FAKE_FILE_INFO)
  capabilityHandlerMock.mode = 'background'
})

describe('backgroundJobHandler.execute', () => {
  it('returns inline text artifact for image_to_text output', async () => {
    preparedExecuteMock.mockResolvedValue({ kind: 'text', text: 'recognized text' })
    setupCapability({ mode: 'background', execute: preparedExecuteMock })

    const ctx = createCtx()
    const result = (await backgroundJobHandler.execute(ctx)) as { artifacts: unknown[] }

    expect(result.artifacts).toEqual([{ kind: 'text', format: 'plain', text: 'recognized text' }])
    expect(capabilityHandlerMock.prepare).toHaveBeenCalledWith(FAKE_FILE_INFO, expect.any(Object), ctx.signal, {
      fileEntryId: FILE_ENTRY_ID
    })
    expect(cleanupResultsDirMock).not.toHaveBeenCalled()
    expect(persistResultMock).not.toHaveBeenCalled()
  })

  it('persists markdown output to disk and returns file artifact', async () => {
    preparedExecuteMock.mockResolvedValue({ kind: 'markdown', markdownContent: '# hello' })
    persistResultMock.mockResolvedValue('/tmp/results/job-1/output.md')
    setupCapability({ mode: 'background', execute: preparedExecuteMock })

    const result = (await backgroundJobHandler.execute(createCtx())) as { artifacts: unknown[] }

    expect(persistResultMock).toHaveBeenCalledWith({
      taskId: 'job-1',
      result: { kind: 'markdown', markdownContent: '# hello' },
      signal: expect.any(AbortSignal)
    })
    expect(result.artifacts).toEqual([{ kind: 'file', format: 'markdown', path: '/tmp/results/job-1/output.md' }])
    expect(cleanupResultsDirMock).not.toHaveBeenCalled()
  })

  it('propagates execute() errors and does NOT cleanup (no partial artifacts yet)', async () => {
    preparedExecuteMock.mockRejectedValue(new Error('tesseract crashed'))
    setupCapability({ mode: 'background', execute: preparedExecuteMock })

    await expect(backgroundJobHandler.execute(createCtx())).rejects.toThrow('tesseract crashed')
    expect(cleanupResultsDirMock).not.toHaveBeenCalled()
  })

  it('cleans up partial artifacts when persistResult() throws after execute success', async () => {
    preparedExecuteMock.mockResolvedValue({ kind: 'markdown', markdownContent: '# hello' })
    persistResultMock.mockRejectedValue(new Error('disk full'))
    setupCapability({ mode: 'background', execute: preparedExecuteMock })

    await expect(backgroundJobHandler.execute(createCtx())).rejects.toThrow('disk full')
    expect(cleanupResultsDirMock).toHaveBeenCalledWith('job-1')
  })

  it('throws AbortError when ctx.signal is aborted between execute() and createArtifacts()', async () => {
    const controller = new AbortController()
    preparedExecuteMock.mockImplementation(async () => {
      controller.abort()
      return { kind: 'text', text: 'partial' }
    })
    setupCapability({ mode: 'background', execute: preparedExecuteMock })

    await expect(backgroundJobHandler.execute(createCtx({ signal: controller.signal }))).rejects.toThrow(/abort/i)
    expect(persistResultMock).not.toHaveBeenCalled()
    expect(cleanupResultsDirMock).not.toHaveBeenCalled()
  })

  it('rejects when handler.mode does not match (drift guard)', async () => {
    capabilityHandlerMock.mode = 'remote-poll'
    setupCapability({ mode: 'background', execute: preparedExecuteMock })

    await expect(backgroundJobHandler.execute(createCtx())).rejects.toThrow(/mode mismatch/i)
  })

  it('rejects when prepared.mode does not match handler.mode (drift guard)', async () => {
    capabilityHandlerMock.mode = 'background'
    setupCapability({ mode: 'remote-poll', execute: preparedExecuteMock })

    await expect(backgroundJobHandler.execute(createCtx())).rejects.toThrow(/mode mismatch/i)
  })
})
