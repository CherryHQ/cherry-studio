/**
 * Orchestration-layer tests for FileProcessingOrchestrationService.
 *
 * Verifies (1) handler registration on onInit, (2) mode → JobRegistry type
 * routing on startTask, (3) idempotencyKey shape, and (4) listAvailableProcessors
 * delegates to the processor registry. The JobManager itself is stubbed — its
 * idempotency dedup / cancellation behavior is covered by JobManager's own
 * test suite; this layer just verifies we hand it the right arguments.
 */
import type * as LifecycleModule from '@main/core/lifecycle'
import { getDependencies, getPhase } from '@main/core/lifecycle/decorators'
import { Phase } from '@main/core/lifecycle/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  appGetMock,
  enqueueMock,
  registerHandlerMock,
  fileManagerGetByIdMock,
  fileManagerGetMetadataMock,
  toFileInfoMock,
  processorRegistryMock,
  resolveProcessorConfigByFeatureMock,
  isAvailableTesseractMock,
  isAvailableDoc2xMock,
  isAvailableSystemMock
} = vi.hoisted(() => ({
  appGetMock: vi.fn(),
  enqueueMock: vi.fn(),
  registerHandlerMock: vi.fn(),
  fileManagerGetByIdMock: vi.fn(),
  fileManagerGetMetadataMock: vi.fn(),
  toFileInfoMock: vi.fn(),
  processorRegistryMock: {} as Record<string, unknown>,
  resolveProcessorConfigByFeatureMock: vi.fn(),
  isAvailableTesseractMock: vi.fn(() => true),
  isAvailableDoc2xMock: vi.fn(() => true),
  isAvailableSystemMock: vi.fn(() => false)
}))

vi.mock('@application', () => ({
  application: { get: appGetMock }
}))

vi.mock('@logger', () => ({
  loggerService: { withContext: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) }
}))

vi.mock('@main/services/file/toFileInfo', () => ({
  toFileInfo: toFileInfoMock
}))

vi.mock('@main/core/lifecycle', async (importOriginal) => {
  const actual = await importOriginal<typeof LifecycleModule>()
  class MockBaseService {
    ipcHandle = vi.fn()
    protected readonly _disposables: Array<{ dispose: () => void } | (() => void)> = []
    protected registerDisposable<T extends { dispose: () => void } | (() => void)>(d: T): T {
      this._disposables.push(d)
      return d
    }
  }
  return { ...actual, BaseService: MockBaseService }
})

vi.mock('../config/resolveProcessorConfig', () => ({
  resolveProcessorConfigByFeature: resolveProcessorConfigByFeatureMock
}))

vi.mock('../processors/registry', () => ({
  processorRegistry: processorRegistryMock
}))

// Pre-populate the mocked processorRegistry before SUT import.
const tesseractHandler = { mode: 'background', prepare: vi.fn() }
const doc2xHandler = { mode: 'remote-poll', prepare: vi.fn() }
processorRegistryMock.tesseract = {
  capabilities: { image_to_text: tesseractHandler },
  isAvailable: isAvailableTesseractMock
}
processorRegistryMock.doc2x = {
  capabilities: { document_to_markdown: doc2xHandler },
  isAvailable: isAvailableDoc2xMock
}
processorRegistryMock.system = {
  capabilities: { image_to_text: { mode: 'background', prepare: vi.fn() } },
  isAvailable: isAvailableSystemMock
}

const { FileProcessingOrchestrationService } = await import('../FileProcessingOrchestrationService')

const IMAGE_ENTRY_ID = '019606a0-0000-7000-8000-000000000101'
const PDF_ENTRY_ID = '019606a0-0000-7000-8000-000000000102'

const FAKE_IMAGE_ENTRY = {
  id: IMAGE_ENTRY_ID,
  origin: 'external',
  name: 'p',
  ext: 'png',
  externalPath: '/tmp/p.png',
  createdAt: 1,
  updatedAt: 1
}
const FAKE_PDF_ENTRY = {
  id: PDF_ENTRY_ID,
  origin: 'external',
  name: 'doc',
  ext: 'pdf',
  externalPath: '/tmp/doc.pdf',
  createdAt: 1,
  updatedAt: 1
}

const FAKE_IMAGE_INFO = {
  path: '/tmp/p.png',
  name: 'p',
  ext: 'png',
  size: 1024,
  mime: 'image/png',
  type: 'image',
  createdAt: 1,
  modifiedAt: 1
}

const FAKE_PDF_INFO = {
  path: '/tmp/doc.pdf',
  name: 'doc',
  ext: 'pdf',
  size: 9999,
  mime: 'application/pdf',
  type: 'document',
  createdAt: 1,
  modifiedAt: 1
}

function setupFileInfo() {
  fileManagerGetMetadataMock.mockResolvedValue({
    kind: 'file',
    type: 'other',
    size: 1024,
    mime: 'application/octet-stream',
    createdAt: 1,
    modifiedAt: 1
  })
  fileManagerGetByIdMock.mockImplementation(async (id: string) => {
    if (id === IMAGE_ENTRY_ID) return FAKE_IMAGE_ENTRY
    if (id === PDF_ENTRY_ID) return FAKE_PDF_ENTRY
    throw new Error(`Unexpected FileManager.getById(${id})`)
  })
  toFileInfoMock.mockImplementation(async (entry: { id: string }) => {
    if (entry.id === IMAGE_ENTRY_ID) return FAKE_IMAGE_INFO
    if (entry.id === PDF_ENTRY_ID) return FAKE_PDF_INFO
    throw new Error(`Unexpected toFileInfo(${entry.id})`)
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  appGetMock.mockImplementation((name: string) => {
    if (name === 'JobManager') {
      return { enqueue: enqueueMock, registerHandler: registerHandlerMock }
    }
    if (name === 'FileManager') {
      return {
        getById: fileManagerGetByIdMock,
        getMetadata: fileManagerGetMetadataMock
      }
    }
    throw new Error(`Unexpected application.get(${name})`)
  })
  setupFileInfo()
  isAvailableTesseractMock.mockReturnValue(true)
  isAvailableDoc2xMock.mockReturnValue(true)
  isAvailableSystemMock.mockReturnValue(false)
})

describe('FileProcessingOrchestrationService — lifecycle metadata', () => {
  it('runs in WhenReady phase and depends on JobManager', () => {
    expect(getPhase(FileProcessingOrchestrationService)).toBe(Phase.WhenReady)
    expect(getDependencies(FileProcessingOrchestrationService)).toEqual(['JobManager'])
  })
})

describe('FileProcessingOrchestrationService.onInit', () => {
  it('registers both job handlers on JobManager', () => {
    const svc = new FileProcessingOrchestrationService()
    ;(svc as unknown as { onInit(): void }).onInit()

    expect(registerHandlerMock).toHaveBeenCalledTimes(2)
    const types = registerHandlerMock.mock.calls.map((c) => c[0])
    expect(types).toContain('file-processing.background')
    expect(types).toContain('file-processing.remote-poll')
  })

  it('registers IPC handlers for start + listAvailableProcessors only', () => {
    const svc = new FileProcessingOrchestrationService()
    ;(svc as unknown as { onInit(): void }).onInit()

    const ipcHandle = (svc as unknown as { ipcHandle: ReturnType<typeof vi.fn> }).ipcHandle
    const channels = ipcHandle.mock.calls.map((c) => c[0])
    expect(channels).toEqual([
      expect.stringContaining('start-task'),
      expect.stringContaining('list-available-processors')
    ])
  })
})

describe('FileProcessingOrchestrationService.startTask — routing', () => {
  function makeSvc() {
    const svc = new FileProcessingOrchestrationService()
    ;(svc as unknown as { onInit(): void }).onInit()
    enqueueMock.mockResolvedValue({ id: 'job-test-1', snapshot: { status: 'pending' } })
    return svc
  }

  it('routes background-mode handler to file-processing.background type', async () => {
    resolveProcessorConfigByFeatureMock.mockReturnValue({
      id: 'tesseract',
      capabilities: [{ feature: 'image_to_text', inputs: ['image'] }]
    })
    const svc = makeSvc()

    const result = await svc.startTask({
      feature: 'image_to_text',
      fileEntryId: IMAGE_ENTRY_ID,
      processorId: 'tesseract'
    })

    expect(enqueueMock).toHaveBeenCalledWith(
      'file-processing.background',
      { feature: 'image_to_text', fileEntryId: IMAGE_ENTRY_ID, processorId: 'tesseract' },
      { idempotencyKey: `fp:${IMAGE_ENTRY_ID}:tesseract:image_to_text` }
    )
    expect(result).toEqual({
      taskId: 'job-test-1',
      feature: 'image_to_text',
      processorId: 'tesseract',
      status: 'pending',
      progress: 0
    })
  })

  it('routes remote-poll-mode handler to file-processing.remote-poll type', async () => {
    resolveProcessorConfigByFeatureMock.mockReturnValue({
      id: 'doc2x',
      capabilities: [{ feature: 'document_to_markdown', inputs: ['document'] }]
    })
    const svc = makeSvc()

    await svc.startTask({
      feature: 'document_to_markdown',
      fileEntryId: PDF_ENTRY_ID,
      processorId: 'doc2x'
    })

    expect(enqueueMock).toHaveBeenCalledWith(
      'file-processing.remote-poll',
      { feature: 'document_to_markdown', fileEntryId: PDF_ENTRY_ID, processorId: 'doc2x' },
      { idempotencyKey: `fp:${PDF_ENTRY_ID}:doc2x:document_to_markdown` }
    )
  })

  it('builds idempotencyKey deterministically from fileEntryId + processorId + feature', async () => {
    resolveProcessorConfigByFeatureMock.mockReturnValue({
      id: 'tesseract',
      capabilities: [{ feature: 'image_to_text', inputs: ['image'] }]
    })
    const svc = makeSvc()

    await svc.startTask({ feature: 'image_to_text', fileEntryId: IMAGE_ENTRY_ID, processorId: 'tesseract' })
    await svc.startTask({ feature: 'image_to_text', fileEntryId: IMAGE_ENTRY_ID, processorId: 'tesseract' })

    const keys = enqueueMock.mock.calls.map((c) => c[2]?.idempotencyKey)
    expect(keys[0]).toBe(keys[1])
    expect(keys[0]).toBe(`fp:${IMAGE_ENTRY_ID}:tesseract:image_to_text`)
  })

  it('rejects when file type is not in the processor capability inputs', async () => {
    resolveProcessorConfigByFeatureMock.mockReturnValue({
      id: 'doc2x',
      capabilities: [{ feature: 'document_to_markdown', inputs: ['document'] }]
    })
    const svc = makeSvc()

    await expect(
      svc.startTask({ feature: 'document_to_markdown', fileEntryId: IMAGE_ENTRY_ID, processorId: 'doc2x' })
    ).rejects.toThrow(/does not support .* files/)
    expect(enqueueMock).not.toHaveBeenCalled()
  })

  it('rejects directory entries before enqueueing a processor job', async () => {
    resolveProcessorConfigByFeatureMock.mockReturnValue({
      id: 'tesseract',
      capabilities: [{ feature: 'image_to_text', inputs: ['image'] }]
    })
    fileManagerGetMetadataMock.mockResolvedValueOnce({
      kind: 'directory',
      size: 0,
      createdAt: 1,
      modifiedAt: 1
    })
    const svc = makeSvc()

    await expect(
      svc.startTask({ feature: 'image_to_text', fileEntryId: IMAGE_ENTRY_ID, processorId: 'tesseract' })
    ).rejects.toThrow('File processing does not support directories')
    expect(enqueueMock).not.toHaveBeenCalled()
    expect(fileManagerGetByIdMock).not.toHaveBeenCalled()
    expect(toFileInfoMock).not.toHaveBeenCalled()
  })

  it('rejects when processor does not declare the requested feature', async () => {
    resolveProcessorConfigByFeatureMock.mockReturnValue({
      id: 'tesseract',
      capabilities: [{ feature: 'document_to_markdown', inputs: ['document'] }]
    })
    const svc = makeSvc()

    await expect(
      svc.startTask({ feature: 'document_to_markdown', fileEntryId: PDF_ENTRY_ID, processorId: 'tesseract' })
    ).rejects.toThrow(/does not support document_to_markdown/)
    expect(enqueueMock).not.toHaveBeenCalled()
  })
})

describe('FileProcessingOrchestrationService.listAvailableProcessors', () => {
  it('returns only processors whose isAvailable() returns true', () => {
    const svc = new FileProcessingOrchestrationService()
    const result = svc.listAvailableProcessors()

    expect(result.processorIds).toContain('tesseract')
    expect(result.processorIds).toContain('doc2x')
    expect(result.processorIds).not.toContain('system')
  })

  it('re-evaluates isAvailable on each call', () => {
    const svc = new FileProcessingOrchestrationService()
    isAvailableSystemMock.mockReturnValue(true)
    const result = svc.listAvailableProcessors()
    expect(result.processorIds).toContain('system')
  })
})
