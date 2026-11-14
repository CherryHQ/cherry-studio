import path from 'node:path'

import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ getToolSnapshots: vi.fn() }))
vi.mock('@application', () => ({
  application: {
    get: () => ({ getToolSnapshots: mocks.getToolSnapshots }),
    getPath: () => '/dsh/home'
  }
}))
vi.mock('../hermesHome', () => ({ getHermesHome: async () => '/hermes/home' }))

import { getRuntimeProvenance } from '../runtimeProvenance'

describe('getRuntimeProvenance', () => {
  it('reports the Hermes user plugin directory, not its entire config home', async () => {
    mocks.getToolSnapshots.mockResolvedValue({ hermes: { availability: { source: 'system', path: '/bin/hermes' } } })
    const result = await getRuntimeProvenance('hermes')
    expect(result.pluginRoots).toEqual([path.join('/hermes/home', 'plugins')])
    expect(result.reloadRequirement).toBe('restart_session')
  })

  it('leaves DSH package roots unknown and does not require every edit to restart', async () => {
    mocks.getToolSnapshots.mockResolvedValue({ dsh: { availability: { source: 'system', path: '/bin/dsh' } } })
    const result = await getRuntimeProvenance('dsh')
    expect(result.configHome).toBe('/dsh/home')
    expect(result.pluginRoots).toBeNull()
    expect(result.reloadRequirement).toBe('runtime_dependent')
  })
})
