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
  capabilityHandlerMock
} = vi.hoisted(() => ({
  appGetMock: vi.fn(),
  fileManagerGetByIdMock: vi.fn(),
  fileManagerGetMetadataMock: vi.fn(),
  toFileInfoMock: vi.fn(),
  resolveProcessorConfigByFeatureMock: vi.fn(),
  processorRegistryMock: {} as Record<string, unknown>,
  capabilityHandlerMock: {
    mode: 'background' as 'background' | 'remote-poll',
    prepare: vi.fn()
  }
}))

vi.mock('@application', () => ({
  application: { get: appGetMock }
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: vi.fn(() => ({
      warn: vi.fn()
    }))
  }
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

const { prepareFileProcessingJob } = await import('../jobExecution')

const FILE_ENTRY_ID = '019606a0-0000-7000-8000-000000000203'
const FAKE_ENTRY = {
  id: FILE_ENTRY_ID,
  origin: 'external',
  name: 'scan',
  ext: 'png',
  externalPath: '/tmp/scan.png',
  createdAt: 1,
  updatedAt: 1
}
const FAKE_FILE_INFO = {
  path: '/tmp/scan.png',
  name: 'scan',
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
    jobId: 'job-execution-1',
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

function setupCapability(prepared: unknown, mode: 'background' | 'remote-poll' = 'background') {
  capabilityHandlerMock.mode = mode
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
})

describe('prepareFileProcessingJob', () => {
  it('resolves config, file info, and prepared background task', async () => {
    const prepared = { mode: 'background' as const, execute: vi.fn() }
    setupCapability(prepared)

    const ctx = createCtx()
    const result = await prepareFileProcessingJob(ctx, 'background')

    expect(result).toMatchObject({
      feature: 'image_to_text',
      fileEntryId: FILE_ENTRY_ID,
      processorId: 'tesseract',
      config: expect.objectContaining({ id: 'tesseract' }),
      prepared
    })
    expect(resolveProcessorConfigByFeatureMock).toHaveBeenCalledWith('image_to_text', 'tesseract')
    expect(capabilityHandlerMock.prepare).toHaveBeenCalledWith(FAKE_FILE_INFO, expect.any(Object), ctx.signal, {
      fileEntryId: FILE_ENTRY_ID
    })
  })

  it('rejects handler mode drift before prepare', async () => {
    setupCapability({ mode: 'background', execute: vi.fn() }, 'remote-poll')

    await expect(prepareFileProcessingJob(createCtx(), 'background')).rejects.toThrow(/mode mismatch/i)
    expect(capabilityHandlerMock.prepare).not.toHaveBeenCalled()
  })

  it('rejects prepared mode drift after prepare', async () => {
    setupCapability({ mode: 'remote-poll', startRemote: vi.fn() }, 'background')

    await expect(prepareFileProcessingJob(createCtx(), 'background')).rejects.toThrow(/mode mismatch/i)
  })
})
