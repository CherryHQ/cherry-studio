import fs from 'node:fs'

import { MockMainPreferenceServiceUtils } from '@test-mocks/main/PreferenceService'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { InstallState } from '../catalog/types'

const EMBEDDING = 'qwen3-embedding-0.6b'
const OCR = 'pp-ocrv6-medium'

const { scanBundleFiles, isArtifactReady, ensureArtifact, removeArtifact } = vi.hoisted(() => ({
  scanBundleFiles: vi.fn(),
  isArtifactReady: vi.fn(),
  ensureArtifact: vi.fn(),
  removeArtifact: vi.fn()
}))

const { terminateOcrRuntime } = vi.hoisted(() => ({
  terminateOcrRuntime: vi.fn(async (after: () => Promise<unknown>) => after())
}))

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  const result = mockApplicationFactory()
  const originalGet = result.application.get.getMockImplementation()!
  result.application.get.mockImplementation((name: string) => {
    if (name === 'OcrInferenceService') return { terminateThen: terminateOcrRuntime }
    return originalGet(name)
  })
  return result
})

vi.mock('@data/services/KnowledgeBaseService', () => ({
  knowledgeBaseService: { acquireEmbeddingModelRemovalGuard: vi.fn() }
}))

vi.mock('../installation/LocalModelStorageService', () => ({
  localModelStorageService: {
    scanBundleFiles,
    isArtifactReady,
    isArtifactSupported: () => true,
    isBundleSupported: () => true,
    removeArtifact,
    bundleInstallDir: () => '/install',
    bundleRootDir: () => '/install',
    pendingBundleFiles: () => [],
    ensureArtifact
  }
}))

const { localModelService } = await import('../LocalModelService')

const INSTALLED: InstallState = { status: 'installed' }
const ABSENT: InstallState = { status: 'not_installed' }

function onDisk(states: Partial<Record<string, InstallState>>): void {
  scanBundleFiles.mockImplementation((bundle: { id: string }) => states[bundle.id] ?? ABSENT)
}

beforeEach(() => {
  vi.clearAllMocks()
  MockMainPreferenceServiceUtils.resetMocks()
  isArtifactReady.mockReturnValue(true)
  ensureArtifact.mockResolvedValue(undefined)
  removeArtifact.mockResolvedValue(undefined)
  onDisk({})
  vi.spyOn(fs.promises, 'rm').mockResolvedValue(undefined)
})

describe('LocalModelService readiness', () => {
  it('answers for the capability, not for a specific bundle', () => {
    onDisk({ [OCR]: INSTALLED })

    expect(localModelService.isReady('ocr')).toBe(true)
    expect(localModelService.isReady('embedding')).toBe(false)
  })

  it('is false while the shared runtime the model needs is missing', () => {
    onDisk({ [OCR]: INSTALLED })
    isArtifactReady.mockReturnValue(false)

    expect(localModelService.isReady('ocr')).toBe(false)
  })
})

describe('shared artifact cleanup', () => {
  it('drops a runtime once no model has files on disk', async () => {
    await localModelService.remove(OCR)

    expect(removeArtifact).toHaveBeenCalledWith('onnxruntime-node')
  })

  it('keeps a runtime another installed model still requires', async () => {
    onDisk({ [EMBEDDING]: INSTALLED })

    await localModelService.remove(OCR)

    expect(removeArtifact).not.toHaveBeenCalled()
  })

  it('keeps a runtime a download in flight may be waiting on', async () => {
    isArtifactReady.mockReturnValue(false)
    ensureArtifact.mockImplementation(
      (_id: string, signal: AbortSignal) =>
        new Promise<void>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), { once: true })
        })
    )
    const pending = localModelService.download(OCR)
    expect(localModelService.getStatusInfo(OCR).status).toBe('downloading')

    await localModelService.remove(EMBEDDING)

    expect(removeArtifact).not.toHaveBeenCalled()
    localModelService.cancel(OCR)
    await pending
  })

  it('does not let a locked runtime turn cleanup into a failure', async () => {
    removeArtifact.mockRejectedValueOnce(new Error('EBUSY'))

    await expect(localModelService.remove(OCR)).resolves.toEqual({ removed: true })
  })
})

describe('removing the OCR model', () => {
  const DEFAULT_KEY = 'feature.file_processing.default_image_to_text'

  it('clears an explicit local-paddleocr default', async () => {
    MockMainPreferenceServiceUtils.setPreferenceValue(DEFAULT_KEY, 'local-paddleocr')

    await expect(localModelService.remove(OCR)).resolves.toEqual({ removed: true })

    expect(MockMainPreferenceServiceUtils.getPreferenceValue(DEFAULT_KEY)).toBeNull()
  })

  it('leaves a different default untouched', async () => {
    MockMainPreferenceServiceUtils.setPreferenceValue(DEFAULT_KEY, 'system')

    await localModelService.remove(OCR)

    expect(MockMainPreferenceServiceUtils.getPreferenceValue(DEFAULT_KEY)).toBe('system')
  })

  it('releases the inference worker before deleting model files', async () => {
    await localModelService.remove(OCR)

    expect(terminateOcrRuntime).toHaveBeenCalledOnce()
    expect(vi.mocked(fs.promises.rm)).toHaveBeenCalledWith('/install', { recursive: true, force: true })
  })
})
