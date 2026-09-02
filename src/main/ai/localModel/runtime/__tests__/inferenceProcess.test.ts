import type { ProxyRoutingSnapshot } from '@main/services/proxy/proxyRouting'
import { MockMainPreferenceServiceUtils } from '@test-mocks/main/PreferenceService'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const getRoutingSnapshot = vi.hoisted(() => vi.fn())

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  const result = mockApplicationFactory()
  const originalGet = result.application.get.getMockImplementation()!
  result.application.get.mockImplementation((name: string) => {
    if (name === 'ProxyService') return { getRoutingSnapshot }
    return originalGet(name)
  })
  return result
})

vi.mock('../../installation/LocalModelStorageService', () => ({
  localModelStorageService: { artifactPath: () => '/bindings/onnxruntime.node' }
}))

const { embeddingInferenceProcess, ocrInferenceProcess } = await import('../inferenceProcess')

const DIRECT_ROUTING: ProxyRoutingSnapshot = { version: 7, mode: 'direct' }
const HARDWARE_KEY = 'feature.local_model.hardware_acceleration.enabled'

beforeEach(() => {
  MockMainPreferenceServiceUtils.resetMocks()
  getRoutingSnapshot.mockResolvedValue(DIRECT_ROUTING)
  // Pinned off so the resolved profile is `cpu` on every host platform.
  MockMainPreferenceServiceUtils.setPreferenceValue(HARDWARE_KEY, false)
})

describe('inference process definitions', () => {
  it('carries the current proxy snapshot and catalog artifact paths to both children', async () => {
    const [embedding, ocr] = await Promise.all([
      embeddingInferenceProcess.createInitData!(),
      ocrInferenceProcess.createInitData!()
    ])

    for (const initData of [embedding, ocr]) {
      // The child never re-derives proxy policy, and it must set the binding path before
      // the first require of transformers/ppu — both arrive only through here.
      expect(initData.proxyRouting).toEqual(DIRECT_ROUTING)
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
