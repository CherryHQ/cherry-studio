import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { PassThrough } from 'node:stream'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import type { StdioProcess } from '@cherrystudio/agent-runtime/stdio'
import { bindAccount } from '@main/ai/runtime/acp/acpDriver'
import { resolveAcpLaunch, resolveAcpModelLaunch } from '@main/ai/runtime/acp/acpLaunch'
import { resolveClaudeLaunch } from '@main/ai/runtime/claudeCode/localClaudeLaunch'
import { resolveCliProgram } from '@main/ai/runtime/cli/cliProgram'
import { systemAgentEntry } from '@main/ai/runtime/cli/installedCli'
import { spawnLocalAgentStdio } from '@main/ai/runtime/stdioProcess'
import type * as Platform from '@main/core/platform'
import type * as ShellEnv from '@main/utils/shellEnv'
import { getLocalAgentProtocol, type LocalAgentConfiguration } from '@shared/ai/localAgent'
import type { BinaryToolSnapshot } from '@shared/types/binary'
import { AbsoluteFilePathSchema } from '@shared/types/file'

import { detectLocalAgents, openLocalAgentTerminal, resolveLocalAgentCli } from '../localAgentCli'

function resolveLocalAgentLaunch(config: LocalAgentConfiguration) {
  return getLocalAgentProtocol(config.presetId) === 'acp' ? resolveAcpLaunch(config) : resolveCliProgram(config, 'chat')
}

const inventory = vi.hoisted(() => ({
  getRawShellEnv: vi.fn(),
  openTerminal: vi.fn(),
  readConfigFiles: vi.fn(),
  isWin: process.platform === 'win32',
  snapshots: {} as Record<string, BinaryToolSnapshot>,
  bundledGitDir: null as string | null
}))
vi.mock('@main/ai/runtime/stdioProcess', () => ({ spawnLocalAgentStdio: vi.fn() }))
vi.mock('@main/core/platform', async (importOriginal) => ({
  ...(await importOriginal<typeof Platform>()),
  get isWin() {
    return inventory.isWin
  }
}))
vi.mock('@main/utils/bundledGit', () => ({
  getBundledGitDir: () => inventory.bundledGitDir,
  getBundledGitPath: () => (inventory.bundledGitDir ? path.join(inventory.bundledGitDir, 'git.exe') : null)
}))
vi.mock('@main/ai/runtime/cli/runtimeDependency', () => ({
  resolveRequiredRuntime: async ({ executable }: { executable: string }) => {
    const runtime = inventory.snapshots[executable]?.availability
    return runtime?.source !== 'none' ? runtime : undefined
  }
}))
vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory({
    BinaryManager: { getToolSnapshots: async () => inventory.snapshots },
    CodeCliService: { openTerminal: inventory.openTerminal, readConfigFiles: inventory.readConfigFiles }
  })
})
vi.mock('@main/utils/shellEnv', async (importOriginal) => ({
  ...(await importOriginal<typeof ShellEnv>()),
  getRawShellEnv: inventory.getRawShellEnv
}))

const config: LocalAgentConfiguration = { presetId: 'codex', enabled: true, args: [], env: {} }

function installSystemCommands(...names: string[]) {
  for (const name of names) {
    inventory.snapshots[name] = { name, availability: { source: 'system', path: `/user/bin/${name}` } }
  }
}

describe('local agent installation resolution', () => {
  let directory: string
  it.each([
    [{}, 'http://saved.invalid', undefined, 'saved-token'],
    [{ ANTHROPIC_BASE_URL: 'http://custom.invalid' }, 'http://custom.invalid', undefined, undefined],
    [{ ANTHROPIC_API_KEY: 'agent-key' }, 'http://saved.invalid', 'agent-key', undefined]
  ] as const)(
    'keeps scheduled Claude credentials associated with their endpoint (%j)',
    async (env, endpoint, key, token) => {
      inventory.getRawShellEnv.mockResolvedValue({
        PATH: '/user/bin',
        ANTHROPIC_API_KEY: 'stale-shell-key'
      })
      inventory.readConfigFiles.mockResolvedValue([
        {
          target: 'claude-settings',
          content: JSON.stringify({
            model: 'gateway-model',
            env: {
              ANTHROPIC_BASE_URL: 'http://saved.invalid',
              ANTHROPIC_AUTH_TOKEN: 'saved-token',
              ENABLE_TOOL_SEARCH: 'true'
            }
          })
        }
      ])
      const launch = await resolveClaudeLaunch(
        {
          ...config,
          presetId: 'claude',
          executableOverride: process.execPath,
          env
        },
        directory,
        new AbortController().signal,
        'scheduled-chat'
      )
      expect(launch.nativeModel).toBe('gateway-model')
      expect(launch.env.ANTHROPIC_BASE_URL).toBe(endpoint)
      expect(launch.env.ANTHROPIC_API_KEY).toBe(key)
      expect(launch.env.ANTHROPIC_AUTH_TOKEN).toBe(token)
      expect(launch.env).not.toHaveProperty('ENABLE_TOOL_SEARCH')
    }
  )
  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'local launch '))
    vi.mocked(application.getPath).mockImplementation((key, filename) =>
      path.join(directory, key, ...(filename ? [filename] : []))
    )
    inventory.getRawShellEnv
      .mockReset()
      .mockResolvedValue({ PATH: '/user/bin', MISE_DATA_DIR: '/user/mise', HOME: '/user/home' })
    inventory.openTerminal.mockReset()
    inventory.readConfigFiles.mockReset().mockResolvedValue([])
    inventory.isWin = process.platform === 'win32'
    inventory.openTerminal.mockResolvedValue({ success: true })
    inventory.snapshots = {}
    inventory.bundledGitDir = null
  })
  afterEach(async () => {
    await rm(directory, { recursive: true, force: true })
  })

  it.each<{ lastUsedProvider: string; env: Record<string, string> }>([
    { lastUsedProvider: 'anthropic', env: {} },
    { lastUsedProvider: 'openai-compatible', env: { CLINE_DATA_DIR: '/custom/data' } },
    { lastUsedProvider: 'openai-compatible', env: { CLINE_PROVIDER: 'anthropic' } }
  ])(
    'keeps inactive Cherry credentials out of the Cline environment ($lastUsedProvider, $env)',
    async ({ lastUsedProvider, env }) => {
      installSystemCommands('cline')
      inventory.readConfigFiles.mockResolvedValue([
        {
          target: 'cline-providers',
          content: JSON.stringify({
            lastUsedProvider,
            providers: {
              'openai-compatible': {
                cherryManaged: true,
                settings: { apiKey: 'inactive', baseUrl: 'http://127.0.0.1:23334/v1', model: 'inactive-model' }
              }
            }
          })
        }
      ])
      const launch = await resolveLocalAgentLaunch({ ...config, presetId: 'cline', env })
      expect(launch.env.CLINE_API_KEY).toBeUndefined()
      expect(launch.env.CLINE_BASE_URL).toBeUndefined()
      expect(launch.env.CLINE_MODEL).toBeUndefined()
      expect(launch.env).toMatchObject(env)
    }
  )

  it('selects a user-directory installation over a legacy shim for discovery and launch', async () => {
    const entry = systemAgentEntry('codex')
    await mkdir(path.dirname(entry), { recursive: true })
    await writeFile(entry, '', { mode: 0o755 })
    inventory.snapshots.codex = {
      name: 'codex',
      availability: { source: 'mise', path: path.join(directory, 'shims', 'codex') }
    }
    expect((await detectLocalAgents()).find((agent) => agent.presetId === 'codex')?.path).toBe(entry)
    expect((await resolveLocalAgentLaunch(config)).executable).toBe(entry)
  })

  it.skipIf(process.platform === 'win32')(
    'does not reclassify a user-bin link to an old managed command as system',
    async () => {
      const managed = application.getPath('feature.binary.data', 'codex')
      const entry = systemAgentEntry('codex')
      await mkdir(path.dirname(managed), { recursive: true })
      await mkdir(path.dirname(entry), { recursive: true })
      await writeFile(managed, '', { mode: 0o755 })
      await symlink(managed, entry)
      inventory.snapshots.codex = { name: 'codex', availability: { source: 'mise', path: managed } }
      expect((await detectLocalAgents()).find((agent) => agent.presetId === 'codex')).toMatchObject({
        source: 'mise',
        path: managed
      })
      expect((await resolveLocalAgentLaunch(config)).executable).toBe(managed)
    }
  )

  it('rejects a DeepSeek installation without the ACP profile during detection and launch', async () => {
    inventory.snapshots.dsh = {
      name: 'dsh',
      availability: { source: 'mise', path: '/mise/shims/dsh', version: '0.1.0-rc.7' }
    }
    expect((await detectLocalAgents()).find((entry) => entry.presetId === 'deepseek-harness')?.source).toBe('none')
    await expect(resolveLocalAgentLaunch({ ...config, presetId: 'deepseek-harness' })).rejects.toMatchObject({
      code: 'LOCAL_AGENT_NOT_INSTALLED'
    })
  })

  it('marks a failed backend lookup as uncertain while preserving verified runnable binaries', async () => {
    const application = { status: 'unknown', reason: 'query_failed' } as const
    inventory.snapshots.codex = { name: 'codex', availability: { source: 'none' }, application }
    inventory.snapshots.agy = { name: 'agy', availability: { source: 'system', path: '/user/bin/agy' }, application }

    const detected = await detectLocalAgents()
    expect(detected.find(({ presetId }) => presetId === 'codex')).toMatchObject({ uncertain: true })
    const antigravity = detected.find(({ presetId }) => presetId === 'antigravity-acp')
    expect(antigravity).toMatchObject({ path: '/user/bin/agy', uncertain: true })
  })

  it('signs into Antigravity through the same CLI used for ACP sessions', async () => {
    installSystemCommands('agy')
    await openLocalAgentTerminal({ ...config, presetId: 'antigravity-acp', login: true })
    expect(inventory.openTerminal).toHaveBeenCalledWith(
      expect.objectContaining({ executable: '/user/bin/agy', args: ['acp', '--login'] })
    )
  })

  it('uses the environment promoted during discovery when launching a system CLI', async () => {
    inventory.getRawShellEnv
      .mockResolvedValueOnce({ PATH: '/usr/bin' })
      .mockResolvedValue({ PATH: '/fnm/bin:/usr/bin', FNM_MULTISHELL_PATH: '/fnm' })
    inventory.snapshots.codex = { name: 'codex', availability: { source: 'system', path: '/fnm/bin/codex' } }
    const launch = await resolveLocalAgentLaunch(config)
    expect(launch.executable).toBe('/fnm/bin/codex')
    expect(launch.env).toMatchObject({ PATH: '/fnm/bin:/usr/bin', FNM_MULTISHELL_PATH: '/fnm' })
  })

  it('starts OpenClaw ACP with the formal native state directory and config file', async () => {
    installSystemCommands('openclaw')
    const launch = await resolveLocalAgentLaunch({ ...config, presetId: 'openclaw' })
    expect(launch.args).toEqual(['acp'])
    expect(launch.env).toMatchObject({
      OPENCLAW_STATE_DIR: path.join(directory, 'external.openclaw.config'),
      OPENCLAW_CONFIG_PATH: path.join(directory, 'external.openclaw.config', 'openclaw.json'),
      OPENCLAW_NO_AUTO_UPDATE: '1'
    })
  })

  it('uses the saved Poolside profile for ACP while leaving native terminal account handling to the CLI', async () => {
    installSystemCommands('pool')
    inventory.readConfigFiles.mockResolvedValue([
      {
        target: 'poolside-settings',
        content: `pool:
  default_agent_server: cherry-poolside
agent_servers:
  Poolside:
    default_config_options:
      model: poolside/native-model
  cherry-poolside:
    default_config_options:
      model: gateway/model
    env:
      POOLSIDE_API_KEY: gateway-key
      POOLSIDE_STANDALONE_BASE_URL: http://127.0.0.1:1234/v1
      POOLSIDE_STANDALONE_MODEL: gateway/model
`
      }
    ])
    const selected = { ...config, presetId: 'poolside' }
    const launch = await resolveLocalAgentLaunch(selected)
    expect(launch.nativeModel).toBe('gateway/model')
    expect(launch.env).toMatchObject({
      POOLSIDE_API_KEY: 'gateway-key',
      POOLSIDE_STANDALONE_BASE_URL: 'http://127.0.0.1:1234/v1'
    })
    const catalog = await resolveAcpModelLaunch(selected)
    expect(catalog.nativeModel).toBe('poolside/native-model')
    expect(catalog.env).not.toHaveProperty('POOLSIDE_API_KEY')
    await openLocalAgentTerminal(selected)
    expect(inventory.openTerminal.mock.lastCall?.[0].env).not.toHaveProperty('POOLSIDE_API_KEY')
  })

  it('opens the installed CLI with native terminal arguments and the selected execution environment', async () => {
    installSystemCommands('codex')
    await expect(
      openLocalAgentTerminal({
        ...config,
        args: ['app-server'],
        env: { CUSTOM: 'explicit' },
        directory: AbsoluteFilePathSchema.parse('/user/my project'),
        terminal: 'iTerm2'
      })
    ).resolves.toEqual({ success: true })
    expect(inventory.openTerminal).toHaveBeenLastCalledWith({
      executable: '/user/bin/codex',
      args: [],
      usesCherryExecutionEnv: false,
      directory: AbsoluteFilePathSchema.parse('/user/my project'),
      terminal: 'iTerm2',
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

  it('passes mixed-case Windows overrides to the terminal with the same values as protocol launches', async () => {
    inventory.isWin = true
    installSystemCommands('codex')
    const selected = { ...config, env: { Codex_Home: '/selected/codex', foo: 'explicit' } }
    const launch = await resolveLocalAgentLaunch(selected)
    await openLocalAgentTerminal(selected)
    expect(launch.env.CODEX_HOME).toBe('/selected/codex')
    expect(launch.env.FOO).toBe('explicit')
    expect(inventory.openTerminal).toHaveBeenLastCalledWith({
      executable: launch.executable,
      args: [],
      usesCherryExecutionEnv: false,
      env: { PATH: '/user/bin', MISE_DATA_DIR: '/user/mise', CODEX_HOME: launch.env.CODEX_HOME, FOO: launch.env.FOO }
    })
  })

  it.each([
    ['goose', 'goose', ['session']],
    ['kiro', 'kiro-cli', ['chat']],
    ['cline', 'cline', []],
    ['omp', 'omp', []],
    ['snow', 'snow', []],
    ['zcode', 'zcode-acp', []]
  ] as const)('opens %s interactively without ACP or custom protocol arguments', async (presetId, executable, args) => {
    inventory.snapshots[executable] = {
      name: executable,
      availability: { source: 'system', path: `/user/bin/${executable}` }
    }
    if (presetId === 'zcode') {
      installSystemCommands('zcode')
    }
    await openLocalAgentTerminal({ ...config, presetId, enabled: false, args: ['--acp'] })
    expect(inventory.openTerminal).toHaveBeenLastCalledWith(
      expect.objectContaining({
        executable: `/user/bin/${executable}`,
        args
      })
    )
  })

  it.each([
    ['omp', 'omp', ['acp']],
    ['snow', 'snow', ['--acp']],
    ['zcode', 'zcode-acp', ['server']]
  ] as const)('launches %s in protocol mode rather than its interactive UI', async (presetId, executable, args) => {
    inventory.snapshots[executable] = {
      name: executable,
      availability: { source: 'system', path: `/user/bin/${executable}` }
    }
    if (presetId === 'zcode') {
      installSystemCommands('zcode')
    }
    const launch = await resolveLocalAgentLaunch({ ...config, presetId })
    expect(launch).toMatchObject({ executable: `/user/bin/${executable}`, args: [...args] })
    if (presetId === 'zcode') expect(launch.env.ZCODE_ACP_MODE).toBe('build')
  })

  it('opens the native Pi binary rather than the ACP wrapper', async () => {
    installSystemCommands('pi')
    await openLocalAgentTerminal({
      ...config,
      presetId: 'pi-acp',
      executableOverride: '/wrapper/pi-acp'
    })
    expect(inventory.openTerminal).toHaveBeenCalledWith(
      expect.objectContaining({ executable: '/user/bin/pi', args: [] })
    )
  })

  it.each(['system', 'mise'] as const)('runs the bundled Pi adapter with the %s native CLI', async (source) => {
    installSystemCommands('node')
    inventory.snapshots['pi-acp'] = { name: 'pi-acp', availability: { source: 'system', path: '/adapter/pi-acp' } }
    inventory.snapshots.pi = { name: 'pi', availability: { source, path: '/native pi/bin/pi' } }
    const launch = await resolveLocalAgentLaunch({ ...config, presetId: 'pi-acp' })
    expect(launch.executable).toBe('/user/bin/node')
    expect(launch.env.PI_ACP_PI_COMMAND).toBe('/native pi/bin/pi')
    expect(launch.args).toEqual([application.getPath('app.pi_acp.file')])
    expect(launch.env.HOME).toBe('/user/home')
  })

  it.each([false, true])('makes bundled Bun available to omp (terminal=%s)', async (terminal) => {
    installSystemCommands('omp')
    inventory.snapshots.bun = { name: 'bun', availability: { source: 'bundled', path: '/bundled/bin/bun' } }
    const selected = { ...config, presetId: 'omp' } as const
    const launch = terminal ? await resolveLocalAgentCli(selected) : await resolveLocalAgentLaunch(selected)
    expect(launch.env.PATH.split(path.delimiter)).toContain('/bundled/bin')
    expect(launch.env.HOME).toBe('/user/home')
  })

  it.each([
    ['codex', 'codex', ['login']],
    ['auggie', 'auggie', ['auth', 'login']],
    ['command-code', 'command-code', ['login']],
    ['dimagent', 'dim', ['auth', 'login']],
    ['copilot', 'copilot', ['login']],
    ['claude', 'claude', ['auth', 'login']],
    ['kimi', 'kimi', ['login']],
    ['opencode', 'opencode', ['auth', 'login']],
    ['qoder', 'qoderclicn', ['login']],
    ['qoder-global', 'qodercli', ['login']],
    ['trae', 'traecli', ['login']],
    ['qwen', 'qwen', []],
    ['pi-acp', 'pi', ['auth', 'login', 'openai-codex']],
    ['poolside', 'pool', ['login']]
  ] as const)('opens the native %s sign-in with its login arguments', async (presetId, executable, args) => {
    const path = `/user/bin/${executable}`
    inventory.snapshots[executable] = { name: executable, availability: { source: 'system', path } }
    await openLocalAgentTerminal({
      ...config,
      presetId,
      login: presetId === 'pi-acp' ? { provider: 'openai-codex' } : true
    })
    expect(inventory.openTerminal).toHaveBeenCalledWith(expect.objectContaining({ executable: path, args }))
  })

  it('rejects login for a CLI without a terminal login command', async () => {
    await expect(openLocalAgentTerminal({ ...config, presetId: 'kilo', login: true })).rejects.toThrow(
      'supported terminal login'
    )
    expect(inventory.openTerminal).not.toHaveBeenCalled()
  })

  it('does not open unsupported ACP adapters or silently replace a missing explicit program', async () => {
    await expect(openLocalAgentTerminal({ ...config, presetId: 'glm-acp-agent' })).rejects.toThrow(
      'supported interactive CLI'
    )
    installSystemCommands('codex')
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
    installSystemCommands('codex')
    const result = await resolveLocalAgentLaunch({ ...config, env: { CUSTOM: 'value' } })
    expect(result.env).toEqual({ PATH: '/user/bin', MISE_DATA_DIR: '/user/mise', HOME: '/user/home', CUSTOM: 'value' })
    expect(result.args).toEqual(['app-server'])
  })

  it('provides bundled Git as a last fallback without injecting managed state into system CLIs', async () => {
    inventory.bundledGitDir = 'C:\\Cherry\\MinGit\\cmd'
    installSystemCommands('codex')
    const result = await resolveLocalAgentLaunch(config)
    expect(result.env.PATH.split(';')).toEqual(['/user/bin', inventory.bundledGitDir])
    expect(result.env.MISE_DATA_DIR).toBe('/user/mise')
    expect(result.env.HOME).toBe('/user/home')
    expect((await resolveLocalAgentLaunch({ ...config, env: { PATH: '/explicit/bin' } })).env.PATH).toBe(
      '/explicit/bin'
    )
  })

  it('injects MinGit usr/bin/sh.exe into KIMI_SHELL_PATH on Windows when bash.exe is unavailable', async () => {
    inventory.isWin = true
    installSystemCommands('kimi')
    const commandResolver = await import('@main/utils/commandResolver')
    const discoverSpy = vi.spyOn(commandResolver, 'autoDiscoverGitBash').mockReturnValue(null)
    const findGitSpy = vi.spyOn(commandResolver, 'findExecutableInEnv').mockResolvedValue(null)
    try {
      const minGitRoot = path.join(directory, 'MinGit')
      const minGitCmd = path.join(minGitRoot, 'cmd')
      const minGitSh = path.join(minGitRoot, 'usr', 'bin', 'sh.exe')
      await mkdir(minGitCmd, { recursive: true })
      await mkdir(path.dirname(minGitSh), { recursive: true })
      await writeFile(minGitSh, '')
      inventory.bundledGitDir = minGitCmd

      const kimiConfig: LocalAgentConfiguration = {
        presetId: 'kimi',
        enabled: true,
        args: [],
        env: {}
      }
      const launch = await resolveLocalAgentLaunch(kimiConfig)
      expect(launch.env.KIMI_SHELL_PATH).toBe(minGitSh)

      const explicit = await resolveLocalAgentLaunch({
        ...kimiConfig,
        env: { KIMI_SHELL_PATH: 'C:\\Custom\\bash.exe' }
      })
      expect(explicit.env.KIMI_SHELL_PATH).toBe('C:\\Custom\\bash.exe')
    } finally {
      discoverSpy.mockRestore()
      findGitSpy.mockRestore()
    }
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

  it('resolves a custom command in its configured PATH before launching it', async () => {
    const executable = path.join(directory, `audit-custom${process.platform === 'win32' ? '.cmd' : ''}`)
    await writeFile(executable, '#!/bin/sh\n')
    await chmod(executable, 0o755)
    const launch = await resolveLocalAgentLaunch({
      enabled: false,
      args: [],
      executableOverride: 'audit-custom',
      env: { PATH: directory }
    })
    expect(launch.executable).toBe(executable)
    expect(launch.env.PATH).toBe(directory)
  })

  it.each([
    ['copilot', 'copilot', ['--acp']],
    ['deepseek-harness', 'dsh', ['--profile', 'acp']],
    ['antigravity-acp', 'agy', ['acp']],
    ['factory-droid', 'droid', ['exec', '--output-format', 'acp-daemon']]
  ] as const)('launches %s with its native ACP invocation', async (presetId, executable, args) => {
    const executablePath = `/user/bin/${executable}`
    inventory.snapshots[executable] = {
      name: executable,
      availability: { source: 'system', path: executablePath }
    }
    const launch = await resolveLocalAgentLaunch({ ...config, presetId })
    expect(launch).toMatchObject({ executable: executablePath, args })
  })

  it('excludes SDK-only Cursor from discovery and rejects direct CLI launches', async () => {
    expect((await detectLocalAgents()).some((agent) => agent.presetId === 'cursor')).toBe(false)
    await expect(resolveLocalAgentCli({ ...config, presetId: 'cursor' })).rejects.toThrow('Invalid local agent preset')
    await expect(
      resolveLocalAgentLaunch({ ...config, presetId: 'cursor', executableOverride: process.execPath })
    ).rejects.toThrow('Invalid local agent preset')
  })

  it('applies required protocol environment without overriding explicit user choices', async () => {
    installSystemCommands('droid')
    const launch = await resolveLocalAgentLaunch({
      ...config,
      presetId: 'factory-droid',
      env: { DROID_DISABLE_AUTO_UPDATE: 'false' }
    })
    expect(launch.env.FACTORY_DROID_AUTO_UPDATE_ENABLED).toBe('false')
    expect(launch.env.DROID_DISABLE_AUTO_UPDATE).toBe('false')
  })

  it('does not mistake the base CLI for a separately installed ACP adapter', async () => {
    installSystemCommands('pi')
    await expect(resolveLocalAgentLaunch({ ...config, presetId: 'glm-acp-agent' })).rejects.toMatchObject({
      code: 'LOCAL_AGENT_NOT_INSTALLED'
    })
  })

  it('keeps each Qoder preset on its own CLI even when the other edition is on PATH', async () => {
    inventory.snapshots.qoderclicn = {
      name: 'qoderclicn',
      availability: { source: 'mise', path: '/managed/qoderclicn' }
    }
    inventory.snapshots.qodercli = { name: 'qodercli', availability: { source: 'system', path: '/system/qodercli' } }
    const found = await detectLocalAgents()
    expect(found.find((entry) => entry.presetId === 'qoder')).toMatchObject({
      source: 'mise',
      path: '/managed/qoderclicn'
    })
    expect(found.find((entry) => entry.presetId === 'qoder-global')).toMatchObject({
      source: 'system',
      path: '/system/qodercli'
    })
    expect((await resolveLocalAgentLaunch({ ...config, presetId: 'qoder' })).executable).toBe('/managed/qoderclicn')
    expect((await resolveLocalAgentLaunch({ ...config, presetId: 'qoder-global' })).executable).toBe('/system/qodercli')
  })

  it('detects the official Antigravity CLI for both ACP and the terminal', async () => {
    installSystemCommands('agy_acp_server.par')
    const findAntigravity = async () =>
      (await detectLocalAgents()).find((entry) => entry.presetId === 'antigravity-acp')
    expect(await findAntigravity()).toMatchObject({ source: 'none' })
    installSystemCommands('agy')
    expect(await findAntigravity()).toMatchObject({
      path: '/user/bin/agy',
      terminalPath: '/user/bin/agy'
    })
  })

  it('injects Cherry-managed gateway env vars for GLM Agent, CodeBuddy, Cline, and Snow while respecting overrides', async () => {
    installSystemCommands('glm-acp-agent', 'codebuddy', 'cline', 'snow')

    inventory.readConfigFiles.mockResolvedValueOnce([
      {
        target: 'glm-credentials',
        content: JSON.stringify({
          z_ai_api_key: 'glm-key',
          base_url: 'http://127.0.0.1:23334/v1',
          model: 'cherryin:agent/glm-5',
          cherry_managed: true
        })
      }
    ])
    const glmLaunch = await resolveLocalAgentLaunch({ ...config, presetId: 'glm-acp-agent' })
    expect(glmLaunch.nativeModel).toBe('cherryin:agent/glm-5')
    expect(glmLaunch.env).toMatchObject({
      Z_AI_API_KEY: 'glm-key',
      ACP_GLM_BASE_URL: 'http://127.0.0.1:23334/v1',
      ACP_GLM_MODEL: 'cherryin:agent/glm-5',
      ACP_GLM_AVAILABLE_MODELS: 'cherryin:agent/glm-5'
    })

    inventory.readConfigFiles.mockResolvedValueOnce([
      { target: 'codebuddy-settings', content: JSON.stringify({ model: 'cherryin:agent/deepseek-v4-pro' }) },
      {
        target: 'codebuddy-models',
        content: JSON.stringify({
          models: [{ id: 'cherryin:agent/deepseek-v4-pro', apiKey: 'cb-key', 'x-cherry-studio': true }]
        })
      }
    ])
    const cbLaunch = await resolveLocalAgentLaunch({
      ...config,
      presetId: 'codebuddy-code',
      env: {}
    })
    expect(cbLaunch.nativeModel).toBe('cherryin:agent/deepseek-v4-pro')
    expect(cbLaunch.env.CODEBUDDY_API_KEY).toBe('cb-key')

    inventory.readConfigFiles.mockResolvedValueOnce([
      {
        target: 'cline-providers',
        content: JSON.stringify({
          providers: {
            'openai-compatible': {
              cherryManaged: true,
              settings: {
                provider: 'openai-compatible',
                apiKey: 'cline-key',
                baseUrl: 'http://127.0.0.1:23334/v1',
                model: 'cherryin:agent/deepseek-v4-pro'
              }
            }
          }
        })
      }
    ])
    const clineLaunch = await resolveLocalAgentLaunch({
      ...config,
      presetId: 'cline',
      env: { CLINE_API_KEY: 'explicit-override' }
    })
    expect(clineLaunch.nativeModel).toBe('cherryin:agent/deepseek-v4-pro')
    expect(clineLaunch.env).toMatchObject({
      CLINE_API_KEY: 'explicit-override',
      CLINE_PROVIDER: 'openai-compatible',
      CLINE_MODEL: 'cherryin:agent/deepseek-v4-pro',
      OPENAI_BASE_URL: 'http://127.0.0.1:23334/v1'
    })

    inventory.readConfigFiles.mockResolvedValueOnce([
      {
        target: 'snow-config',
        content: JSON.stringify({
          cherryManaged: true,
          snowcfg: { advancedModel: 'cherryin:agent/deepseek-v4-pro' }
        })
      }
    ])
    const snowLaunch = await resolveLocalAgentLaunch({ ...config, presetId: 'snow' })
    expect(snowLaunch.nativeModel).toBe('cherryin:agent/deepseek-v4-pro')

    installSystemCommands('goose')
    inventory.readConfigFiles.mockResolvedValueOnce([
      {
        target: 'goose-config',
        content: [
          'CHERRY_MANAGED: true',
          'GOOSE_PROVIDER: anthropic',
          'GOOSE_MODEL: cherryin:agent/glm-5',
          'ANTHROPIC_HOST: http://127.0.0.1:23334',
          'ANTHROPIC_API_KEY: goose-anth-key'
        ].join('\n')
      }
    ])
    const gooseAnthropicLaunch = await resolveLocalAgentLaunch({ ...config, presetId: 'goose' })
    expect(gooseAnthropicLaunch.nativeModel).toBe('cherryin:agent/glm-5')
    expect(gooseAnthropicLaunch.env).toMatchObject({
      GOOSE_PROVIDER: 'anthropic',
      GOOSE_MODEL: 'cherryin:agent/glm-5',
      ANTHROPIC_HOST: 'http://127.0.0.1:23334',
      ANTHROPIC_API_KEY: 'goose-anth-key'
    })

    inventory.readConfigFiles.mockResolvedValueOnce([
      {
        target: 'goose-config',
        content: [
          'CHERRY_MANAGED: true',
          'GOOSE_PROVIDER: openai',
          'GOOSE_MODEL: cherryin:agent/deepseek-v4-pro',
          'OPENAI_HOST: http://127.0.0.1:23334/v1',
          'OPENAI_API_KEY: goose-oai-key'
        ].join('\n')
      }
    ])
    const gooseOpenAiLaunch = await resolveLocalAgentLaunch({ ...config, presetId: 'goose' })
    expect(gooseOpenAiLaunch.nativeModel).toBe('cherryin:agent/deepseek-v4-pro')
    expect(gooseOpenAiLaunch.env).toMatchObject({
      GOOSE_PROVIDER: 'openai',
      GOOSE_MODEL: 'cherryin:agent/deepseek-v4-pro',
      OPENAI_HOST: 'http://127.0.0.1:23334/v1',
      OPENAI_API_KEY: 'goose-oai-key'
    })

    inventory.readConfigFiles.mockResolvedValueOnce([
      {
        target: 'goose-config',
        content: 'GOOSE_PROVIDER: anthropic\nGOOSE_MODEL: user-model\nANTHROPIC_API_KEY: user-key\n'
      }
    ])
    const gooseUnmanagedLaunch = await resolveLocalAgentLaunch({
      ...config,
      presetId: 'goose',
      env: {}
    })
    expect(gooseUnmanagedLaunch.nativeModel).toBeUndefined()
    expect(gooseUnmanagedLaunch.env.ANTHROPIC_API_KEY).toBeUndefined()
  })

  it('requires ZCode host (zcode CLI, desktop bundle, or ZCODE_BIN) when launching zcode-acp', async () => {
    installSystemCommands('zcode-acp')
    await expect(resolveLocalAgentLaunch({ ...config, presetId: 'zcode' })).rejects.toMatchObject({
      code: 'LOCAL_AGENT_HOST_REQUIRED'
    })

    // ZCODE_BIN pointing to a real file unblocks launch even without PATH zcode
    const customBin = path.join(directory, 'custom-zcode.cjs')
    await writeFile(customBin, '#!/usr/bin/env node\n')
    const viaEnv = await resolveLocalAgentLaunch({
      ...config,
      presetId: 'zcode',
      env: { ZCODE_BIN: customBin }
    })
    expect(viaEnv.env.ZCODE_BIN).toBe(customBin)

    // Non-existent ZCODE_BIN still fails instead of letting zcode-acp crash later
    await expect(
      resolveLocalAgentLaunch({
        ...config,
        presetId: 'zcode',
        env: { ZCODE_BIN: path.join(directory, 'missing-zcode.cjs') }
      })
    ).rejects.toMatchObject({
      code: 'LOCAL_AGENT_HOST_REQUIRED'
    })

    if (process.platform !== 'win32') {
      // POSIX bundled desktop zcode.cjs under ~/Applications/ZCode.app
      inventory.isWin = false
      const macBundle = path.join(
        directory,
        'sys.home',
        'Applications',
        'ZCode.app',
        'Contents',
        'Resources',
        'glm',
        'zcode.cjs'
      )
      await mkdir(path.dirname(macBundle), { recursive: true })
      await writeFile(macBundle, '// zcode\n')
      const viaMacBundle = await resolveLocalAgentLaunch({ ...config, presetId: 'zcode' })
      expect(viaMacBundle.executable).toBe('/user/bin/zcode-acp')
      expect(viaMacBundle.env.ZCODE_BIN).toBe(macBundle)
    }

    // Windows bundled desktop zcode.cjs under LOCALAPPDATA/Programs/ZCode
    inventory.isWin = true
    const winBundle = path.join(directory, 'localappdata', 'Programs', 'ZCode', 'resources', 'glm', 'zcode.cjs')
    await mkdir(path.dirname(winBundle), { recursive: true })
    await writeFile(winBundle, '// zcode\n')
    const viaWinBundle = await resolveLocalAgentLaunch({
      ...config,
      presetId: 'zcode',
      env: { LOCALAPPDATA: path.join(directory, 'localappdata') }
    })
    expect(viaWinBundle.executable).toBe('/user/bin/zcode-acp')
  })

  it('opens Amp login with only the native CLI installed', async () => {
    installSystemCommands('amp')
    const selected = { ...config, presetId: 'amp-acp' } as const
    await openLocalAgentTerminal({ ...selected, login: true })
    expect(inventory.openTerminal).toHaveBeenCalledWith(
      expect.objectContaining({ executable: '/user/bin/amp', args: ['login'] })
    )
    await expect(resolveLocalAgentLaunch(selected)).rejects.toMatchObject({ code: 'LOCAL_AGENT_NOT_INSTALLED' })
  })

  it('reads Amp subscription usage without requiring the chat adapter', async () => {
    installSystemCommands('amp')
    vi.mocked(spawnLocalAgentStdio).mockImplementationOnce(({ executable, args, env }) => {
      const stdout = new PassThrough()
      const ok = executable === '/user/bin/amp' && args.length === 1 && args[0] === 'usage' && env.HOME === '/user/home'
      const closed: StdioProcess['closed'] = new Promise((resolve) => {
        stdout.once('end', () => resolve({ kind: 'exited', code: ok ? 0 : 1, signal: null }))
      })
      stdout.end(ok ? 'Free tier: $3/$10 remaining\n' : '')
      return {
        stdin: new PassThrough(),
        stdout,
        stderr: new PassThrough().end(),
        closed,
        closeAndJoin: async () => {}
      }
    })
    const account = bindAccount({ ...config, presetId: 'amp-acp' })
    await expect(account.readSubscriptionUsage?.(new AbortController().signal)).resolves.toMatchObject({
      status: 'available',
      windows: [{ label: 'Free tier', usedRatio: 0.7 }]
    })
  })

  it('requires amp CLI when launching amp-acp bridge without an executable override', async () => {
    installSystemCommands('amp-acp')
    expect((await detectLocalAgents()).find((detection) => detection.presetId === 'amp-acp')).toMatchObject({
      path: '/user/bin/amp-acp',
      missingChatExecutable: 'amp'
    })
    await expect(resolveLocalAgentLaunch({ ...config, presetId: 'amp-acp' })).rejects.toMatchObject({
      code: 'LOCAL_AGENT_HOST_REQUIRED'
    })

    installSystemCommands('amp')
    const launched = await resolveLocalAgentLaunch({ ...config, presetId: 'amp-acp' })
    expect(launched.executable).toBe('/user/bin/amp-acp')
  })
})
