import fs from 'node:fs'

import { MockMainPreferenceServiceUtils } from '@test-mocks/main/PreferenceService'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { InstallState } from '../types'

const EMBEDDING = 'qwen3-embedding-0.6b'
const OCR = 'pp-ocrv6-medium'

const { scanBundleFiles, isArtifactReady, removeArtifact, downloadBundleFiles } = vi.hoisted(() => ({
  scanBundleFiles: vi.fn(),
  isArtifactReady: vi.fn(),
  removeArtifact: vi.fn(),
  downloadBundleFiles: vi.fn()
}))

const { terminateOcrRuntime } = vi.hoisted(() => ({
  // Mirrors the real terminate-then-run-after ordering, so the "released before the files
  // go" assertion below is meaningful.
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

// Real managers over a stubbed disk: status is exactly what the scan says, which is what
// the collector reads.
vi.mock('../LocalModelRegistry', () => ({
  localModelRegistry: {
    scanBundleFiles,
    isArtifactReady,
    removeArtifact,
    bundleInstallDir: () => '/install',
    bundleRootDir: () => '/install',
    pendingBundleFiles: () => [],
    ensureArtifact: vi.fn()
  }
}))

vi.mock('../../acquisition/bundleDownload', () => ({ downloadBundleFiles }))

vi.mock('@main/core/platform', () => ({ isDarwinX64: false }))

const { gcSharedArtifacts, installerFor, isLocalModelReady } = await import('../installers')

const INSTALLED: InstallState = { status: 'installed' }
const ABSENT: InstallState = { status: 'not_installed' }

/** Answer the disk scan per bundle, so each model's status is set independently. */
function onDisk(states: Partial<Record<string, InstallState>>): void {
  scanBundleFiles.mockImplementation((bundle: { id: string }) => states[bundle.id] ?? ABSENT)
}

beforeEach(() => {
  vi.clearAllMocks()
  MockMainPreferenceServiceUtils.resetMocks()
  isArtifactReady.mockReturnValue(true)
  removeArtifact.mockResolvedValue(undefined)
  onDisk({})
  vi.spyOn(fs.promises, 'rm').mockResolvedValue(undefined)
})

describe('isLocalModelReady', () => {
  it('answers for the capability, not for a specific bundle', () => {
    onDisk({ [OCR]: INSTALLED })

    expect(isLocalModelReady('ocr')).toBe(true)
    expect(isLocalModelReady('embedding')).toBe(false)
  })

  it('is false while the shared runtime the model needs is missing', () => {
    // The files alone cannot run inference — a feature gating on this would otherwise
    // start a job that dies inside the worker.
    onDisk({ [OCR]: INSTALLED })
    isArtifactReady.mockReturnValue(false)

    expect(isLocalModelReady('ocr')).toBe(false)
  })
})

describe('gcSharedArtifacts', () => {
  it('drops a runtime once no model has files on disk', async () => {
    await gcSharedArtifacts()

    expect(removeArtifact).toHaveBeenCalledWith('onnxruntime-node')
  })

  it('keeps a runtime another installed model still requires', async () => {
    onDisk({ [EMBEDDING]: INSTALLED })

    await gcSharedArtifacts()

    expect(removeArtifact).not.toHaveBeenCalled()
  })

  it('keeps a runtime a download in flight may be waiting on', async () => {
    // Removal and an interrupted download used to disagree here: removal counted only
    // installed models, so deleting one could pull the runtime out from under a download
    // that was at that moment awaiting the very same fetch.
    downloadBundleFiles.mockImplementation(() => new Promise(() => {}))
    isArtifactReady.mockReturnValue(false)
    const pending = installerFor(OCR).download()
    expect(installerFor(OCR).getStatus()).toBe('downloading')

    await gcSharedArtifacts()

    expect(removeArtifact).not.toHaveBeenCalled()
    installerFor(OCR).cancel()
    await pending
  })

  it('does not let a locked runtime turn cleanup into a failure', async () => {
    // The collector runs on the failure path of a download; throwing here would mask the
    // error that triggered it.
    removeArtifact.mockRejectedValueOnce(new Error('EBUSY'))

    await expect(gcSharedArtifacts()).resolves.toBeUndefined()
  })
})

describe('removing the OCR model', () => {
  const DEFAULT_KEY = 'feature.file_processing.default_image_to_text'

  it('clears an explicit local-paddleocr default, which would otherwise strand every OCR consumer', async () => {
    MockMainPreferenceServiceUtils.setPreferenceValue(DEFAULT_KEY, 'local-paddleocr')

    await expect(installerFor(OCR).remove()).resolves.toEqual({ removed: true })

    // null → resolveProcessorConfigByFeature falls back to the platform default instead of
    // pointing at a model whose weights were just deleted.
    expect(MockMainPreferenceServiceUtils.getPreferenceValue(DEFAULT_KEY)).toBeNull()
  })

  it('leaves a different default untouched', async () => {
    MockMainPreferenceServiceUtils.setPreferenceValue(DEFAULT_KEY, 'system')

    await installerFor(OCR).remove()

    expect(MockMainPreferenceServiceUtils.getPreferenceValue(DEFAULT_KEY)).toBe('system')
  })

  it('releases the inference worker before deleting, so open OCR handles are gone first', async () => {
    await installerFor(OCR).remove()

    // The worker caches PaddleOcrService's native session with the weight files open;
    // Windows fails to delete open files.
    expect(terminateOcrRuntime).toHaveBeenCalledOnce()
    expect(vi.mocked(fs.promises.rm)).toHaveBeenCalledWith('/install', { recursive: true, force: true })
  })
})
