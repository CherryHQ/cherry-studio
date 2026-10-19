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

describe('xfyun catalog enrichment', () => {
  it.each([
    ['xop3qwen0b6embedding', 'qwen3-embedding-0-6b', 'embedding'],
    ['xop3qwen0b6reranker', 'qwen3-reranker-0-6b', 'rerank']
  ])('maps opaque API id %s to %s with the %s capability', (apiModelId, modelId, capability) => {
    const override = loader.findOverride('xfyun', apiModelId)

    expect(override).toMatchObject({ apiModelId, modelId })
    expect(loader.findModel(override?.modelId ?? apiModelId)?.capabilities).toContain(capability)
  })
})
