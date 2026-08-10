import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { RegistryLoader } from '../registry-loader'

const dataDir = join(fileURLToPath(import.meta.url), '..', '..', '..', 'data')
const loader = new RegistryLoader({
  models: join(dataDir, 'models.json'),
  providers: join(dataDir, 'providers.json'),
  providerModels: join(dataDir, 'provider-models.json')
})

const unsupportedAudioModels = [
  ['qwen/qwen3.5-122b-a10b', 'qwen3-5-122b-a10b', ['text', 'image', 'video']],
  ['qwen/qwen3.5-27b', 'qwen3-5-27b', ['text', 'image', 'video']],
  ['qwen/qwen3.5-35b-a3b', 'qwen3-5-35b-a3b', ['text', 'image', 'video']],
  ['qwen/qwen3.5-35b-a3b(free)', 'qwen3-5-35b-a3b', ['text', 'image']],
  ['qwen/qwen3.5-397b-a17b', 'qwen3-5-397b-a17b', ['text', 'image', 'video']],
  ['qwen/qwen3.5-4b(free)', 'qwen3-5-4b', ['text', 'image']],
  ['qwen/qwen3.5-9b(free)', 'qwen3-5-9b', ['text', 'image']]
] as const

describe('CherryIN Qwen audio capability overrides', () => {
  it.each(unsupportedAudioModels)('declares %s without native audio', (apiModelId, canonicalId, inputModalities) => {
    const override = loader.findOverride('cherryin', apiModelId)

    expect(override?.modelId).toBe(canonicalId)
    expect(override?.inputModalities).toEqual(inputModalities)
    const removesAudio = override?.capabilities?.remove?.includes('audio-recognition') ?? false
    const forcesCapabilitiesWithoutAudio =
      override?.capabilities?.force != null && !override.capabilities.force.includes('audio-recognition')
    expect(removesAudio || forcesCapabilitiesWithoutAudio).toBe(true)
  })

  it('does not apply a blanket CherryIN audio override to Omni models', () => {
    expect(loader.findOverride('cherryin', 'qwen3-omni-flash')).toBeNull()
  })
})
