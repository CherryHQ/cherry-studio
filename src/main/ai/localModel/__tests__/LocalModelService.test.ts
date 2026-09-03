import fs from 'node:fs'

import { LOCAL_MODEL_STATUS_CACHE_KEY, type LocalModelStatusSnapshot } from '@shared/data/presets/localModel'
import { MockMainCacheServiceUtils } from '@test-mocks/main/CacheService'
import { MockMainPreferenceServiceUtils } from '@test-mocks/main/PreferenceService'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { InstallState } from '../catalog/types'

const EMBEDDING = 'qwen3-embedding-0.6b'
const OCR = 'pp-ocrv6-medium'

const { scanBundleFiles, isArtifactReady, removeArtifactIfUnused } = vi.hoisted(() => ({
  scanBundleFiles: vi.fn(),
  isArtifactReady: vi.fn(),
  removeArtifactIfUnused: vi.fn()
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
    bundleInstallDir: () => '/install',
    bundleRootDir: () => '/install',
    pendingBundleFiles: () => [],
    reserveArtifacts: vi.fn(async () => () => {})
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
  MockMainCacheServiceUtils.resetMocks()
  MockMainPreferenceServiceUtils.resetMocks()
  isArtifactReady.mockReturnValue(true)
  removeArtifactIfUnused.mockResolvedValue(true)
  onDisk({})
  vi.spyOn(fs.promises, 'rm').mockResolvedValue(undefined)
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

    expect(removeArtifactIfUnused).toHaveBeenCalledWith('onnxruntime-node')
  })

  it('keeps a runtime another installed model still requires', async () => {
    onDisk({ [EMBEDDING]: INSTALLED })

    await localModelService.remove(OCR)

    expect(removeArtifactIfUnused).not.toHaveBeenCalled()
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

  it('releases the inference worker before deleting model files', async () => {
    await localModelService.remove(OCR)

    expect(terminateOcrRuntime).toHaveBeenCalledOnce()
    expect(vi.mocked(fs.promises.rm)).toHaveBeenCalledWith('/install', { recursive: true, force: true })
  })
})
