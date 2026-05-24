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
  processorRegistryMock,
  resolveProcessorConfigByFeatureMock,
  isAvailableTesseractMock,
  isAvailableDoc2xMock,
  isAvailableSystemMock
} = vi.hoisted(() => ({
  appGetMock: vi.fn(),
  enqueueMock: vi.fn(),
  registerHandlerMock: vi.fn(),
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

const FAKE_IMAGE = {
  id: 'img-1',
  name: 'p.png',
  origin_name: 'p.png',
  path: '/tmp/p.png',
  size: 1024,
  ext: '.png',
  type: 'image',
  created_at: '2026-05-01T00:00:00Z',
  count: 1
}

const FAKE_PDF = {
  id: 'pdf-1',
  name: 'doc.pdf',
  origin_name: 'doc.pdf',
  path: '/tmp/doc.pdf',
  size: 9999,
  ext: '.pdf',
  type: 'document',
  created_at: '2026-05-01T00:00:00Z',
  count: 1
}

beforeEach(() => {
  vi.clearAllMocks()
  appGetMock.mockImplementation((name: string) => {
    if (name === 'JobManager') {
      return { enqueue: enqueueMock, registerHandler: registerHandlerMock }
    }
    throw new Error(`Unexpected application.get(${name})`)
  })
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
      file: FAKE_IMAGE as never,
      processorId: 'tesseract'
    })

    expect(enqueueMock).toHaveBeenCalledWith(
      'file-processing.background',
      { feature: 'image_to_text', file: FAKE_IMAGE, processorId: 'tesseract' },
      { idempotencyKey: 'fp:img-1:tesseract:image_to_text' }
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
      file: FAKE_PDF as never,
      processorId: 'doc2x'
    })

    expect(enqueueMock).toHaveBeenCalledWith(
      'file-processing.remote-poll',
      { feature: 'document_to_markdown', file: FAKE_PDF, processorId: 'doc2x' },
      { idempotencyKey: 'fp:pdf-1:doc2x:document_to_markdown' }
    )
  })

  it('builds idempotencyKey deterministically from file.id + processorId + feature', async () => {
    resolveProcessorConfigByFeatureMock.mockReturnValue({
      id: 'tesseract',
      capabilities: [{ feature: 'image_to_text', inputs: ['image'] }]
    })
    const svc = makeSvc()

    await svc.startTask({ feature: 'image_to_text', file: FAKE_IMAGE as never, processorId: 'tesseract' })
    await svc.startTask({ feature: 'image_to_text', file: FAKE_IMAGE as never, processorId: 'tesseract' })

    const keys = enqueueMock.mock.calls.map((c) => c[2]?.idempotencyKey)
    expect(keys[0]).toBe(keys[1])
    expect(keys[0]).toBe('fp:img-1:tesseract:image_to_text')
  })

  it('rejects when file type is not in the processor capability inputs', async () => {
    resolveProcessorConfigByFeatureMock.mockReturnValue({
      id: 'doc2x',
      capabilities: [{ feature: 'document_to_markdown', inputs: ['document'] }]
    })
    const svc = makeSvc()

    await expect(
      svc.startTask({ feature: 'document_to_markdown', file: FAKE_IMAGE as never, processorId: 'doc2x' })
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
      svc.startTask({ feature: 'document_to_markdown', file: FAKE_PDF as never, processorId: 'tesseract' })
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
