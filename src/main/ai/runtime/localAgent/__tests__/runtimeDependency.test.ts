import { beforeEach, expect, it, vi } from 'vitest'

import { resolveRequiredRuntime } from '../runtimeDependency'

const state = vi.hoisted(() => ({
  system: '/user/bin/bun' as string | null,
  paths: [] as string[],
  versions: {} as Record<string, string>
}))
vi.mock('which', () => ({ default: async () => state.paths }))
vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory({
    BinaryManager: {
      getToolSnapshots: async () => ({
        bun: { name: 'bun', availability: { source: 'bundled', path: '/bundled/bun' } }
      })
    }
  })
})
vi.mock('@main/utils/commandResolver', () => ({ findExecutableInEnv: async () => state.system }))
vi.mock('@main/utils/processRunner', () => ({
  executeCommand: async (file: string) => {
    if (!(file in state.versions)) throw new Error('Executable failed')
    return state.versions[file]
  }
}))

beforeEach(() => {
  state.paths = []
  state.system = '/user/bin/bun'
  state.versions = { '/user/bin/bun': '1.4.4', '/bundled/bun': '1.4.2' }
})

const runtime = { executable: 'bun' as const, minimumVersion: '1.4.4' }

it('prefers compatible system Bun over an older bundled runtime', async () => {
  expect(await resolveRequiredRuntime(runtime, {})).toMatchObject({ source: 'system', path: '/user/bin/bun' })
})

it('uses a compatible fallback when the system runtime is too old', async () => {
  state.versions = { '/user/bin/bun': '1.3.0', '/bundled/bun': '1.4.5' }
  expect(await resolveRequiredRuntime(runtime, {})).toMatchObject({ source: 'bundled', path: '/bundled/bun' })
})

it.each(['1.4.2', 'not a version'])('rejects an unavailable or incompatible runtime: %s', async (version) => {
  state.versions = { '/bundled/bun': version }
  expect(await resolveRequiredRuntime(runtime, {})).toBeUndefined()
})

it('finds a newly installed compatible Bun behind an older binary on PATH', async () => {
  state.versions = { '/user/bin/bun': '1.3.12', '/npm/bin/bun': '1.4.4', '/bundled/bun': '1.4.2' }
  state.paths = ['/user/bin/bun', '/npm/bin/bun']
  expect(await resolveRequiredRuntime(runtime, { PATH: '/user/bin:/npm/bin' })).toEqual({
    source: 'system',
    path: '/npm/bin/bun'
  })
})
