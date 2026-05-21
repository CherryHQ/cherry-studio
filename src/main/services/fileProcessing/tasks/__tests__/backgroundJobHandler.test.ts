/**
 * Unit tests for backgroundJobHandler.
 *
 * The capability handler + processor registry + result-persistence layer are
 * mocked at the module boundary; only the JobHandler's execute() orchestration
 * is exercised here (control flow, abort handling, and artifact commit).
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
  commitOutputMock,
  capabilityHandlerMock,
  preparedExecuteMock
} = vi.hoisted(() => ({
  resolveProcessorConfigByFeatureMock: vi.fn(),
  processorRegistryMock: {} as Record<string, unknown>,
  fileManagerGetByIdMock: vi.fn(),
  toFileInfoMock: vi.fn(),
  commitOutputMock: vi.fn(),
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
    commitOutput: commitOutputMock
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
    commitOutputMock.mockResolvedValue([{ kind: 'text', format: 'plain', text: 'recognized text' }])
    setupCapability({ mode: 'background', execute: preparedExecuteMock })

    const result = (await backgroundJobHandler.execute(createCtx())) as { artifacts: unknown[] }

    expect(commitOutputMock).toHaveBeenCalledWith({
      taskId: 'job-1',
      output: { kind: 'text', text: 'recognized text' },
      signal: expect.any(AbortSignal)
    })
    expect(result.artifacts).toEqual([{ kind: 'text', format: 'plain', text: 'recognized text' }])
  })

  it('persists markdown output to disk and returns file artifact', async () => {
    preparedExecuteMock.mockResolvedValue({ kind: 'markdown', markdownContent: '# hello' })
    commitOutputMock.mockResolvedValue([{ kind: 'file', format: 'markdown', fileEntryId: ARTIFACT_ENTRY_ID }])
    setupCapability({ mode: 'background', execute: preparedExecuteMock })

    const result = (await backgroundJobHandler.execute(createCtx())) as { artifacts: unknown[] }

    expect(commitOutputMock).toHaveBeenCalledWith({
      taskId: 'job-1',
      output: { kind: 'markdown', markdownContent: '# hello' },
      signal: expect.any(AbortSignal)
    })
    expect(result.artifacts).toEqual([{ kind: 'file', format: 'markdown', fileEntryId: ARTIFACT_ENTRY_ID }])
  })

  it('propagates execute() errors without committing artifacts', async () => {
    preparedExecuteMock.mockRejectedValue(new Error('tesseract crashed'))
    setupCapability({ mode: 'background', execute: preparedExecuteMock })

    await expect(backgroundJobHandler.execute(createCtx())).rejects.toThrow('tesseract crashed')
    expect(commitOutputMock).not.toHaveBeenCalled()
  })

  it('propagates artifact commit errors', async () => {
    preparedExecuteMock.mockResolvedValue({ kind: 'markdown', markdownContent: '# hello' })
    commitOutputMock.mockRejectedValue(new Error('disk full'))
    setupCapability({ mode: 'background', execute: preparedExecuteMock })

    await expect(backgroundJobHandler.execute(createCtx())).rejects.toThrow('disk full')
  })

  it('throws AbortError when ctx.signal is aborted between execute() and commit', async () => {
    const controller = new AbortController()
    preparedExecuteMock.mockImplementation(async () => {
      controller.abort()
      return { kind: 'text', text: 'partial' }
    })
    setupCapability({ mode: 'background', execute: preparedExecuteMock })

    await expect(backgroundJobHandler.execute(createCtx({ signal: controller.signal }))).rejects.toThrow(/abort/i)
    expect(commitOutputMock).not.toHaveBeenCalled()
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
