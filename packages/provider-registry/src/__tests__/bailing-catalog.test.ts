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

describe('Ling 3.0 Flash catalog', () => {
  it.each([
    ['ling-3-0-flash', 'inclusionai/ling-3.0-flash'],
    ['ling-3-0-flash-fin', 'inclusionai/ling-3.0-flash-fin:free']
  ])('serves %s through its OpenRouter wire id', (modelId, apiModelId) => {
    expect(loader.findOverride('openrouter', apiModelId)).toMatchObject({
      apiModelId,
      modelId,
      reasoningContracts: {
        'openai-chat-completions': { support: { controls: [{ default: true, kind: 'toggle' }] } }
      }
    })
    expect(loader.findModel(modelId)).toMatchObject({
      capabilities: expect.arrayContaining(['reasoning', 'function-call']),
      contextWindow: 262144,
      maxOutputTokens: 32000,
      ownedBy: 'bailing'
    })
  })
})
