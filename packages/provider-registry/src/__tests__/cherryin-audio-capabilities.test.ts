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
  ['qwen/qwen3.5-122b-a10b', 'qwen3-5-122b-a10b', 'qwen3-5-122b-a10b', ['text', 'image', 'video']],
  ['qwen/qwen3.5-27b', 'qwen3-5-27b', 'qwen3-5-27b', ['text', 'image', 'video']],
  ['qwen/qwen3.5-35b-a3b', 'qwen3-5-35b-a3b', 'qwen3-5-35b-a3b', ['text', 'image', 'video']],
  ['qwen/qwen3.5-35b-a3b(free)', 'qwen3-5-35b-a3b-free', 'qwen3-5-35b-a3b', ['text', 'image']],
  ['qwen/qwen3.5-397b-a17b', 'qwen3-5-397b-a17b', 'qwen3-5-397b-a17b', ['text', 'image', 'video']],
  ['qwen/qwen3.5-4b(free)', 'qwen3-5-4b', 'qwen3-5-4b', ['text', 'image']],
  ['qwen/qwen3.5-9b(free)', 'qwen3-5-9b', 'qwen3-5-9b', ['text', 'image']]
] as const

describe('CherryIN Qwen audio capability overrides', () => {
  it.each(unsupportedAudioModels)(
    'maps %s to the intended preset and modalities',
    (apiModelId, canonicalId, presetModelId, inputModalities) => {
      const override = loader.findOverride('cherryin', apiModelId)

      expect(override?.apiModelId).toBe(apiModelId)
      expect(override?.modelId).toBe(canonicalId)
      expect(loader.findModel(canonicalId)?.id).toBe(presetModelId)
      expect(override?.inputModalities).toEqual(inputModalities)
    }
  )

  it('does not apply a blanket CherryIN audio override to Omni models', () => {
    expect(loader.findOverride('cherryin', 'qwen3-omni-flash')).toBeNull()
  })
})
