import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import type { Provider } from '../../src/providers/types'
import { openaiCompatible } from '../../src/providers/types'
import { scopeProviderRefresh, selectSourceProviders } from '../scopeProviderRefresh'

const source = (id: string, extra: Partial<Provider> = {}): Provider => ({
  ...openaiCompatible({
    id,
    name: id,
    availableInEditions: ['global'],
    baseUrl: 'https://fixture.example/v1',
    website: { official: 'https://fixture.example' },
    overrides: [{ modelId: 'qwen3-8-27b', apiModelId: 'qwen/qwen3.8-27b' }]
  }),
  ...extra
})

describe('source-only provider selection', () => {
  it('deduplicates selected providers without selecting other sources', () => {
    const selected = source('fortytwo')
    expect(selectSourceProviders([source('other'), selected], ['fortytwo', 'fortytwo'])).toEqual([selected])
  })

  it.each([[], [''], [' '], ['fortytwo', '']].map((ids) => [ids]))('rejects empty selection %j', (ids) => {
    expect(() => selectSourceProviders([source('fortytwo')], ids)).toThrow('non-empty')
  })

  it('rejects unknown sources, conflicting modes and zero offers', () => {
    expect(() => selectSourceProviders([], ['fortytwo'])).toThrow('Unknown provider')
    expect(() => selectSourceProviders([source('fortytwo')], ['fortytwo'], true)).toThrow('cannot be combined')
    expect(() => selectSourceProviders([source('fortytwo', { overrides: [] })], ['fortytwo'])).toThrow(
      'no explicit offers'
    )
  })

  it.each<Partial<Provider>>([
    { modelsDevProvider: 'fortytwo' },
    { fetchModels: async () => [] },
    { modelTemplates: [] },
    { standaloneModelIds: [] }
  ])('rejects an enrichment-dependent source %j', (extra) => {
    expect(() => selectSourceProviders([source('fortytwo', extra)], ['fortytwo'])).toThrow('full catalogue generation')
  })
})

describe('source-only offer refresh', () => {
  const current = {
    models: [{ id: 'qwen3-8-27b', name: 'Original canonical', price: 0.5 }],
    overrides: [
      { providerId: 'other', modelId: 'qwen3-8-27b', price: 99 },
      { providerId: 'fortytwo', modelId: 'qwen3-8-27b', price: 1 }
    ]
  }
  const generated = [
    { providerId: 'other', modelId: 'qwen3-8-27b', price: 1000 },
    { providerId: 'fortytwo', modelId: 'qwen3-8-27b', price: 0.425 }
  ]

  it('replaces only selected offers and preserves canonical and sibling prices', () => {
    const before = JSON.stringify(current)
    const result = scopeProviderRefresh(current, generated, ['fortytwo', 'fortytwo'])
    expect(result.models).toBe(current.models)
    expect(result.overrides).toEqual([generated[1], current.overrides[0]])
    expect(JSON.stringify(current)).toBe(before)
  })

  it.each([undefined, 'A named standalone'])('rejects a missing canonical model even if named %s', (name) => {
    const dangling = { providerId: 'fortytwo', modelId: 'absent', price: 0, name }
    expect(() => scopeProviderRefresh(current, [dangling], ['fortytwo'])).toThrow('Unknown canonical model: absent')
  })

  it('rejects zero offers and empty selection instead of deleting valid rows', () => {
    expect(() => scopeProviderRefresh(current, [], ['fortytwo'])).toThrow('no offers')
    expect(() => scopeProviderRefresh(current, generated, [])).toThrow('non-empty')
  })

  it('keeps stable output and content hashes across repeated refreshes', () => {
    const once = scopeProviderRefresh(current, generated, ['fortytwo'])
    const twice = scopeProviderRefresh(once, generated, ['fortytwo'])
    const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
    expect(hash(twice)).toBe(hash(once))
  })
})

describe('provider CLI boundary', () => {
  const generator = fileURLToPath(new URL('../generate-catalog.ts', import.meta.url))
  const denyFetch = 'data:text/javascript,globalThis.fetch=()=>{throw new Error("Unexpected upstream fetch")} '

  it('runs a selected source without fetching upstream or modifying catalogues', () => {
    const result = spawnSync(
      process.execPath,
      ['--import', denyFetch.trim(), '--import', 'tsx', generator, '--provider', 'fortytwo'],
      {
        encoding: 'utf8',
        timeout: 20_000
      }
    )
    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout).toContain('Source-only providers: fortytwo (dry run)')
  })

  it.each([['--model', 'qwen3-8-27b'], ['--providers-only']])('rejects conflicting CLI mode %j', (...flags) => {
    const result = spawnSync(process.execPath, ['--import', 'tsx', generator, '--provider', 'fortytwo', ...flags], {
      encoding: 'utf8',
      timeout: 20_000
    })
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('cannot be combined')
  })
})
