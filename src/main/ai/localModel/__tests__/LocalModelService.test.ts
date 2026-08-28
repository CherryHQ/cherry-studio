import fs from 'node:fs'

import { LOCAL_MODEL_STATUS_CACHE_KEY, type LocalModelStatusSnapshot } from '@shared/data/presets/localModel'
import { MockMainCacheServiceUtils } from '@test-mocks/main/CacheService'
import { MockMainPreferenceServiceUtils } from '@test-mocks/main/PreferenceService'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { InstallState } from '../catalog/types'

const EMBEDDING = 'qwen3-embedding-0.6b'
const OCR = 'pp-ocrv6-medium'
const ASR = 'funasr-nano-int8'

const { scanBundleFiles, isArtifactReady, removeArtifactIfUnused, sweepStaleDownloads } = vi.hoisted(() => ({
  scanBundleFiles: vi.fn(),
  isArtifactReady: vi.fn(),
  removeArtifactIfUnused: vi.fn(),
  sweepStaleDownloads: vi.fn()
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
    removeArtifactIfUnused,
    sweepStaleDownloads,
    bundleInstallDir: () => '/install',
    bundleRootDir: () => '/install',
    pendingBundleFiles: () => [],
    reserveArtifacts: vi.fn(async () => () => {})
  }
}))

const { LocalModelService } = await import('../LocalModelService')
const localModelService = new LocalModelService()

const INSTALLED: InstallState = { status: 'installed' }
const ABSENT: InstallState = { status: 'not_installed' }

function onDisk(states: Partial<Record<string, InstallState>>): void {
  scanBundleFiles.mockImplementation((bundle: { id: string }) => states[bundle.id] ?? ABSENT)
}

beforeEach(() => {
  vi.clearAllMocks()
  MockMainCacheServiceUtils.resetMocks()
  MockMainPreferenceServiceUtils.resetMocks()
  isArtifactReady.mockReturnValue(true)
  removeArtifactIfUnused.mockResolvedValue(true)
  sweepStaleDownloads.mockResolvedValue(undefined)
  onDisk({})
  vi.spyOn(fs.promises, 'rm').mockResolvedValue(undefined)
})

describe('lifecycle', () => {
  it('sweeps every bundle on init and keeps going when one sweep fails', async () => {
    sweepStaleDownloads.mockRejectedValueOnce(new Error('EACCES'))

    await expect(localModelService._doInit()).resolves.toBeUndefined()

    const swept = sweepStaleDownloads.mock.calls.map((call) => call[0].id).sort()
    expect(swept).toEqual([EMBEDDING, OCR, ASR].sort())
  })

  it('cancels an in-flight download on stop instead of leaving it to die with the process', async () => {
    const download = localModelService.download(EMBEDDING, () => new Promise(() => {}))

    await localModelService._doStop()

    await expect(download).resolves.toBe('cancelled')
    expect(MockMainCacheServiceUtils.getSharedCacheValue(LOCAL_MODEL_STATUS_CACHE_KEY)?.[EMBEDDING]).toEqual({
      status: 'not_downloaded',
      percent: 0
    })
  })

  it('waits for an in-flight removal on stop so the bundle directory is not left half-deleted', async () => {
    onDisk({ [OCR]: INSTALLED })
    let finishRemoval!: () => void
    vi.mocked(fs.promises.rm).mockReturnValueOnce(new Promise<void>((resolve) => (finishRemoval = resolve)))
    const removal = localModelService.remove(OCR)

    let stopped = false
    const stop = localModelService._doStop().then(() => (stopped = true))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(stopped).toBe(false)

    finishRemoval()
    await stop
    await expect(removal).resolves.toEqual({ removed: true })
  })
})

describe('status snapshots', () => {
  it('refreshes the shared snapshot from the files on disk', () => {
    onDisk({ [EMBEDDING]: INSTALLED })

    expect(localModelService.refreshStatus(EMBEDDING)).toEqual({ status: 'ready' })
    expect(MockMainCacheServiceUtils.getSharedCacheValue(LOCAL_MODEL_STATUS_CACHE_KEY)).toEqual({
      [EMBEDDING]: { status: 'ready', percent: 100 }
    })
  })

  it('preserves other bundle snapshots when publishing one bundle', () => {
    const ocrSnapshot = { status: 'downloading', percent: 42 } satisfies LocalModelStatusSnapshot
    MockMainCacheServiceUtils.setSharedCacheValue(LOCAL_MODEL_STATUS_CACHE_KEY, { [OCR]: ocrSnapshot })

    localModelService.refreshStatus(EMBEDDING)

    const snapshots = MockMainCacheServiceUtils.getSharedCacheValue(LOCAL_MODEL_STATUS_CACHE_KEY)
    expect(snapshots?.[OCR]).toBe(ocrSnapshot)
    expect(snapshots?.[EMBEDDING]).toEqual({ status: 'not_downloaded', percent: 0 })
  })
})

describe('LocalModelService readiness', () => {
  it('answers for the capability, not for a specific bundle', () => {
    onDisk({ [OCR]: INSTALLED })

    expect(localModelService.isCapabilityReady('ocr')).toBe(true)
    expect(localModelService.isCapabilityReady('embedding')).toBe(false)
  })

  it('is false while the shared runtime the model needs is missing', () => {
    onDisk({ [OCR]: INSTALLED })
    isArtifactReady.mockReturnValue(false)

    expect(localModelService.isCapabilityReady('ocr')).toBe(false)
  })
})

describe('shared artifact cleanup', () => {
  it('drops a runtime once no model has files on disk', async () => {
    await localModelService.remove(OCR)

    expect(removeArtifactIfUnused).toHaveBeenCalledWith('onnxruntime-node')
  })

  it('keeps a runtime another installed model still requires', async () => {
    onDisk({ [EMBEDDING]: INSTALLED })

    await localModelService.remove(OCR)

    expect(removeArtifactIfUnused).not.toHaveBeenCalledWith('onnxruntime-node')
  })

  it('does not let a locked runtime turn cleanup into a failure', async () => {
    removeArtifactIfUnused.mockRejectedValueOnce(new Error('EBUSY'))

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

  it('releases the inference process before deleting model files', async () => {
    await localModelService.remove(OCR)

    expect(terminateOcrRuntime).toHaveBeenCalledOnce()
    expect(vi.mocked(fs.promises.rm)).toHaveBeenCalledWith('/install', { recursive: true, force: true })
  })
})
