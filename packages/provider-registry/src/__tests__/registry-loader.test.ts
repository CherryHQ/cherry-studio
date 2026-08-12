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

const model = (id: string) => ({ id, name: id, ownedBy: 'test', metadata: {} })
const modelLoader = (models: unknown[]) =>
  new RegistryLoader({
    models: write('models.json', { version: '2026.01.01', models }),
    providers: write('providers.json', { version: '2026.01.01', providers: [] }),
    providerModels: write('provider-models.json', { version: '2026.01.01', overrides: [] })
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

describe('RegistryLoader.findModel — registry-tag (colon) size/quant ids', () => {
  // `gpt-oss-20b` and `gpt-oss-120b` collapse to the SAME size-agnostic key (`gpt-oss`). `120b` is listed
  // FIRST, so the first-wins size-agnostic index would return `gpt-oss-120b` for a bare `gpt-oss` lookup —
  // the exact wrong-metadata bug a `gpt-oss:20b` pull must avoid.
  const models = [model('gpt-oss-120b'), model('gpt-oss-20b'), model('qwen2-5-7b-instruct')]

  it('resolves a colon size tag to its own-size row, not a same-family sibling', () => {
    const loader = modelLoader(models)
    expect(loader.findModel('gpt-oss:20b')?.id).toBe('gpt-oss-20b')
    expect(loader.findModel('gpt-oss:120b')?.id).toBe('gpt-oss-120b')
  })

  it('returns null when no exact-size catalog row exists, instead of a wrong-size guess', () => {
    const loader = modelLoader(models)
    // catalog only has `qwen2-5-7b-instruct`; `qwen2.5:7b` must NOT mis-resolve to it or to any sibling.
    expect(loader.findModel('qwen2.5:7b')).toBeNull()
    expect(loader.findModel('mixtral:8x7b')).toBeNull()
  })

  it('still resolves an exact catalog id (colon-less ids keep the existing path)', () => {
    const loader = modelLoader(models)
    expect(loader.findModel('gpt-oss-20b')?.id).toBe('gpt-oss-20b')
  })
})
