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

describe('DeepSeek official peak prices', () => {
  // Retired API aliases are billed as the current Flash model, not the retired model.
  it.each(['deepseek-flash', 'deepseek-v4-flash', 'deepseek-v4-flash-vision-exp'])('prices %s as Flash', (modelId) => {
    expect(loader.findOverride('deepseek', modelId)?.pricing).toEqual({
      input: { currency: 'USD', perMillionTokens: 0.3 },
      output: { currency: 'USD', perMillionTokens: 1.2 },
      cacheRead: { currency: 'USD', perMillionTokens: 0.006 }
    })
  })
  it('retains the independent Pro price', () => {
    expect(loader.findOverride('deepseek', 'deepseek-v4-pro')?.pricing).toEqual({
      input: { currency: 'USD', perMillionTokens: 1.32 },
      output: { currency: 'USD', perMillionTokens: 3.96 },
      cacheRead: { currency: 'USD', perMillionTokens: 0.044 }
    })
  })
})
