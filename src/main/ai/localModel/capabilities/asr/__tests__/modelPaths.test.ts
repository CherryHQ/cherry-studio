import { afterEach, describe, expect, it, vi } from 'vitest'

import { localModelStorageService } from '../../../installation/LocalModelStorageService'
import { resolveAsrModelPaths } from '../modelPaths'

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory()
})
afterEach(() => vi.restoreAllMocks())

describe('selected ASR model resolution', () => {
  it('loads Qwen3 from its own directory when Sherpa is unavailable', () => {
    vi.spyOn(localModelStorageService, 'resolveInstalledDir').mockImplementation((bundle) =>
      bundle.id === 'qwen3-asr-1.7b-8bit' ? '/models/qwen3' : null
    )
    vi.spyOn(localModelStorageService, 'isArtifactReady').mockImplementation((id) => id === 'mlx-node')
    expect(resolveAsrModelPaths('qwen3-asr-1.7b-8bit')).toEqual({ engine: 'mlx', modelDir: '/models/qwen3' })
    expect(() => resolveAsrModelPaths('funasr-nano-int8')).toThrow('not fully downloaded')
  })

  it('never substitutes installed FunASR for missing Qwen3 weights', () => {
    vi.spyOn(localModelStorageService, 'resolveInstalledDir').mockImplementation((bundle) =>
      bundle.id === 'funasr-nano-int8' ? '/models/funasr' : null
    )
    vi.spyOn(localModelStorageService, 'isArtifactReady').mockReturnValue(true)
    expect(resolveAsrModelPaths('funasr-nano-int8')).toMatchObject({ engine: 'sherpa' })
    expect(() => resolveAsrModelPaths('qwen3-asr-1.7b-8bit')).toThrow('not fully downloaded')
  })

  it('rejects a bundle from another capability', () => {
    expect(() => resolveAsrModelPaths('qwen3-tts-0.6b-customvoice-8bit')).toThrow('Unsupported ASR')
  })
})
