/**
 * RegistryLoader override-index tests — focus on the identity contract when a provider serves one
 * canonical `modelId` under several `apiModelId`s (tokenhub's dated 原厂直供 variants). The generator keeps
 * both rows; the loader must keep the canonical (undated/self) lookup pointing at the undated row while
 * the dated ones stay reachable by their own apiModelId.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { RegistryLoader } from '../registry-loader'

let dir: string
const write = (file: string, data: unknown) => {
  const p = join(dir, file)
  writeFileSync(p, JSON.stringify(data))
  return p
}

const newLoader = (overrides: unknown[]) =>
  new RegistryLoader({
    models: write('models.json', { version: '2026.01.01', models: [] }),
    providers: write('providers.json', { version: '2026.01.01', providers: [] }),
    providerModels: write('provider-models.json', { version: '2026.01.01', overrides })
  })

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'registry-loader-'))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('RegistryLoader override index — duplicate canonical modelId', () => {
  const undated = { providerId: 'tokenhub', modelId: 'deepseek-v4-flash', apiModelId: 'deepseek-v4-flash' }
  const dated = {
    providerId: 'tokenhub',
    modelId: 'deepseek-v4-flash',
    apiModelId: 'deepseek-v4-flash-202605',
    name: 'DeepSeek-V4-Flash 原厂直供'
  }

  it('canonical lookup resolves to the undated/self variant, not the dated one', () => {
    const loader = newLoader([undated, dated])
    expect(loader.findOverride('tokenhub', 'deepseek-v4-flash')).toEqual(undated)
  })

  it('is order-independent — the self variant claims the canonical slot even when listed last', () => {
    const loader = newLoader([dated, undated])
    expect(loader.findOverride('tokenhub', 'deepseek-v4-flash')).toEqual(undated)
  })

  it('the dated variant stays reachable by its own apiModelId', () => {
    const loader = newLoader([undated, dated])
    expect(loader.findOverride('tokenhub', 'deepseek-v4-flash-202605')).toEqual(dated)
  })

  it('both rows surface as distinct overrides for the provider', () => {
    const loader = newLoader([undated, dated])
    expect(loader.getOverridesForProvider('tokenhub')).toHaveLength(2)
  })
})

describe('RegistryLoader override index — exact apiModelId vs normalized collision', () => {
  // normalizeModelId strips the size suffix, so every size collapses to one normalized key
  // (`google.gemma-3-27b-it` and `gemma-3-12b-it` both → `gemma-3-it`). An exact provider SDK id must
  // resolve to its OWN row, never to a same-family sibling that happens to share the normalized key.
  const rows = [
    { providerId: 'aws-bedrock', modelId: 'gemma-3-12b-it', apiModelId: 'google.gemma-3-12b-it' },
    { providerId: 'aws-bedrock', modelId: 'gemma-3-27b-it', apiModelId: 'google.gemma-3-27b-it' },
    { providerId: 'aws-bedrock', modelId: 'llama3-1-8b-instruct', apiModelId: 'meta.llama3-1-8b-instruct-v1:0' },
    { providerId: 'aws-bedrock', modelId: 'llama3-1-70b-instruct', apiModelId: 'meta.llama3-1-70b-instruct-v1:0' }
  ]

  it('exact apiModelId resolves to its own row, not a normalized same-family sibling', () => {
    const loader = newLoader(rows)
    expect(loader.findOverride('aws-bedrock', 'google.gemma-3-27b-it')?.modelId).toBe('gemma-3-27b-it')
    expect(loader.findOverride('aws-bedrock', 'meta.llama3-1-8b-instruct-v1:0')?.modelId).toBe('llama3-1-8b-instruct')
  })

  it('exact canonical modelId still resolves directly', () => {
    const loader = newLoader(rows)
    expect(loader.findOverride('aws-bedrock', 'gemma-3-12b-it')?.apiModelId).toBe('google.gemma-3-12b-it')
  })
})
