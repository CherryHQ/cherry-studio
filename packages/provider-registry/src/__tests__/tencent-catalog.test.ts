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

describe('Tencent TokenHub catalog', () => {
  it('serves Hy4 Preview with its documented wire id, capabilities, and token limits', () => {
    expect(loader.findOverride('tokenhub', 'hy4-preview')).toMatchObject({
      apiModelId: 'hy4-preview',
      modelId: 'hy4-preview'
    })
    expect(loader.findModel('hy4-preview')).toMatchObject({
      capabilities: expect.arrayContaining(['reasoning', 'function-call', 'structured-output']),
      contextWindow: 1048576,
      id: 'hy4-preview',
      maxInputTokens: 983040,
      maxOutputTokens: 65536,
      name: 'Hunyuan 4 Preview',
      ownedBy: 'tencent'
    })
  })
})
