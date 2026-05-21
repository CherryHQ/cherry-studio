/**
 * Unit tests for backgroundJobHandler.
 *
 * The capability handler + processor registry + result-persistence layer are
 * mocked at the module boundary; only the JobHandler's execute() orchestration
 * is exercised here (control flow, abort handling, artifact cleanup on
 * post-success failure).
 */
import type { JobContext } from '@main/core/job/types'
import type { FileInfo } from '@shared/file/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { FileProcessingJobPayload } from '../shared'

const {
  resolveProcessorConfigByFeatureMock,
  processorRegistryMock,
  fileManagerGetByIdMock,
  toFileInfoMock,
  persistArtifactMock,
  cleanupArtifactsMock,
  capabilityHandlerMock,
  preparedExecuteMock
} = vi.hoisted(() => ({
  resolveProcessorConfigByFeatureMock: vi.fn(),
  processorRegistryMock: {} as Record<string, unknown>,
  fileManagerGetByIdMock: vi.fn(),
  toFileInfoMock: vi.fn(),
  persistArtifactMock: vi.fn(),
  cleanupArtifactsMock: vi.fn(),
  capabilityHandlerMock: {
    mode: 'background' as 'background' | 'remote-poll',
    prepare: vi.fn()
  },
  preparedExecuteMock: vi.fn()
}))

vi.mock('../../config/resolveProcessorConfig', () => ({
  resolveProcessorConfigByFeature: resolveProcessorConfigByFeatureMock
}))

vi.mock('../../processors/registry', () => ({
  processorRegistry: processorRegistryMock
}))

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory({
    FileManager: {
      getById: fileManagerGetByIdMock
    }
  } as Parameters<typeof mockApplicationFactory>[0])
})

vi.mock('@main/services/file', () => ({
  toFileInfo: toFileInfoMock
}))

vi.mock('../../persistence/FileProcessingArtifactPersistence', () => ({
  fileProcessingArtifactPersistence: {
    persistArtifact: persistArtifactMock,
    cleanupArtifacts: cleanupArtifactsMock
  }
}))

const { backgroundJobHandler } = await import('../backgroundJobHandler')

const FILE_ENTRY_ID = '019606a0-0000-7000-8000-000000000101'
const ARTIFACT_ENTRY_ID = '019606a0-0000-7000-8000-000000000201'
const FAKE_ENTRY = { id: FILE_ENTRY_ID }

const FAKE_FILE: FileInfo = {
  name: 'photo',
  path: '/tmp/photo.png' as FileInfo['path'],
  size: 1024,
  ext: 'png',
  mime: 'image/png',
  type: 'image',
  createdAt: 1775114958369,
  modifiedAt: 1775114958369
} as FileInfo

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
  fileManagerGetByIdMock.mockResolvedValue(FAKE_ENTRY)
  toFileInfoMock.mockResolvedValue(FAKE_FILE)
  capabilityHandlerMock.mode = 'background'
})

describe('backgroundJobHandler.execute', () => {
  it('returns inline text artifact for image_to_text output', async () => {
    preparedExecuteMock.mockResolvedValue({ kind: 'text', text: 'recognized text' })
    persistArtifactMock.mockResolvedValue([{ kind: 'text', format: 'plain', text: 'recognized text' }])
    setupCapability({ mode: 'background', execute: preparedExecuteMock })

    const result = (await backgroundJobHandler.execute(createCtx())) as { artifacts: unknown[] }

    expect(persistArtifactMock).toHaveBeenCalledWith({
      taskId: 'job-1',
      output: { kind: 'text', text: 'recognized text' },
      signal: expect.any(AbortSignal)
    })
    expect(result.artifacts).toEqual([{ kind: 'text', format: 'plain', text: 'recognized text' }])
    expect(cleanupArtifactsMock).not.toHaveBeenCalled()
  })

  it('persists markdown output to disk and returns file artifact', async () => {
    preparedExecuteMock.mockResolvedValue({ kind: 'markdown', markdownContent: '# hello' })
    persistArtifactMock.mockResolvedValue([{ kind: 'file', format: 'markdown', fileEntryId: ARTIFACT_ENTRY_ID }])
    setupCapability({ mode: 'background', execute: preparedExecuteMock })

    const result = (await backgroundJobHandler.execute(createCtx())) as { artifacts: unknown[] }

    expect(persistArtifactMock).toHaveBeenCalledWith({
      taskId: 'job-1',
      output: { kind: 'markdown', markdownContent: '# hello' },
      signal: expect.any(AbortSignal)
    })
    expect(result.artifacts).toEqual([{ kind: 'file', format: 'markdown', fileEntryId: ARTIFACT_ENTRY_ID }])
    expect(cleanupArtifactsMock).not.toHaveBeenCalled()
  })

  it('propagates execute() errors and does NOT cleanup (no partial artifacts yet)', async () => {
    preparedExecuteMock.mockRejectedValue(new Error('tesseract crashed'))
    setupCapability({ mode: 'background', execute: preparedExecuteMock })

    await expect(backgroundJobHandler.execute(createCtx())).rejects.toThrow('tesseract crashed')
    expect(cleanupArtifactsMock).not.toHaveBeenCalled()
    expect(persistArtifactMock).not.toHaveBeenCalled()
  })

  it('cleans up partial artifacts when artifact persistence throws after execute success', async () => {
    preparedExecuteMock.mockResolvedValue({ kind: 'markdown', markdownContent: '# hello' })
    persistArtifactMock.mockRejectedValue(new Error('disk full'))
    setupCapability({ mode: 'background', execute: preparedExecuteMock })

    await expect(backgroundJobHandler.execute(createCtx())).rejects.toThrow('disk full')
    expect(cleanupArtifactsMock).toHaveBeenCalledWith({ taskId: 'job-1', artifacts: undefined })
  })

  it('throws AbortError when ctx.signal is aborted between execute() and createArtifacts()', async () => {
    const controller = new AbortController()
    preparedExecuteMock.mockImplementation(async () => {
      controller.abort()
      return { kind: 'text', text: 'partial' }
    })
    setupCapability({ mode: 'background', execute: preparedExecuteMock })

    await expect(backgroundJobHandler.execute(createCtx({ signal: controller.signal }))).rejects.toThrow(/abort/i)
    expect(persistArtifactMock).not.toHaveBeenCalled()
    expect(cleanupArtifactsMock).not.toHaveBeenCalled()
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
