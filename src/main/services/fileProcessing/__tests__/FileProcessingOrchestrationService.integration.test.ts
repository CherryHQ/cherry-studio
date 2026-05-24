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
  enqueueMock,
  ensureExternalEntryMock,
  getVersionMock,
  toFileInfoMock,
  registerHandlerMock,
  processorRegistryMock,
  resolveProcessorConfigByFeatureMock,
  isAvailableTesseractMock,
  isAvailableDoc2xMock,
  isAvailableSystemMock
} = vi.hoisted(() => ({
  enqueueMock: vi.fn(),
  ensureExternalEntryMock: vi.fn(),
  getVersionMock: vi.fn(),
  toFileInfoMock: vi.fn(),
  registerHandlerMock: vi.fn(),
  processorRegistryMock: {} as Record<string, unknown>,
  resolveProcessorConfigByFeatureMock: vi.fn(),
  isAvailableTesseractMock: vi.fn(() => true),
  isAvailableDoc2xMock: vi.fn(() => true),
  isAvailableSystemMock: vi.fn(() => false)
}))

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory({
    JobManager: {
      enqueue: enqueueMock,
      registerHandler: registerHandlerMock
    },
    FileManager: {
      ensureExternalEntry: ensureExternalEntryMock,
      getVersion: getVersionMock
    }
  } as Parameters<typeof mockApplicationFactory>[0])
})

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

vi.mock('@main/services/file', () => ({
  toFileInfo: toFileInfoMock
}))

// Pre-populate the mocked processorRegistry before SUT import.
const tesseractHandler = { mode: 'background', prepare: vi.fn() }
const doc2xHandler = { mode: 'remote-poll', prepare: vi.fn(), prepareRemoteResume: vi.fn() }
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

const FAKE_IMAGE_PATH = '/tmp/p.png' as const
const FAKE_PDF_PATH = '/tmp/doc.pdf' as const

const FAKE_IMAGE_ENTRY = {
  id: '019606a0-0000-7000-8000-000000000101',
  origin: 'external',
  name: 'p',
  ext: 'png',
  externalPath: FAKE_IMAGE_PATH,
  createdAt: 1775114958369,
  updatedAt: 1775114958369
}

const FAKE_PDF_ENTRY = {
  id: '019606a0-0000-7000-8000-000000000102',
  origin: 'external',
  name: 'doc',
  ext: 'pdf',
  externalPath: FAKE_PDF_PATH,
  createdAt: 1775114958369,
  updatedAt: 1775114958369
}

const FAKE_IMAGE_INFO = {
  name: 'p',
  path: '/tmp/p.png',
  size: 1024,
  ext: 'png',
  mime: 'image/png',
  type: 'image',
  createdAt: 1775114958369,
  modifiedAt: 1775114958369
}

const FAKE_PDF_INFO = {
  name: 'doc',
  path: FAKE_PDF_PATH,
  size: 9999,
  ext: 'pdf',
  mime: 'application/pdf',
  type: 'document',
  createdAt: 1775114958369,
  modifiedAt: 1775114958369
}

beforeEach(() => {
  vi.clearAllMocks()
  ensureExternalEntryMock.mockImplementation(async ({ externalPath }: { externalPath: string }) => {
    if (externalPath === FAKE_IMAGE_PATH) {
      return FAKE_IMAGE_ENTRY
    }
    if (externalPath === FAKE_PDF_PATH) {
      return FAKE_PDF_ENTRY
    }
    throw new Error(`Unexpected externalPath ${externalPath}`)
  })
  toFileInfoMock.mockImplementation(async (entry: { id: string }) => {
    if (entry.id === FAKE_IMAGE_ENTRY.id) {
      return FAKE_IMAGE_INFO
    }
    if (entry.id === FAKE_PDF_ENTRY.id) {
      return FAKE_PDF_INFO
    }
    throw new Error(`Unexpected file entry ${entry.id}`)
  })
  getVersionMock.mockImplementation(async (id: string) => {
    if (id === FAKE_IMAGE_ENTRY.id) {
      return { mtime: FAKE_IMAGE_INFO.modifiedAt, size: FAKE_IMAGE_INFO.size }
    }
    if (id === FAKE_PDF_ENTRY.id) {
      return { mtime: FAKE_PDF_INFO.modifiedAt, size: FAKE_PDF_INFO.size }
    }
    throw new Error(`Unexpected file entry ${id}`)
  })
  isAvailableTesseractMock.mockReturnValue(true)
  isAvailableDoc2xMock.mockReturnValue(true)
  isAvailableSystemMock.mockReturnValue(false)
})

describe('FileProcessingOrchestrationService — lifecycle metadata', () => {
  it('runs in WhenReady phase and depends on FileManager and JobManager', () => {
    expect(getPhase(FileProcessingOrchestrationService)).toBe(Phase.WhenReady)
    expect(getDependencies(FileProcessingOrchestrationService)).toEqual(['FileManager', 'JobManager'])
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
      path: FAKE_IMAGE_PATH,
      processorId: 'tesseract'
    })

    expect(enqueueMock).toHaveBeenCalledWith(
      'file-processing.background',
      { feature: 'image_to_text', fileEntryId: FAKE_IMAGE_ENTRY.id, processorId: 'tesseract' },
      { idempotencyKey: `fp:${FAKE_IMAGE_ENTRY.id}:tesseract:image_to_text:1775114958369:1024` }
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
      path: FAKE_PDF_PATH,
      processorId: 'doc2x'
    })

    expect(enqueueMock).toHaveBeenCalledWith(
      'file-processing.remote-poll',
      { feature: 'document_to_markdown', fileEntryId: FAKE_PDF_ENTRY.id, processorId: 'doc2x' },
      { idempotencyKey: `fp:${FAKE_PDF_ENTRY.id}:doc2x:document_to_markdown:1775114958369:9999` }
    )
  })

  it('builds idempotencyKey deterministically from fileEntryId + processorId + feature + file version', async () => {
    resolveProcessorConfigByFeatureMock.mockReturnValue({
      id: 'tesseract',
      capabilities: [{ feature: 'image_to_text', inputs: ['image'] }]
    })
    const svc = makeSvc()

    await svc.startTask({ feature: 'image_to_text', path: FAKE_IMAGE_PATH, processorId: 'tesseract' })
    await svc.startTask({ feature: 'image_to_text', path: FAKE_IMAGE_PATH, processorId: 'tesseract' })

    const keys = enqueueMock.mock.calls.map((c) => c[2]?.idempotencyKey)
    expect(keys[0]).toBe(keys[1])
    expect(keys[0]).toBe(`fp:${FAKE_IMAGE_ENTRY.id}:tesseract:image_to_text:1775114958369:1024`)
  })

  it('builds a different idempotencyKey when file mtime changes', async () => {
    resolveProcessorConfigByFeatureMock.mockReturnValue({
      id: 'tesseract',
      capabilities: [{ feature: 'image_to_text', inputs: ['image'] }]
    })
    getVersionMock
      .mockResolvedValueOnce({ mtime: 1775114958369, size: 1024 })
      .mockResolvedValueOnce({ mtime: 1775114959000, size: 1024 })
    const svc = makeSvc()

    await svc.startTask({ feature: 'image_to_text', path: FAKE_IMAGE_PATH, processorId: 'tesseract' })
    await svc.startTask({ feature: 'image_to_text', path: FAKE_IMAGE_PATH, processorId: 'tesseract' })

    const keys = enqueueMock.mock.calls.map((c) => c[2]?.idempotencyKey)
    expect(keys[0]).toBe(`fp:${FAKE_IMAGE_ENTRY.id}:tesseract:image_to_text:1775114958369:1024`)
    expect(keys[1]).toBe(`fp:${FAKE_IMAGE_ENTRY.id}:tesseract:image_to_text:1775114959000:1024`)
  })

  it('builds a different idempotencyKey when file size changes', async () => {
    resolveProcessorConfigByFeatureMock.mockReturnValue({
      id: 'tesseract',
      capabilities: [{ feature: 'image_to_text', inputs: ['image'] }]
    })
    getVersionMock
      .mockResolvedValueOnce({ mtime: 1775114958369, size: 1024 })
      .mockResolvedValueOnce({ mtime: 1775114958369, size: 2048 })
    const svc = makeSvc()

    await svc.startTask({ feature: 'image_to_text', path: FAKE_IMAGE_PATH, processorId: 'tesseract' })
    await svc.startTask({ feature: 'image_to_text', path: FAKE_IMAGE_PATH, processorId: 'tesseract' })

    const keys = enqueueMock.mock.calls.map((c) => c[2]?.idempotencyKey)
    expect(keys[0]).toBe(`fp:${FAKE_IMAGE_ENTRY.id}:tesseract:image_to_text:1775114958369:1024`)
    expect(keys[1]).toBe(`fp:${FAKE_IMAGE_ENTRY.id}:tesseract:image_to_text:1775114958369:2048`)
    expect(enqueueMock.mock.calls[0][1]).toEqual({
      feature: 'image_to_text',
      fileEntryId: FAKE_IMAGE_ENTRY.id,
      processorId: 'tesseract'
    })
    expect(enqueueMock.mock.calls[1][1]).toEqual({
      feature: 'image_to_text',
      fileEntryId: FAKE_IMAGE_ENTRY.id,
      processorId: 'tesseract'
    })
  })

  it('rejects when file type is not in the processor capability inputs', async () => {
    resolveProcessorConfigByFeatureMock.mockReturnValue({
      id: 'doc2x',
      capabilities: [{ feature: 'document_to_markdown', inputs: ['document'] }]
    })
    const svc = makeSvc()

    await expect(
      svc.startTask({ feature: 'document_to_markdown', path: FAKE_IMAGE_PATH, processorId: 'doc2x' })
    ).rejects.toThrow(/does not support .* files/)
    expect(enqueueMock).not.toHaveBeenCalled()
  })

  it('rejects when processor does not declare the requested feature', async () => {
    resolveProcessorConfigByFeatureMock.mockReturnValue({
      id: 'tesseract',
      capabilities: [{ feature: 'document_to_markdown', inputs: ['document'] }]
    })
    const svc = makeSvc()

    await expect(
      svc.startTask({ feature: 'document_to_markdown', path: FAKE_PDF_PATH, processorId: 'tesseract' })
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
