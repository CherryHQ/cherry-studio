import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import type { LocalAgentConfiguration } from '@shared/ai/localAgent'
import type { BinaryToolSnapshot } from '@shared/types/binary'

import { detectLocalAgents, resolveLocalAgentLaunch } from '../launch'

const inventory = vi.hoisted(() => ({ snapshots: {} as Record<string, BinaryToolSnapshot> }))
vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory({ BinaryManager: { getToolSnapshots: async () => inventory.snapshots } })
})
vi.mock('@main/utils/shellEnv', () => ({
  getRawShellEnv: async () => ({ PATH: '/user/bin', MISE_DATA_DIR: '/user/mise', HOME: '/user/home' })
}))

const config: LocalAgentConfiguration = { presetId: 'codex', protocol: 'codex', enabled: true, args: [], env: {} }

describe('local agent installation resolution', () => {
  let directory: string
  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'local launch '))
    vi.mocked(application.getPath).mockImplementation((key) => path.join(directory, key))
    inventory.snapshots = {}
  })
  afterEach(async () => {
    await rm(directory, { recursive: true, force: true })
  })

  it('refreshes managed paths after upgrades and uses its isolated execution environment', async () => {
    inventory.snapshots.codex = { name: 'codex', availability: { source: 'mise', path: '/managed/v1/codex' } }
    const first = await resolveLocalAgentLaunch(config)
    expect(first.executable).toBe('/managed/v1/codex')
    expect(first.env.MISE_DATA_DIR).toBe(path.join(directory, 'feature.binary.data'))
    expect(first.env.HOME).toBe('/user/home')
    inventory.snapshots.codex.availability = { source: 'mise', path: '/managed/v2/codex' }
    expect((await resolveLocalAgentLaunch(config)).executable).toBe('/managed/v2/codex')
    inventory.snapshots.codex.availability = { source: 'none' }
    await expect(resolveLocalAgentLaunch(config)).rejects.toMatchObject({ code: 'LOCAL_AGENT_NOT_INSTALLED' })
  })

  it('preserves the system environment and applies only explicit overrides', async () => {
    inventory.snapshots.codex = { name: 'codex', availability: { source: 'system', path: '/user/bin/codex' } }
    const result = await resolveLocalAgentLaunch({ ...config, env: { CUSTOM: 'value' } })
    expect(result.env).toEqual({ PATH: '/user/bin', MISE_DATA_DIR: '/user/mise', HOME: '/user/home', CUSTOM: 'value' })
    expect(result.args).toEqual(['app-server'])
  })

  it('honors a path containing spaces and never falls back when an explicit path disappears', async () => {
    inventory.snapshots.codex = { name: 'codex', availability: { source: 'mise', path: '/managed/codex' } }
    const executable = path.join(directory, 'my agent')
    await writeFile(executable, '#!/bin/sh\n')
    await chmod(executable, 0o755)
    const selected = { ...config, executableOverride: executable, args: ['argument with spaces'] }
    expect((await resolveLocalAgentLaunch(selected)).executable).toBe(executable)
    expect((await resolveLocalAgentLaunch(selected)).args).toEqual(['argument with spaces'])
    await rm(executable)
    await expect(resolveLocalAgentLaunch(selected)).rejects.toThrow()
  })

  it.each([
    ['copilot', 'copilot', ['--acp']],
    ['minimax', 'mcode', ['acp']],
    ['cursor', 'agent', ['acp']]
  ] as const)('launches %s through ACP using the installed binary', async (presetId, executable, args) => {
    inventory.snapshots[executable] = {
      name: executable,
      availability: { source: 'system', path: `/user/bin/${executable}` }
    }
    const launch = await resolveLocalAgentLaunch({ ...config, presetId, protocol: 'acp' })
    expect(launch.executable).toBe(`/user/bin/${executable}`)
    expect(launch.args).toEqual(args)
    expect(launch.env.MISE_DATA_DIR).toBe('/user/mise')
  })

  it('prefers managed aliases and leaves missing presets visible during passive discovery', async () => {
    inventory.snapshots.qoderclicn = { name: 'qoderclicn', availability: { source: 'system', path: '/system/qoder' } }
    inventory.snapshots.qoder = { name: 'qoder', availability: { source: 'mise', path: '/managed/qoder' } }
    const found = await detectLocalAgents()
    expect(found.find((entry) => entry.presetId === 'qoder')).toMatchObject({ source: 'mise', path: '/managed/qoder' })
    expect(found.find((entry) => entry.presetId === 'codex')).toMatchObject({ source: 'none' })
    expect(found).toHaveLength(13)
  })
})
