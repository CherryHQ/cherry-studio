import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import type { LocalAgentConfiguration } from '@shared/ai/localAgent'
import type { BinaryToolSnapshot } from '@shared/types/binary'

import { detectLocalAgents, openLocalAgentTerminal, resolveLocalAgentLaunch } from '../launch'

const inventory = vi.hoisted(() => ({
  openTerminal: vi.fn(),
  snapshots: {} as Record<string, BinaryToolSnapshot>,
  bundledGitDir: null as string | null
}))
vi.mock('@main/utils/bundledGit', () => ({ getBundledGitDir: () => inventory.bundledGitDir }))
vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory({
    BinaryManager: { getToolSnapshots: async () => inventory.snapshots },
    CodeCliService: { openTerminal: inventory.openTerminal }
  })
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
    inventory.openTerminal.mockReset()
    inventory.openTerminal.mockResolvedValue({ success: true })
    inventory.snapshots = {}
    inventory.bundledGitDir = null
  })
  afterEach(async () => {
    await rm(directory, { recursive: true, force: true })
  })

  it('opens the installed CLI with native terminal arguments and the selected execution environment', async () => {
    inventory.snapshots.codex = { name: 'codex', availability: { source: 'system', path: '/user/bin/codex' } }
    await expect(
      openLocalAgentTerminal({ ...config, args: ['app-server'], env: { CUSTOM: 'explicit' } })
    ).resolves.toEqual({ success: true })
    expect(inventory.openTerminal).toHaveBeenLastCalledWith({
      executable: '/user/bin/codex',
      args: [],
      usesCherryExecutionEnv: false,
      env: { PATH: '/user/bin', MISE_DATA_DIR: '/user/mise', CUSTOM: 'explicit' }
    })
    inventory.snapshots.codex.availability = { source: 'mise', path: '/managed/new/codex' }
    await openLocalAgentTerminal(config)
    expect(inventory.openTerminal).toHaveBeenLastCalledWith(
      expect.objectContaining({
        executable: '/managed/new/codex',
        usesCherryExecutionEnv: true,
        env: expect.objectContaining({ MISE_DATA_DIR: path.join(directory, 'feature.binary.data') })
      })
    )
  })

  it('does not open unsupported ACP adapters or silently replace a missing explicit program', async () => {
    await expect(openLocalAgentTerminal({ ...config, presetId: 'pi-acp', protocol: 'acp' })).rejects.toThrow(
      'supported interactive CLI'
    )
    inventory.snapshots.codex = { name: 'codex', availability: { source: 'system', path: '/user/bin/codex' } }
    await expect(
      openLocalAgentTerminal({ ...config, executableOverride: path.join(directory, 'missing') })
    ).rejects.toThrow()
    expect(inventory.openTerminal).not.toHaveBeenCalled()
  })

  it('blocks new connections while the CLI is being removed', async () => {
    const guard = vi.mocked(application.get('LocalAgentInstallService').isUninstalling)
    guard.mockReturnValue(true)
    try {
      await expect(resolveLocalAgentLaunch(config)).rejects.toThrow('being uninstalled')
    } finally {
      guard.mockReturnValue(false)
    }
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

  it('provides bundled Git as a last fallback without injecting managed state into system CLIs', async () => {
    inventory.bundledGitDir = 'C:\\Cherry\\MinGit\\cmd'
    inventory.snapshots.codex = { name: 'codex', availability: { source: 'system', path: '/user/bin/codex' } }
    const result = await resolveLocalAgentLaunch(config)
    expect(result.env.PATH.split(';')).toEqual(['/user/bin', inventory.bundledGitDir])
    expect(result.env.MISE_DATA_DIR).toBe('/user/mise')
    expect(result.env.HOME).toBe('/user/home')
    expect((await resolveLocalAgentLaunch({ ...config, env: { PATH: '/explicit/bin' } })).env.PATH).toBe(
      '/explicit/bin'
    )
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
    ['cursor', 'agent', ['acp']],
    ['cline', 'cline', ['--acp']],
    ['kilo', 'kilo', ['acp']],
    ['goose', 'goose', ['acp']],
    ['codebuddy-code', 'codebuddy', ['--acp']],
    ['auggie', 'auggie', ['--acp']],
    ['junie', 'junie', ['--acp=true']],
    ['factory-droid', 'droid', ['exec', '--output-format', 'acp-daemon']],
    ['devin', 'devin', ['acp']],
    ['antigravity-acp', 'agy_acp_server.par', []],
    ['mistral-vibe', 'vibe-acp', []],
    ['amp-acp', 'amp-acp', []],
    ['pi-acp', 'pi-acp', []],
    ['deepagents', 'deepagents-acp', []],
    ['glm-acp-agent', 'glm-acp-agent', []],
    ['grok-build', 'grok', ['agent', 'stdio']],
    ['cortex-code', 'cortex', ['acp', 'serve']],
    ['fast-agent', 'fast-agent-acp', ['-x']],
    ['stakpak', 'stakpak', ['acp']],
    ['vtcode', 'vtcode', ['acp']],
    ['poolside', 'pool', ['acp']]
  ] as const)('launches %s through ACP using the installed binary', async (presetId, executable, args) => {
    inventory.snapshots[executable] = {
      name: executable,
      availability: { source: 'system', path: `/user/bin/${executable}` }
    }
    const launch = await resolveLocalAgentLaunch({ ...config, presetId, protocol: 'acp' })
    expect(launch.executable).toBe(`/user/bin/${executable}`)
    expect(launch.args).toEqual(presetId === 'antigravity-acp' && process.platform === 'linux' ? ['--uid='] : args)
    expect(launch.env.MISE_DATA_DIR).toBe('/user/mise')
  })

  it('applies required protocol environment without overriding explicit user choices', async () => {
    inventory.snapshots.vtcode = { name: 'vtcode', availability: { source: 'system', path: '/user/bin/vtcode' } }
    const launch = await resolveLocalAgentLaunch({
      ...config,
      presetId: 'vtcode',
      protocol: 'acp',
      env: { VT_ACP_ZED_ENABLED: '0' }
    })
    expect(launch.env.VT_ACP_ENABLED).toBe('1')
    expect(launch.env.VT_ACP_ZED_ENABLED).toBe('0')
  })

  it('does not mistake the base CLI for a separately installed ACP adapter', async () => {
    inventory.snapshots.pi = { name: 'pi', availability: { source: 'system', path: '/user/bin/pi' } }
    await expect(resolveLocalAgentLaunch({ ...config, presetId: 'pi-acp', protocol: 'acp' })).rejects.toMatchObject({
      code: 'LOCAL_AGENT_NOT_INSTALLED'
    })
  })

  it('prefers managed aliases and leaves missing presets visible during passive discovery', async () => {
    inventory.snapshots.qoderclicn = { name: 'qoderclicn', availability: { source: 'system', path: '/system/qoder' } }
    inventory.snapshots.qoder = { name: 'qoder', availability: { source: 'mise', path: '/managed/qoder' } }
    const found = await detectLocalAgents()
    expect(found.find((entry) => entry.presetId === 'qoder')).toMatchObject({ source: 'mise', path: '/managed/qoder' })
    expect(found.find((entry) => entry.presetId === 'codex')).toMatchObject({ source: 'none' })
  })
})
