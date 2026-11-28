import '@data/services/AgentGlobalSkillService'
import fs from 'node:fs'
import { chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { setupTestDatabase } from '@test-helpers/db'
import { MockApplicationUtils } from '@test-mocks/main/application'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import { agentService } from '@data/services/AgentService'
import { agentSessionService } from '@data/services/AgentSessionService'
import { resolveAcpLaunch } from '@main/ai/runtime/acp/acpLaunch'
import { resolveRequiredRuntime } from '@main/ai/runtime/cli/runtimeDependency'
import { resolveCodexLaunch } from '@main/ai/runtime/codex/codexLaunch'
import { BaseService } from '@main/core/lifecycle'
import type { LocalAgentConfiguration, LocalAgentRuntime } from '@shared/ai/localAgent'

import { detectLocalAgents } from '../localAgentCli'
import { LocalAgentInstallService } from '../LocalAgentInstallService'

vi.mock('@main/ai/runtime/cli/runtimeDependency', () => ({ resolveRequiredRuntime: vi.fn() }))

const state = vi.hoisted(() => ({
  runtimeAvailable: true,
  root: '',
  name: 'kilo',
  manager: '',
  target: '',
  existing: '',
  managed: {} as Record<string, string>,
  exit: '0',
  busy: false,
  openSessions: [] as string[],
  liveSessions: {} as Record<string, LocalAgentRuntime>,
  removeBlocked: false,
  china: false,
  registry: 'https://registry.npmjs.org/',
  env: {} as Record<string, string>
}))
vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  const fs = await import('node:fs')
  return mockApplicationFactory({
    BinaryManager: {
      removeTool: async ({ name }: { name: string }) => {
        if (name !== 'kilo' || state.removeBlocked) return { status: 'cleanup_blocked', reason: 'conflict' }
        fs.unlinkSync(state.existing)
        state.existing = ''
        return { status: 'removed' }
      },
      getToolSnapshots: async (names: string[]) =>
        Object.fromEntries(
          names.map((name) => [
            name,
            {
              name,
              availability:
                name === 'bun' && state.runtimeAvailable
                  ? { source: 'system', path: '/user/bin/bun' }
                  : fs.existsSync(path.join(state.root, name))
                    ? { source: 'system', path: path.join(state.root, name) }
                    : state.managed[name] || (name === state.name && state.existing)
                      ? { source: 'mise', path: state.managed[name] || state.existing }
                      : { source: 'none' }
            }
          ])
        )
    },
    AgentSessionRuntimeService: {
      getConnectedLocalRuntime: (sessionId: string) => state.liveSessions[sessionId],
      closeIdleSessions: async (sessionIds: readonly string[]) => {
        if (state.busy) return false
        state.openSessions = state.openSessions.filter((id) => !sessionIds.includes(id))
        return true
      }
    },
    ...{
      ClaudeCodeBinaryService: { getInstalledExecutable: () => undefined },
      LocalAgentWebUiService: { stop: async () => {} },
      CodeBuddyWebUiService: { stop: async () => {} },
      HermesDashboardService: { stop: async () => {} },
      DeepSeekHarnessService: { stop: async () => {} }
    },
    IpcApiService: { broadcast: () => {} }
  })
})
vi.mock('@main/services/RegionService', () => ({ regionService: { isInChina: async () => state.china } }))
vi.mock('@main/utils/shellEnv', () => ({
  refreshShellEnv: async () => ({}),
  getRawShellEnv: async () => ({
    PATH: process.env.PATH!,
    INSTALL_ROOT: state.root,
    INSTALL_NAME: state.name,
    INSTALL_TARGET: state.target,
    INSTALL_EXIT: state.exit,
    INSTALL_REGISTRY: state.registry,
    ...state.env
  })
}))
vi.mock('@main/utils/commandResolver', () => ({
  findExecutableInEnv: async (name: string) =>
    name === 'bun'
      ? state.runtimeAvailable || fs.existsSync(path.join(state.root, 'bun'))
        ? '/user/bin/bun'
        : null
      : name === 'amp'
        ? fs.existsSync(path.join(state.root, 'amp'))
          ? path.join(state.root, 'amp')
          : null
        : state.manager || null
}))

describe('local agent system installation', () => {
  setupTestDatabase()

  beforeEach(async () => {
    BaseService.resetInstances()
    state.runtimeAvailable = true
    state.name = 'kilo'
    state.root = await mkdtemp(path.join(os.tmpdir(), 'agent system install '))
    state.manager = path.join(state.root, 'npm')
    state.target = state.root
    state.existing = ''
    state.managed = {}
    state.exit = '0'
    state.busy = false
    state.openSessions = []
    state.liveSessions = {}
    state.removeBlocked = false
    state.china = false
    state.registry = 'https://registry.npmjs.org/'
    state.env = {}
    vi.mocked(resolveRequiredRuntime).mockImplementation(async () =>
      state.runtimeAvailable
        ? { source: 'system', path: '/user/bin/bun' }
        : fs.existsSync(path.join(state.root, 'bun'))
          ? { source: 'system', path: path.join(state.root, 'bun') }
          : state.managed.bun
            ? { source: 'mise', path: state.managed.bun }
            : undefined
    )
    vi.mocked(application.getPath).mockImplementation((key, filename) =>
      path.join(key === 'sys.home' ? state.root : path.join(state.root, key), ...(filename ? [filename] : []))
    )
    await writeFile(
      state.manager,
      `#!/usr/bin/env node
const fs = require('fs'); const root = process.env.INSTALL_ROOT;
if (process.argv[2] === 'tool' && process.argv[3] === 'dir') { process.stdout.write(process.env.INSTALL_TARGET); }
else if (process.argv[2] === 'config') { process.stdout.write(process.env.INSTALL_REGISTRY); }
else if (process.argv[2] === 'root' || process.argv[2] === 'prefix') { process.stdout.write(process.env.INSTALL_TARGET); }
else {
fs.appendFileSync(root + '/sources', (process.env.NPM_CONFIG_REGISTRY || process.env.UV_DEFAULT_INDEX || 'original') + '\\n');
if (process.env.FAIL_MIRROR && (process.env.NPM_CONFIG_REGISTRY || process.env.UV_DEFAULT_INDEX)) process.exit(1);
fs.appendFileSync(root + '/calls', JSON.stringify(process.argv.slice(2)) + '\\n');
if (process.argv[2] === 'uninstall') { const pkg = process.argv[4]; if (process.env.KEEP_PACKAGE !== pkg) { const meta = JSON.parse(fs.readFileSync(process.env.INSTALL_TARGET + '/' + pkg + '/package.json')); for (const name of Object.keys(meta.bin)) fs.unlinkSync(root + '/' + name); if (process.env.KEEP_PACKAGE_FILES !== pkg) fs.rmSync(process.env.INSTALL_TARGET + '/' + pkg, {recursive:true}); } }
else if (process.argv[2] === 'tool' && process.argv[3] === 'uninstall') { fs.unlinkSync(root + '/' + process.env.INSTALL_NAME); fs.rmSync(process.env.INSTALL_TARGET + '/' + process.argv[4], {recursive:true}); }
else if (process.env.INSTALL_EXIT === '0') {
const dependencies = {'bun':'bun','@ampcode/cli':'amp','@earendil-works/pi-coding-agent':'pi'};
const dependency = process.argv.find(arg => dependencies[arg]);
const native = dependency ? dependencies[dependency] : process.argv.some(arg => arg.includes('https://antigravity.google/cli/install')) ? 'agy' : undefined;
if (!native || !process.env.SKIP_NATIVE) fs.writeFileSync(root + '/' + (native || process.env.INSTALL_NAME), 'installed');
for (const name of ['@langchain/anthropic', '@langchain/openai']) if (process.argv.includes(name)) {
const directory = root + '/node_modules/' + name; fs.mkdirSync(directory, {recursive:true}); fs.writeFileSync(directory + '/package.json', '{}'); fs.writeFileSync(directory + '/index.js', 'module.exports = {}');
}
}
else process.stderr.write('installation failed');
process.exit(Number(process.env.INSTALL_EXIT)); }
`
    )
    await chmod(state.manager, 0o755)
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          agents: [
            { id: 'kilo', distribution: { npx: { package: '@kilocode/cli@7.8.1' } } },
            { id: 'pi-acp', distribution: { npx: { package: 'pi-acp@0.0.34' } } },
            { id: 'amp-acp', distribution: { npx: { package: 'amp-acp' } } }
          ]
        })
      }))
    )
  })
  afterEach(async () => {
    MockApplicationUtils.resetServices()
    vi.unstubAllGlobals()
    await rm(state.root, { recursive: true, force: true })
  })

  function createLocalSession(agentId: string, presetId: string) {
    agentService.createAgentWithId(agentId, {
      name: agentId,
      type: 'local',
      model: null,
      localRuntime: { presetId, enabled: true, args: [], env: {} }
    })
    return agentSessionService.create({ agentId, name: agentId, workspace: { type: 'system' } }).id
  }

  async function installCalls(): Promise<string[][]> {
    const log = await readFile(path.join(state.root, 'calls'), 'utf8')
    return log
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line))
  }

  it('installs the required system Bun before omp', async () => {
    state.name = 'omp'
    state.runtimeAvailable = false
    expect(await new LocalAgentInstallService().install('omp')).toMatchObject({ ok: true })
    expect(await installCalls()).toEqual([
      ['install', '--global', 'bun'],
      ['install', '--global', '@oh-my-pi/pi-coding-agent']
    ])
  })

  it('requires a system package manager to install a missing runtime', async () => {
    state.name = 'omp'
    state.runtimeAvailable = false
    state.manager = ''
    expect(await new LocalAgentInstallService().install('omp')).toMatchObject({
      ok: false,
      reason: 'missing_runtime',
      manager: 'npm'
    })
    expect(fs.existsSync(path.join(state.root, 'calls'))).toBe(false)
  })

  it('reuses managed Bun without installing another system copy for omp', async () => {
    state.name = 'omp'
    state.runtimeAvailable = false
    state.managed.bun = '/managed/bun'
    expect(await new LocalAgentInstallService().install('omp')).toMatchObject({ ok: true })
    expect(await installCalls()).toEqual([['install', '--global', '@oh-my-pi/pi-coding-agent']])
  })

  it('installs the missing native CLI when reusing an Amp adapter', async () => {
    state.name = 'amp-acp'
    await writeFile(path.join(state.root, state.name), 'adapter')
    expect(await new LocalAgentInstallService().install('amp-acp')).toMatchObject({ ok: true, reused: true })
    expect(await installCalls()).toEqual([['install', '--global', '@ampcode/cli']])
    expect(fs.existsSync(path.join(state.root, 'amp'))).toBe(true)
  })

  it('installs only native Pi because the adapter ships with Cherry', async () => {
    state.name = 'pi-acp'
    expect(await new LocalAgentInstallService().install('pi-acp')).toMatchObject({ ok: true, reused: false })
    expect(await installCalls()).toEqual([['install', '--global', '@earendil-works/pi-coding-agent']])
    expect(fs.existsSync(path.join(state.root, 'pi'))).toBe(true)
    expect(fs.existsSync(path.join(state.root, 'pi-acp'))).toBe(false)
  })

  it('installs the official Antigravity CLI and uses it for ACP even if the old adapter exists', async () => {
    await writeFile(path.join(state.root, 'agy_acp_server.par'), 'adapter')
    const cli = path.join(state.root, 'agy')
    const config: LocalAgentConfiguration = {
      presetId: 'antigravity-acp',
      enabled: true,
      args: [],
      env: {}
    }

    expect(await new LocalAgentInstallService().install('antigravity-acp')).toMatchObject({
      ok: true,
      reused: false,
      path: cli
    })
    expect((await detectLocalAgents()).find(({ presetId }) => presetId === 'antigravity-acp')?.path).toBe(cli)
    expect(await resolveAcpLaunch(config)).toMatchObject({
      installation: { componentId: 'agy', path: cli },
      executable: cli,
      args: ['acp']
    })
    expect(await readFile(path.join(state.root, 'calls'), 'utf8')).toContain(
      process.platform === 'win32'
        ? 'https://antigravity.google/cli/install.ps1'
        : 'https://antigravity.google/cli/install.sh'
    )
  })

  it.each(['system', 'mise'])('reuses the %s native Pi without reinstalling it', async (source) => {
    state.name = 'pi-acp'
    await writeFile(path.join(state.root, state.name), 'adapter')
    if (source === 'system') await writeFile(path.join(state.root, 'pi'), 'native')
    else state.managed.pi = '/managed/pi'
    expect(await new LocalAgentInstallService().install('pi-acp')).toMatchObject({ ok: true, reused: true })
    expect(fs.existsSync(path.join(state.root, 'calls'))).toBe(false)
  })

  it('does not report installation success when the Pi installer omits its executable', async () => {
    state.name = 'pi-acp'
    state.env = { SKIP_NATIVE: '1' }
    await writeFile(path.join(state.root, state.name), 'adapter')
    expect(await new LocalAgentInstallService().install('pi-acp')).toMatchObject({ ok: false, reason: 'not_detected' })
    expect(fs.existsSync(path.join(state.root, 'pi'))).toBe(false)
  })

  it('reports a failed system repair when only the old managed Pi remains after installation', async () => {
    state.name = 'pi-acp'
    state.env = { SKIP_NATIVE: '1' }
    state.managed.pi = '/managed/pi'
    expect(await new LocalAgentInstallService().install('pi-acp', undefined, true)).toMatchObject({
      ok: false,
      reason: 'not_detected'
    })
  })

  it('does not install the Pi adapter after its native CLI installation fails', async () => {
    state.name = 'pi-acp'
    state.exit = '1'
    expect(await new LocalAgentInstallService().install('pi-acp')).toMatchObject({ ok: false, reason: 'failed' })
    expect(fs.existsSync(path.join(state.root, 'pi-acp'))).toBe(false)
    expect(await installCalls()).toHaveLength(1)
  })

  it('repairs missing DeepAgents model providers without reinstalling the adapter', async () => {
    state.name = 'deepagents-acp'
    await writeFile(path.join(state.root, state.name), 'adapter')
    const service = new LocalAgentInstallService()
    expect(await service.install('deepagents')).toMatchObject({ ok: true, reused: true })
    expect(await readFile(path.join(state.root, 'calls'), 'utf8')).toBe(
      '["install","--global","@langchain/anthropic","@langchain/openai"]\n'
    )
    expect(await service.install('deepagents')).toMatchObject({ ok: true, reused: true })
    expect(await installCalls()).toHaveLength(1)
  })

  it.each([
    ['omp', '@oh-my-pi/pi-coding-agent'],
    ['snow', 'snow-ai'],
    ['zcode', 'zcode-acp-server'],
    ['minimax', '@minimax-ai/code']
  ])('installs %s even when the ACP registry is unavailable', async (id, packageName) => {
    state.name = id === 'zcode' ? 'zcode-acp' : id === 'minimax' ? 'mcode' : id
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Registry unavailable')))
    expect(await new LocalAgentInstallService().install(id)).toMatchObject({ ok: true, reused: false })
    expect(await installCalls()).toEqual([['install', '--global', packageName]])
  })

  it('uses a China mirror only for the install and falls back without changing system configuration', async () => {
    state.china = true
    state.env = { FAIL_MIRROR: '1' }
    expect(await new LocalAgentInstallService().install('kilo')).toMatchObject({ ok: true })
    expect(await readFile(path.join(state.root, 'sources'), 'utf8')).toBe('https://registry.npmmirror.com\noriginal\n')
  })

  it('preserves the npm registry from the user configuration', async () => {
    state.china = true
    state.registry = 'https://packages.example.com/'
    expect(await new LocalAgentInstallService().install('kilo')).toMatchObject({ ok: true })
    expect(await readFile(path.join(state.root, 'sources'), 'utf8')).toBe('original\n')
  })

  it('leaves installations outside China on the original source', async () => {
    expect(await new LocalAgentInstallService().install('kilo')).toMatchObject({ ok: true })
    expect(await readFile(path.join(state.root, 'sources'), 'utf8')).toBe('original\n')
  })

  it('falls back through Python mirrors to the original index', async () => {
    state.china = true
    state.name = 'vibe-acp'
    state.env = { FAIL_MIRROR: '1' }
    expect(await new LocalAgentInstallService().install('mistral-vibe')).toMatchObject({ ok: true })
    expect((await readFile(path.join(state.root, 'sources'), 'utf8')).trim().split('\n')).toEqual([
      'https://pypi.tuna.tsinghua.edu.cn/simple',
      'https://mirrors.cloud.tencent.com/pypi/simple',
      'original'
    ])
  })

  it.each(['agent', 'cli'])('installs Hermes through the official script from the %s entry', async (entry) => {
    state.name = 'hermes'
    const service = new LocalAgentInstallService()
    const result = entry === 'agent' ? await service.install('hermes') : await service.installCli({ name: 'hermes' })
    expect(result).toEqual({ ok: true, reused: false, path: path.join(state.root, 'hermes') })
    const calls = await readFile(path.join(state.root, 'calls'), 'utf8')
    expect(calls).toContain('https://hermes-agent.nousresearch.com/install.')
    expect(calls).toContain(process.platform === 'win32' ? '-NonInteractive' : '--non-interactive')
    expect(calls.trim().split('\n')).toHaveLength(1)
    expect(calls).not.toContain('hermes-agent[web]')
  })

  it('reuses an installed Hermes CLI without running the bootstrap or changing its configuration', async () => {
    state.name = 'hermes'
    state.manager = ''
    const executable = path.join(state.root, 'hermes')
    await writeFile(executable, 'existing source launcher')
    expect(await new LocalAgentInstallService().install('hermes')).toEqual({ ok: true, reused: true, path: executable })
    expect(await readFile(executable, 'utf8')).toBe('existing source launcher')
    expect(fs.existsSync(path.join(state.root, 'calls'))).toBe(false)
  })

  it('reports Hermes bootstrap failures without claiming installation succeeded', async () => {
    state.name = 'hermes'
    state.exit = '1'
    expect(await new LocalAgentInstallService().install('hermes')).toMatchObject({ ok: false, reason: 'failed' })
    expect(fs.existsSync(path.join(state.root, 'hermes'))).toBe(false)
  })

  it('rejects Hermes package-version upgrades before invoking an installer', async () => {
    expect(await new LocalAgentInstallService().install('hermes', '0.19.0')).toEqual({
      ok: false,
      reason: 'unsupported'
    })
    expect(fs.existsSync(path.join(state.root, 'calls'))).toBe(false)
  })

  it.each(['env', 'file'])('preserves uv %s configuration', async (source) => {
    state.china = true
    state.name = 'vibe-acp'
    if (source === 'env') state.env = { UV_DEFAULT_INDEX: 'https://packages.example.com/simple' }
    else
      await writeFile(
        application.getPath('external.uv.user_config_file'),
        'index-url = "https://packages.example.com/simple"'
      )
    expect(await new LocalAgentInstallService().install('mistral-vibe')).toMatchObject({ ok: true })
    expect(await readFile(path.join(state.root, 'sources'), 'utf8')).toBe(
      source === 'env' ? 'https://packages.example.com/simple\n' : 'original\n'
    )
  })

  it('reads a system package version without launching the agent and finds a newer release', async () => {
    const directory = path.join(state.root, '@kilocode', 'cli')
    await mkdir(directory, { recursive: true })
    await writeFile(
      path.join(directory, 'package.json'),
      JSON.stringify({ name: '@kilocode/cli', version: '7.7.0', bin: { kilo: 'cli.js' } })
    )
    await writeFile(path.join(directory, 'cli.js'), 'throw new Error("must not execute")')
    await symlink(path.join(directory, 'cli.js'), path.join(state.root, 'kilo'))
    const service = new LocalAgentInstallService()
    expect(await service.getVersion('kilo', false)).toEqual({ current: '7.7.0', canUpgrade: false })
    vi.mocked(fetch).mockImplementation(
      async (url) =>
        ({
          ok: true,
          json: async () =>
            String(url).includes('registry.npmjs.org')
              ? { version: '7.8.1' }
              : {
                  agents: [{ id: 'kilo', distribution: { npx: { package: '@kilocode/cli@7.8.1' } } }]
                }
        }) as Response
    )
    expect(await service.getVersion('kilo', true)).toEqual({ current: '7.7.0', latest: '7.8.1', canUpgrade: true })
    vi.mocked(fetch).mockRejectedValue(new Error('offline'))
    expect(await service.getVersion('kilo', true)).toEqual({ current: '7.7.0', canUpgrade: false })
  })

  it('finds an update for incompatible Copilot without upgrading through a different npm prefix', async () => {
    const directory = path.join(state.root, '@github', 'copilot')
    const executable = path.join(state.root, 'copilot')
    await mkdir(directory, { recursive: true })
    await writeFile(
      path.join(directory, 'package.json'),
      JSON.stringify({ name: '@github/copilot', version: '0.0.348', bin: { copilot: 'index.js' } })
    )
    await writeFile(path.join(directory, 'index.js'), 'throw new Error("must not execute")')
    await symlink(path.join(directory, 'index.js'), executable)
    vi.mocked(fetch).mockImplementation(
      async (url) =>
        ({
          ok: true,
          json: async () =>
            String(url).includes('registry.npmjs.org')
              ? { version: '1.0.116' }
              : { agents: [{ id: 'github-copilot-cli', distribution: { npx: { package: '@github/copilot' } } }] }
        }) as Response
    )
    const service = new LocalAgentInstallService()
    expect((await detectLocalAgents()).find(({ presetId }) => presetId === 'copilot')).toMatchObject({
      source: 'none',
      path: undefined,
      incompatiblePath: executable,
      version: '0.0.348'
    })
    expect(await service.getVersion('copilot', true)).toEqual({
      current: '0.0.348',
      latest: '1.0.116',
      canUpgrade: true
    })
    state.target = path.join(state.root, 'other-npm-root')
    expect(await service.getVersion('copilot', true)).toEqual({
      current: '0.0.348',
      latest: '1.0.116',
      canUpgrade: false
    })
    expect(await service.install('copilot', '1.0.116')).toEqual({ ok: false, reason: 'unsupported' })
  })

  it('upgrades an installed ACP package to the selected version instead of reusing it', async () => {
    const directory = path.join(state.root, '@kilocode', 'cli')
    await mkdir(directory, { recursive: true })
    await writeFile(
      path.join(directory, 'package.json'),
      JSON.stringify({ name: '@kilocode/cli', version: '7.7.0', bin: { kilo: 'cli.js' } })
    )
    await writeFile(path.join(directory, 'cli.js'), 'installed')
    await symlink(path.join(directory, 'cli.js'), path.join(state.root, 'kilo'))
    const service = new LocalAgentInstallService()
    expect(await service.install('kilo', '7.8.1')).toMatchObject({ ok: true, reused: false })
    expect(await readFile(path.join(state.root, 'calls'), 'utf8')).toBe(
      '["install","--global","@kilocode/cli@7.8.1"]\n'
    )
  })

  it('reuses a managed installation without downloading or invoking an installer', async () => {
    state.existing = '/managed/kilo'
    expect(await new LocalAgentInstallService().install('kilo')).toEqual({
      ok: true,
      reused: true,
      path: state.existing
    })
    expect(fs.existsSync(path.join(state.root, 'calls'))).toBe(false)
  })

  it('installs a system copy alongside an incompatible managed Agent', async () => {
    state.existing = path.join(state.root, 'legacy', 'kilo')
    await mkdir(path.dirname(state.existing))
    await writeFile(state.existing, 'legacy installation')
    expect(await new LocalAgentInstallService().install('kilo', undefined, true)).toMatchObject({
      ok: true,
      reused: false,
      path: path.join(state.root, 'kilo')
    })
    expect(await readFile(state.existing, 'utf8')).toBe('legacy installation')
  })

  it('runs a persistent global install once for concurrent callers and requires rediscovery', async () => {
    const service = new LocalAgentInstallService()
    const results = await Promise.all([service.install('kilo'), service.install('kilo')])
    expect(results).toEqual(Array(2).fill({ ok: true, reused: false, path: path.join(state.root, 'kilo') }))
    expect(await readFile(path.join(state.root, 'calls'), 'utf8')).toBe(
      '["install","--global","@kilocode/cli@7.8.1"]\n'
    )
  })

  it('installs and upgrades native Code Mate CLIs globally without the ACP registry or mise', async () => {
    state.name = 'codex'
    const service = new LocalAgentInstallService()
    expect(await service.installCli({ name: 'codex' })).toEqual({
      ok: true,
      reused: false,
      path: path.join(state.root, 'codex')
    })
    expect(await service.installCli({ name: 'codex', targetVersion: '1.2.3' })).toMatchObject({
      ok: true,
      reused: false
    })
    expect(await readFile(path.join(state.root, 'calls'), 'utf8')).toBe(
      '["install","--global","@openai/codex"]\n["install","--global","@openai/codex@1.2.3"]\n'
    )
    expect(fetch).not.toHaveBeenCalled()
  })

  it('uses the executable found after installation for Codex discovery, chat and model probes', async () => {
    state.name = 'codex'
    const installed = await new LocalAgentInstallService().install('codex')
    const settings = { presetId: 'codex', enabled: true, args: [], env: {} }
    const signal = new AbortController().signal

    expect(installed).toMatchObject({ ok: true, path: path.join(state.root, 'codex') })
    if (!installed.ok) throw new Error('Expected Codex installation to succeed')
    expect((await detectLocalAgents()).find(({ presetId }) => presetId === 'codex')?.path).toBe(installed.path)
    for (const purpose of ['chat', 'models'] as const) {
      const launch = await resolveCodexLaunch(settings, state.root, signal, purpose)
      expect(launch.installation).toMatchObject({ componentId: 'codex', path: installed.path })
    }
  })

  it('rejects unsafe version input before executing a package manager', async () => {
    state.name = 'codex'
    expect(
      await new LocalAgentInstallService().installCli({ name: 'codex', targetVersion: '--prefix=/tmp' })
    ).toMatchObject({ ok: false })
    expect(fs.existsSync(path.join(state.root, 'calls'))).toBe(false)
  })

  it('blocks package managers configured to write to Cherry-managed directories', async () => {
    state.target = path.join(application.getPath('feature.binary.data'), 'npm')
    expect(await new LocalAgentInstallService().install('kilo')).toMatchObject({
      ok: false,
      reason: 'managed_runtime'
    })
    expect(fs.existsSync(path.join(state.root, 'calls'))).toBe(false)
  })

  it('does not report success when the installer fails', async () => {
    state.exit = '1'
    expect(await new LocalAgentInstallService().install('kilo')).toMatchObject({ ok: false, reason: 'failed' })
    expect(fs.existsSync(path.join(state.root, 'kilo'))).toBe(false)
  })

  it('reports missing system prerequisites without silently installing managed runtimes', async () => {
    state.manager = ''
    expect(await new LocalAgentInstallService().install('kilo')).toEqual({
      ok: false,
      reason: 'missing_runtime',
      manager: 'npm'
    })
  })
  it.skipIf(process.platform === 'win32')('uninstalls only the npm package owning the detected CLI', async () => {
    const directory = path.join(state.root, '@kilocode/cli')
    await mkdir(directory, { recursive: true })
    await writeFile(
      path.join(directory, 'package.json'),
      JSON.stringify({ name: '@kilocode/cli', bin: { kilo: 'cli.js' } })
    )
    await writeFile(path.join(directory, 'cli.js'), 'installed')
    await symlink(path.join(directory, 'cli.js'), path.join(state.root, 'kilo'))
    const result = await new LocalAgentInstallService().uninstall('kilo', path.join(state.root, 'kilo'))
    expect(result).toEqual({ ok: true })
    expect(fs.existsSync(directory)).toBe(false)
    expect(fs.existsSync(path.join(state.root, 'kilo'))).toBe(false)
    expect(await readFile(path.join(state.root, 'calls'), 'utf8')).toContain('["uninstall","--global","@kilocode/cli"]')
  })

  it.skipIf(process.platform === 'win32')(
    'removes the globally installed native CLI using its package owner',
    async () => {
      state.name = 'codex'
      const directory = path.join(state.root, '@openai/codex')
      await mkdir(directory, { recursive: true })
      await writeFile(
        path.join(directory, 'package.json'),
        JSON.stringify({ name: '@openai/codex', bin: { codex: 'cli.js' } })
      )
      await writeFile(path.join(directory, 'cli.js'), 'installed')
      const executable = path.join(state.root, 'codex')
      await symlink(path.join(directory, 'cli.js'), executable)
      expect(await new LocalAgentInstallService().uninstallCli('codex', executable)).toEqual({ ok: true })
      expect(fs.existsSync(directory)).toBe(false)
      expect(fs.existsSync(executable)).toBe(false)
      expect(await readFile(path.join(state.root, 'calls'), 'utf8')).toBe('["uninstall","--global","@openai/codex"]\n')
    }
  )

  it('preserves commands whose installation owner cannot be verified', async () => {
    await writeFile(path.join(state.root, 'kilo'), 'manual installation')
    expect(await new LocalAgentInstallService().uninstall('kilo', path.join(state.root, 'kilo'))).toEqual({
      ok: false,
      reason: 'unsupported'
    })
    expect(await readFile(path.join(state.root, 'kilo'), 'utf8')).toBe('manual installation')
    expect(fs.existsSync(path.join(state.root, 'calls'))).toBe(false)
  })

  it.skipIf(process.platform === 'win32')(
    'still removes a receipt-verified legacy Hermes uv installation',
    async () => {
      state.name = 'hermes'
      const directory = path.join(state.root, 'hermes-agent')
      await mkdir(path.join(directory, 'bin'), { recursive: true })
      await writeFile(path.join(directory, 'bin/hermes'), 'legacy CLI')
      const executable = path.join(state.root, 'hermes')
      await symlink(path.join(directory, 'bin/hermes'), executable)
      await writeFile(
        path.join(directory, 'uv-receipt.toml'),
        `[tool]\nentrypoints = [{ name = "hermes", install-path = ${JSON.stringify(executable)} }]\n`
      )
      expect(await new LocalAgentInstallService().uninstall('hermes', executable)).toEqual({ ok: true })
      expect(fs.existsSync(executable)).toBe(false)
      expect(fs.existsSync(directory)).toBe(false)
      expect(await readFile(path.join(state.root, 'calls'), 'utf8')).toBe('["tool","uninstall","hermes-agent"]\n')
    }
  )

  it.skipIf(process.platform === 'win32').each([false, true])(
    'uninstalls Trae and only its owned aliases (versioned=%s)',
    async (versioned) => {
      state.name = 'traecli'
      state.env.TRAECLI_INSTALL_DIR = state.root
      const installation = path.join(state.root, 'external.trae.installation')
      const release = path.join(installation, 'releases', '0.214.1')
      await mkdir(release, { recursive: true })
      const binary = path.join(versioned ? release : state.root, 'traex')
      await writeFile(binary, '#!/usr/bin/env node\nconsole.log("TRAE CLI")\n')
      await chmod(binary, 0o755)
      if (versioned) {
        await writeFile(
          path.join(release, 'trae-installation.json'),
          JSON.stringify({ channel: 'tob', auto_update: false })
        )
        await symlink(release, path.join(installation, 'current'))
        await symlink(path.join(installation, 'current', 'traex'), path.join(state.root, 'traex'))
      }
      for (const name of ['traecli', 'ta', 'trae-cli'])
        await symlink(path.join(state.root, 'traex'), path.join(state.root, name))
      await writeFile(path.join(state.root, 'coco'), 'unrelated command')
      await writeFile(path.join(installation, 'user-config'), 'preserve')
      expect(await new LocalAgentInstallService().uninstall('trae', path.join(state.root, 'traecli'))).toEqual({
        ok: true
      })
      for (const name of ['traecli', 'traex', 'ta', 'trae-cli'])
        expect(fs.existsSync(path.join(state.root, name))).toBe(false)
      expect(await readFile(path.join(state.root, 'coco'), 'utf8')).toBe('unrelated command')
      expect(await readFile(path.join(installation, 'user-config'), 'utf8')).toBe('preserve')
      if (versioned) expect(fs.existsSync(release)).toBe(false)
    }
  )

  it('uses the Hermes source uninstaller while preserving user data', async () => {
    state.name = 'hermes'
    const executable = path.join(state.root, 'hermes')
    const config = path.join(state.root, 'config.yaml')
    await writeFile(config, 'model: existing-model')
    await writeFile(
      executable,
      `#!/usr/bin/env node
const fs = require('fs');
if (process.argv.includes('--help')) process.stdout.write('hermes uninstall --yes --full');
else if (JSON.stringify(process.argv.slice(2)) === '["uninstall","--yes"]') fs.unlinkSync(__filename);
else process.exit(1);
`
    )
    await chmod(executable, 0o755)
    expect(await new LocalAgentInstallService().uninstall('hermes', executable)).toEqual({ ok: true })
    expect(fs.existsSync(executable)).toBe(false)
    expect(await readFile(config, 'utf8')).toBe('model: existing-model')
  })

  it('preserves sessions, Dashboard and user data when a Hermes source install cannot be uninstalled', async () => {
    state.name = 'hermes'
    const sessionId = createLocalSession('hermes-source', 'hermes')
    state.openSessions = [sessionId]
    let dashboardRunning = true
    MockApplicationUtils.setService('HermesDashboardService', {
      stop: async () => {
        dashboardRunning = false
      }
    })
    const executable = path.join(state.root, 'hermes')
    const config = path.join(state.root, 'config.yaml')
    await writeFile(executable, 'source launcher')
    await writeFile(config, 'model: existing-model')
    expect(await new LocalAgentInstallService().uninstall('hermes', executable)).toEqual({
      ok: false,
      reason: 'unsupported'
    })
    expect(await readFile(executable, 'utf8')).toBe('source launcher')
    expect(await readFile(config, 'utf8')).toBe('model: existing-model')
    expect(state.openSessions).toEqual([sessionId])
    expect(dashboardRunning).toBe(true)
  })

  it.skipIf(process.platform === 'win32')(
    'preserves the OpenClaw installation when its Gateway cannot be safely stopped',
    async () => {
      state.name = 'openclaw'
      const executable = await npmEntry('openclaw', 'openclaw')
      MockApplicationUtils.setService('OpenClawService', {
        stopGateway: async () => ({ success: false, message: 'external Gateway' })
      })
      expect(await new LocalAgentInstallService().uninstall('openclaw', executable)).toEqual({
        ok: false,
        reason: 'busy'
      })
      expect(await readFile(executable, 'utf8')).toBe('installed')
      expect(fs.existsSync(path.join(state.root, 'calls'))).toBe(false)
    }
  )

  it('refuses to remove a different installation than the one confirmed', async () => {
    await writeFile(path.join(state.root, 'kilo'), 'keep')
    expect(await new LocalAgentInstallService().uninstall('kilo', '/old/kilo')).toEqual({
      ok: false,
      reason: 'changed'
    })
    expect(await readFile(path.join(state.root, 'kilo'), 'utf8')).toBe('keep')
  })

  it('blocks removal during an active agent session', async () => {
    state.openSessions = [createLocalSession('busy-kilo', 'kilo')]
    state.busy = true
    state.existing = path.join(state.root, 'managed-kilo')
    await writeFile(state.existing, 'keep')
    expect(await new LocalAgentInstallService().uninstall('kilo', state.existing)).toEqual({
      ok: false,
      reason: 'busy'
    })
    expect(await readFile(state.existing, 'utf8')).toBe('keep')
    expect(state.openSessions).toHaveLength(1)
  })

  it('closes only sessions using the uninstalled preset, even if their Agent switched providers', async () => {
    const matching = createLocalSession('matching-kilo', 'kilo')
    const other = createLocalSession('other-agent', 'opencode')
    state.liveSessions[matching] = agentService.getAgent('matching-kilo')!.localRuntime!
    const providerId = agentService.getAgent('other-agent')!.localRuntime!.providerId
    agentService.updateAgent('matching-kilo', { localRuntime: { providerId } })
    const additional = agentSessionService.create({
      agentId: 'matching-kilo',
      name: 'second Kilo session',
      workspace: { type: 'system' }
    }).id
    state.openSessions = [matching, other, additional]
    state.existing = path.join(state.root, 'managed-kilo')
    await writeFile(state.existing, 'managed')

    expect(await new LocalAgentInstallService().uninstall('kilo', state.existing)).toEqual({ ok: true })
    expect(state.openSessions).toEqual([other, additional])
    expect(agentSessionService.listIdsByAgent('matching-kilo')).toHaveLength(2)
  })

  it.skipIf(process.platform === 'win32')('matches an adapter when uninstalling its native terminal CLI', async () => {
    state.name = 'pi'
    const matching = createLocalSession('matching-pi', 'pi-acp')
    const other = createLocalSession('other-agent', 'opencode')
    state.openSessions = [matching, other]
    const directory = path.join(state.root, '@earendil-works/pi-coding-agent')
    await mkdir(directory, { recursive: true })
    await writeFile(
      path.join(directory, 'package.json'),
      JSON.stringify({ name: '@earendil-works/pi-coding-agent', bin: { pi: 'cli.js' } })
    )
    await writeFile(path.join(directory, 'cli.js'), 'installed')
    const executable = path.join(state.root, 'pi')
    await symlink(path.join(directory, 'cli.js'), executable)

    expect(await new LocalAgentInstallService().uninstallCli('pi', executable)).toEqual({ ok: true })
    expect(state.openSessions).toEqual([other])
    expect(fs.existsSync(directory)).toBe(false)
  })

  it.skipIf(process.platform === 'win32')('removes both Amp components when uninstalling the adapter', async () => {
    const adapter = await npmEntry('amp-acp', 'amp-acp')
    const cli = await npmEntry('amp', '@ampcode/cli')
    const result = await new LocalAgentInstallService().uninstall('amp-acp', adapter)
    expect(result).toEqual({ ok: true })
    expect(fs.existsSync(adapter)).toBe(false)
    expect(fs.existsSync(cli)).toBe(false)
    expect(fs.existsSync(path.join(state.target, '@ampcode/cli'))).toBe(false)
  })

  it.skipIf(process.platform === 'win32')(
    'retains all components when native CLI ownership cannot be verified',
    async () => {
      const adapter = await npmEntry('amp-acp', 'amp-acp')
      await writeFile(path.join(state.root, 'amp'), 'manual CLI')
      expect(await new LocalAgentInstallService().uninstall('amp-acp', adapter)).toMatchObject({
        ok: false,
        reason: 'unsupported'
      })
      expect(fs.existsSync(adapter)).toBe(true)
      expect(await readFile(path.join(state.root, 'amp'), 'utf8')).toBe('manual CLI')
      expect(fs.existsSync(path.join(state.root, 'calls'))).toBe(false)
    }
  )

  it.skipIf(process.platform === 'win32').each(['KEEP_PACKAGE', 'KEEP_PACKAGE_FILES'])(
    'reports partial removal when a successful package command leaves files behind (%s)',
    async (retention) => {
      const adapter = await npmEntry('amp-acp', 'amp-acp')
      const cli = await npmEntry('amp', '@ampcode/cli')
      state.env[retention] = '@ampcode/cli'
      expect(await new LocalAgentInstallService().uninstall('amp-acp', adapter)).toMatchObject({
        ok: false,
        reason: 'partial',
        removed: ['amp-acp'],
        remaining: ['amp']
      })
      expect(fs.existsSync(adapter)).toBe(false)
      expect(fs.existsSync(cli)).toBe(retention === 'KEEP_PACKAGE')
      expect(fs.existsSync(path.join(state.target, '@ampcode/cli'))).toBe(true)
    }
  )

  it.skipIf(process.platform === 'win32')(
    'rejects a changed component list before deleting any confirmed installation',
    async () => {
      const adapter = await npmEntry('amp-acp', 'amp-acp')
      const service = new LocalAgentInstallService()
      const components = await service.getUninstallComponents('amp-acp', adapter)
      expect(components).toEqual([{ executable: 'amp-acp', path: adapter }])
      const cli = await npmEntry('amp', '@ampcode/cli')
      expect(await service.uninstall('amp-acp', adapter, components)).toEqual({ ok: false, reason: 'changed' })
      expect(fs.existsSync(adapter)).toBe(true)
      expect(fs.existsSync(cli)).toBe(true)
      expect(fs.existsSync(path.join(state.target, '@ampcode/cli'))).toBe(true)
    }
  )

  it.skipIf(process.platform === 'win32')(
    'removes the verified Antigravity CLI and preserves its configuration and unrelated binaries',
    async () => {
      vi.mocked(application.getPath).mockImplementation((key, file) => {
        const directory = key === 'sys.home' || key === 'external.acp.bin' ? state.root : path.join(state.root, key)
        return key === 'external.antigravity.cli.file'
          ? path.join(state.root, 'agy')
          : file
            ? path.join(directory, file)
            : directory
      })
      const adapter = path.join(state.root, 'agy_acp_server.par')
      await writeFile(adapter, 'adapter')
      const cli = path.join(state.root, 'agy')
      await writeFile(
        cli,
        '#!/usr/bin/env node\nif (process.argv.includes("--version")) process.stdout.write("1.5.0"); else process.stderr.write("Usage of agy:")\n'
      )
      await chmod(cli, 0o755)
      const config = path.join(state.root, 'settings.json')
      await writeFile(config, '{"keep":true}')
      const service = new LocalAgentInstallService()
      expect(await service.getUninstallComponents('antigravity-acp', cli)).toEqual([{ executable: 'agy', path: cli }])
      expect(await service.uninstall('antigravity-acp', cli)).toEqual({ ok: true })
      expect(fs.existsSync(adapter)).toBe(true)
      expect(fs.existsSync(cli)).toBe(false)
      expect(await readFile(config, 'utf8')).toBe('{"keep":true}')
    }
  )

  it.skipIf(process.platform === 'win32').each([false, true])(
    'removes only the verified standalone Kiro binary (symlink=%s)',
    async (linked) => {
      vi.mocked(application.getPath).mockImplementation((key, file) => {
        const directory = key === 'sys.home' || key === 'external.acp.bin' ? state.root : path.join(state.root, key)
        return file ? path.join(directory, file) : directory
      })
      const binary = path.join(state.root, linked ? 'foreign-kiro' : 'kiro-cli')
      await writeFile(binary, '#!/usr/bin/env node\nconsole.log("kiro-cli 3.0.0")\n')
      await chmod(binary, 0o755)
      const entry = path.join(state.root, 'kiro-cli')
      if (linked) await symlink(binary, entry)
      expect(await new LocalAgentInstallService().uninstall('kiro', entry)).toEqual(
        linked ? { ok: false, reason: 'unsupported' } : { ok: true }
      )
      expect(fs.existsSync(binary)).toBe(linked)
    }
  )

  async function npmEntry(executable: string, name: string) {
    state.target = path.join(state.root, 'node_modules')
    const directory = path.join(state.target, name)
    await mkdir(directory, { recursive: true })
    await writeFile(path.join(directory, 'package.json'), JSON.stringify({ name, bin: { [executable]: 'cli.js' } }))
    await writeFile(path.join(directory, 'cli.js'), 'installed')
    const entry = path.join(state.root, executable)
    await symlink(path.join(directory, 'cli.js'), entry)
    return entry
  }

  it('serializes removal against pending installation', async () => {
    const service = new LocalAgentInstallService()
    const installing = service.install('kilo')
    expect(await service.uninstall('kilo', path.join(state.root, 'kilo'))).toEqual({ ok: false, reason: 'busy' })
    expect(await installing).toMatchObject({ ok: true })
  })
  it('removes a CodeMate installation through its existing manager', async () => {
    state.existing = path.join(state.root, 'managed-kilo')
    await writeFile(state.existing, 'managed')
    const command = state.existing
    expect(await new LocalAgentInstallService().uninstall('kilo', command)).toEqual({ ok: true })
    expect(fs.existsSync(command)).toBe(false)
    expect(fs.existsSync(path.join(state.root, 'calls'))).toBe(false)
  })

  it('preserves a CodeMate installation when its manager blocks cleanup', async () => {
    state.existing = path.join(state.root, 'managed-kilo')
    state.removeBlocked = true
    await writeFile(state.existing, 'managed')
    expect(await new LocalAgentInstallService().uninstall('kilo', state.existing)).toMatchObject({
      ok: false,
      reason: 'failed'
    })
    expect(await readFile(state.existing, 'utf8')).toBe('managed')
  })
})
