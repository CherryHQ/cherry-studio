/**
 * Orchestration-layer tests for FileProcessingService.
 *
 * Verifies (1) handler registration on onInit, (2) mode → JobRegistry type
 * routing on startJob, (3) fresh job creation, and (4) listAvailableProcessors
 * delegates to the processor registry. The JobManager itself is stubbed — its
 * idempotency / cancellation behavior is covered by JobManager's own
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

const { FileProcessingService } = await import('../FileProcessingService')

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

const MARKDOWN_OUTPUT = { kind: 'path' as const, path: '/tmp/out.md' }

const entryPayload = (
  feature: 'image_to_text' | 'document_to_markdown',
  entryId: string,
  processorId: string,
  output?: typeof MARKDOWN_OUTPUT
) => ({
  feature,
  file: { kind: 'entry' as const, entryId },
  processorId,
  ...(output ? { output } : {})
})

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

describe('FileProcessingService — lifecycle metadata', () => {
  it('runs in WhenReady phase and depends on FileManager and JobManager', () => {
    expect(getPhase(FileProcessingService)).toBe(Phase.WhenReady)
    expect(getDependencies(FileProcessingService)).toEqual(['FileManager', 'JobManager'])
  })
})

describe('FileProcessingService.onInit', () => {
  it('registers both job handlers on JobManager', () => {
    const svc = new FileProcessingService()
    ;(svc as unknown as { onInit(): void }).onInit()

    expect(registerHandlerMock).toHaveBeenCalledTimes(2)
    const types = registerHandlerMock.mock.calls.map((c) => c[0])
    expect(types).toContain('file-processing.background')
    expect(types).toContain('file-processing.remote-poll')
  })
})

describe('FileProcessingService.startJob — routing', () => {
  function makeSvc() {
    const svc = new FileProcessingService()
    ;(svc as unknown as { onInit(): void }).onInit()
    enqueueMock.mockResolvedValue({
      id: 'job-test-1',
      snapshot: {
        id: 'job-test-1',
        type: 'file-processing.background',
        status: 'pending',
        input: entryPayload('image_to_text', IMAGE_ENTRY_ID, 'tesseract')
      }
    })
    return svc
  }

  it('routes background-mode handler to file-processing.background type', async () => {
    resolveProcessorConfigByFeatureMock.mockReturnValue({
      id: 'tesseract',
      capabilities: [{ feature: 'image_to_text', inputs: ['image'] }]
    })
    const svc = makeSvc()

    const result = await svc.startJob({
      feature: 'image_to_text',
      file: { kind: 'entry' as const, entryId: IMAGE_ENTRY_ID },
      processorId: 'tesseract'
    })

    expect(enqueueMock).toHaveBeenCalledWith(
      'file-processing.background',
      entryPayload('image_to_text', IMAGE_ENTRY_ID, 'tesseract'),
      {}
    )
    expect(result).toEqual({
      id: 'job-test-1',
      type: 'file-processing.background',
      status: 'pending',
      input: entryPayload('image_to_text', IMAGE_ENTRY_ID, 'tesseract')
    })
  })

  it('routes remote-poll-mode handler to file-processing.remote-poll type', async () => {
    resolveProcessorConfigByFeatureMock.mockReturnValue({
      id: 'doc2x',
      capabilities: [{ feature: 'document_to_markdown', inputs: ['document'] }]
    })
    const svc = makeSvc()

    await svc.startJob({
      feature: 'document_to_markdown',
      file: { kind: 'entry' as const, entryId: PDF_ENTRY_ID },
      processorId: 'doc2x',
      output: MARKDOWN_OUTPUT
    })

    expect(enqueueMock).toHaveBeenCalledWith(
      'file-processing.remote-poll',
      entryPayload('document_to_markdown', PDF_ENTRY_ID, 'doc2x', MARKDOWN_OUTPUT),
      {}
    )
  })

  it('passes parent job linkage to JobManager enqueue options', async () => {
    resolveProcessorConfigByFeatureMock.mockReturnValue({
      id: 'tesseract',
      capabilities: [{ feature: 'image_to_text', inputs: ['image'] }]
    })
    const svc = makeSvc()

    await svc.startJob(
      {
        feature: 'image_to_text',
        file: { kind: 'entry' as const, entryId: IMAGE_ENTRY_ID },
        processorId: 'tesseract'
      },
      { parentId: 'parent-job-1' }
    )

    expect(enqueueMock).toHaveBeenCalledWith(
      'file-processing.background',
      entryPayload('image_to_text', IMAGE_ENTRY_ID, 'tesseract'),
      { parentId: 'parent-job-1' }
    )
  })

  it('starts a fresh processing job for each call', async () => {
    resolveProcessorConfigByFeatureMock.mockReturnValue({
      id: 'tesseract',
      capabilities: [{ feature: 'image_to_text', inputs: ['image'] }]
    })
    const svc = makeSvc()

    await svc.startJob({
      feature: 'image_to_text',
      file: { kind: 'entry' as const, entryId: IMAGE_ENTRY_ID },
      processorId: 'tesseract'
    })
    await svc.startJob({
      feature: 'image_to_text',
      file: { kind: 'entry' as const, entryId: IMAGE_ENTRY_ID },
      processorId: 'tesseract'
    })

    expect(enqueueMock).toHaveBeenCalledTimes(2)
    expect(enqueueMock.mock.calls.map((call) => call[2])).toEqual([{}, {}])
  })

  it('rejects when file type is not in the processor capability inputs', async () => {
    resolveProcessorConfigByFeatureMock.mockReturnValue({
      id: 'doc2x',
      capabilities: [{ feature: 'document_to_markdown', inputs: ['document'] }]
    })
    const svc = makeSvc()

    await expect(
      svc.startJob({
        feature: 'document_to_markdown',
        file: { kind: 'entry' as const, entryId: IMAGE_ENTRY_ID },
        processorId: 'doc2x',
        output: MARKDOWN_OUTPUT
      })
    ).rejects.toThrow(/does not support .* files/)
    expect(enqueueMock).not.toHaveBeenCalled()
  })

  it('rejects a document_to_markdown job that has no output target before enqueueing', async () => {
    resolveProcessorConfigByFeatureMock.mockReturnValue({
      id: 'doc2x',
      capabilities: [{ feature: 'document_to_markdown', inputs: ['document'] }]
    })
    const svc = makeSvc()

    await expect(
      svc.startJob({
        feature: 'document_to_markdown',
        file: { kind: 'entry' as const, entryId: PDF_ENTRY_ID },
        processorId: 'doc2x'
      })
    ).rejects.toThrow('requires a path output target')
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
      svc.startJob({
        feature: 'image_to_text',
        file: { kind: 'entry' as const, entryId: IMAGE_ENTRY_ID },
        processorId: 'tesseract'
      })
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
      svc.startJob({
        feature: 'document_to_markdown',
        file: { kind: 'entry' as const, entryId: PDF_ENTRY_ID },
        processorId: 'tesseract',
        output: MARKDOWN_OUTPUT
      })
    ).rejects.toThrow(/does not support document_to_markdown/)
    expect(enqueueMock).not.toHaveBeenCalled()
  })
})

describe('FileProcessingService.listAvailableProcessors', () => {
  it('returns only processors whose isAvailable() returns true', () => {
    const svc = new FileProcessingService()
    const result = svc.listAvailableProcessors()

    expect(result.processorIds).toContain('tesseract')
    expect(result.processorIds).toContain('doc2x')
    expect(result.processorIds).not.toContain('system')
  })

  it('re-evaluates isAvailable on each call', () => {
    const svc = new FileProcessingService()
    isAvailableSystemMock.mockReturnValue(true)
    const result = svc.listAvailableProcessors()
    expect(result.processorIds).toContain('system')
  })
})
