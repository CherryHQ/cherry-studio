import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { RegistryLoader } from '../registry-loader'

let directory: string
let loader: RegistryLoader

function writeModel(id: string) {
  writeFileSync(join(directory, 'models.json'), JSON.stringify({ version: id, models: [{ id, name: id }] }))
}

beforeEach(() => {
  vi.useFakeTimers()
  directory = mkdtempSync(join(tmpdir(), 'registry-lifecycle-'))
  loader = new RegistryLoader(
    {
      models: join(directory, 'models.json'),
      providers: join(directory, 'providers.json'),
      providerModels: join(directory, 'provider-models.json')
    },
    100
  )
})

afterEach(() => {
  loader.invalidate()
  vi.useRealTimers()
  rmSync(directory, { recursive: true, force: true })
})

describe('Node registry cache lifecycle', () => {
  it('loads model data without requiring the other catalog files', () => {
    writeModel('available-model')

    expect(loader.findModel('available-model')?.name).toBe('available-model')
    expect(() => loader.loadProviders()).toThrow('Failed to load registry file')
  })

  it('keeps active data cached, then rebuilds indexes from disk after the idle timeout', () => {
    writeModel('old-model')
    expect(loader.findModel('old-model')?.id).toBe('old-model')
    writeModel('new-model')

    vi.advanceTimersByTime(90)
    expect(loader.findModel('new-model')).toBeNull()
    vi.advanceTimersByTime(90)
    expect(loader.findModel('old-model')?.id).toBe('old-model')
    vi.advanceTimersByTime(101)

    expect(loader.findModel('old-model')).toBeNull()
    expect(loader.findModel('new-model')?.id).toBe('new-model')
    expect(loader.getModelsVersion()).toBe('new-model')
  })

  it('drops provider API alias indexes when the snapshot is explicitly invalidated', () => {
    const path = join(directory, 'provider-models.json')
    writeFileSync(
      path,
      JSON.stringify({
        version: 'v1',
        overrides: [{ providerId: 'gateway', modelId: 'model', apiModelId: 'deployment' }]
      })
    )
    expect(loader.findOverride('gateway', 'deployment')?.modelId).toBe('model')
    writeFileSync(path, JSON.stringify({ version: 'v2', overrides: [] }))
    loader.invalidate()

    expect(loader.findOverride('gateway', 'deployment')).toBeNull()
    expect(loader.getOverridesForProvider('gateway')).toEqual([])
    expect(loader.getProviderModelsVersion()).toBe('v2')
  })
})
