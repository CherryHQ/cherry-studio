// The three 2.5 entries are retired; mimo-v2.5-pro-ultraspeed was never officially listed.
// These assertions protect catalog spelling consistency, not API availability.
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

const wireIds = [
  ['mimo-v2-5', 'mimo-v2.5'],
  ['mimo-v2-5-pro', 'mimo-v2.5-pro'],
  ['mimo-v2-5-pro-ultraspeed', 'mimo-v2.5-pro-ultraspeed'],
  ['mimo-v2-6-flash', 'mimo-v2.6-flash'],
  ['mimo-v2-6-pro', 'mimo-v2.6-pro'],
  ['mimo-v2-6-pro-ultraspeed', 'mimo-v2.6-pro-ultraspeed']
] as const

describe('MiMo catalog wire IDs', () => {
  it.each(wireIds)('keeps %s canonical with the declared wire ID %s', (modelId, apiModelId) => {
    const override = loader.findOverride('mimo', modelId)
    expect(override?.apiModelId).toBe(apiModelId)
    expect(loader.findModel(modelId)).not.toBeNull()
    expect(override?.reasoningContracts).toMatchObject({
      'anthropic-messages': expect.any(Object),
      'openai-chat-completions': expect.any(Object),
      'openai-responses': expect.any(Object)
    })
  })

  it('resolves the dotted API ID to the same canonical override', () => {
    expect(loader.findOverride('mimo', 'mimo-v2.6-pro')).toEqual(loader.findOverride('mimo', 'mimo-v2-6-pro'))
    expect(loader.findOverride('mimo', 'mimo-v2.6-pro')?.modelId).toBe('mimo-v2-6-pro')
  })
})
