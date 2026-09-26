import { MockMainPreferenceServiceUtils } from '@test-mocks/main/PreferenceService'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory()
})

vi.mock('../../installation/LocalModelStorageService', () => ({
  localModelStorageService: { artifactPath: () => '/bindings/onnxruntime.node' }
}))

const { embeddingInferenceProcess, ocrInferenceProcess } = await import('../inferenceProcess')

const HARDWARE_KEY = 'feature.local_model.hardware_acceleration.enabled'

beforeEach(() => {
  MockMainPreferenceServiceUtils.resetMocks()
  // Pinned off so the resolved profile is `cpu` on every host platform.
  MockMainPreferenceServiceUtils.setPreferenceValue(HARDWARE_KEY, false)
})

describe('inference process definitions', () => {
  it('carries the catalog artifact paths and nothing a credential could ride in on', async () => {
    const [embedding, ocr] = await Promise.all([
      embeddingInferenceProcess.createInitData!(),
      ocrInferenceProcess.createInitData!()
    ])

    for (const initData of [embedding, ocr]) {
      // Inference is offline, so the key set is the contract: anything else here (a proxy
      // policy, a token) would be a secret handed to a process that has no use for it.
      expect(Object.keys(initData).sort()).toEqual(['appPath', 'artifactPaths', 'runtimeProfile'])
      // The binding path must arrive before the first require of transformers/ppu.
      expect(initData.artifactPaths['onnxruntime-node']).toBe('/bindings/onnxruntime.node')
      expect(initData.runtimeProfile.id).toBe('cpu')
    }
  })

  it('resolves the hardware profile at launch, not at build time', async () => {
    const { resolveLocalInferenceProfile } = await import('../inferenceAcceleration')
    MockMainPreferenceServiceUtils.setPreferenceValue(HARDWARE_KEY, true)

    const initData = await embeddingInferenceProcess.createInitData!()

    expect(initData.runtimeProfile).toEqual(resolveLocalInferenceProfile(true))
  })
})
