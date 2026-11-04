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
import { BaseService } from '@main/core/lifecycle'

import { installBinaryAgent } from '../installBinary'
import { LocalAgentInstallService } from '../LocalAgentInstallService'
import { resolveRequiredRuntime } from '../runtimeDependency'

vi.mock('../runtimeDependency', () => ({ resolveRequiredRuntime: vi.fn() }))

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
      closeIdleSessions: async (sessionIds: readonly string[]) => {
        if (state.busy) return false
        state.openSessions = state.openSessions.filter((id) => !sessionIds.includes(id))
        return true
      }
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
      configuration: { localRuntime: { presetId, protocol: 'acp', enabled: true, args: [], env: {} } }
    })
    return agentSessionService.create({ agentId, name: agentId, workspace: { type: 'system' } }).id
  }

  it('installs the required system Bun before omp', async () => {
    state.name = 'omp'
    state.runtimeAvailable = false
    expect(await new LocalAgentInstallService().install('omp')).toMatchObject({ ok: true })
    expect(
      (await readFile(path.join(state.root, 'calls'), 'utf8'))
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line))
    ).toEqual([
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
    expect(JSON.parse((await readFile(path.join(state.root, 'calls'), 'utf8')).trim())).toEqual([
      'install',
      '--global',
      '@oh-my-pi/pi-coding-agent'
    ])
  })

  it.each([
    ['amp-acp', 'amp', '@ampcode/cli'],
    ['pi-acp', 'pi', '@earendil-works/pi-coding-agent']
  ])('repairs a reused %s adapter by installing its missing native CLI', async (id, executable, packageName) => {
    state.name = id
    await writeFile(path.join(state.root, state.name), 'adapter')
    expect(await new LocalAgentInstallService().install(id)).toMatchObject({ ok: true, reused: true })
    expect(JSON.parse((await readFile(path.join(state.root, 'calls'), 'utf8')).trim())).toEqual([
      'install',
      '--global',
      packageName
    ])
    expect(fs.existsSync(path.join(state.root, executable))).toBe(true)
  })

  it('installs Pi before its adapter on a clean system', async () => {
    state.name = 'pi-acp'
    expect(await new LocalAgentInstallService().install('pi-acp')).toMatchObject({ ok: true, reused: false })
    expect(
      (await readFile(path.join(state.root, 'calls'), 'utf8'))
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line))
    ).toEqual([
      ['install', '--global', '@earendil-works/pi-coding-agent'],
      ['install', '--global', 'pi-acp@0.0.34']
    ])
    expect(fs.existsSync(path.join(state.root, 'pi'))).toBe(true)
    expect(fs.existsSync(path.join(state.root, 'pi-acp'))).toBe(true)
  })

  it('repairs the Antigravity terminal through its official native installer', async () => {
    state.name = 'agy_acp_server.par'
    await writeFile(path.join(state.root, state.name), 'adapter')
    expect(await new LocalAgentInstallService().install('antigravity-acp')).toMatchObject({ ok: true, reused: true })
    expect(fs.existsSync(path.join(state.root, 'agy'))).toBe(true)
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

  it('does not install the Pi adapter after its native CLI installation fails', async () => {
    state.name = 'pi-acp'
    state.exit = '1'
    expect(await new LocalAgentInstallService().install('pi-acp')).toMatchObject({ ok: false, reason: 'failed' })
    expect(fs.existsSync(path.join(state.root, 'pi-acp'))).toBe(false)
    expect((await readFile(path.join(state.root, 'calls'), 'utf8')).trim().split('\n')).toHaveLength(1)
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
    expect((await readFile(path.join(state.root, 'calls'), 'utf8')).trim().split('\n')).toHaveLength(1)
  })

  it.each([
    ['omp', '@oh-my-pi/pi-coding-agent'],
    ['snow', 'snow-ai'],
    ['zcode', 'zcode-acp-server']
  ])('installs %s even when the ACP registry is unavailable', async (id, packageName) => {
    state.name = id === 'zcode' ? 'zcode-acp' : id
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Registry unavailable')))
    expect(await new LocalAgentInstallService().install(id)).toMatchObject({ ok: true, reused: false })
    expect(JSON.parse((await readFile(path.join(state.root, 'calls'), 'utf8')).trim())).toEqual([
      'install',
      '--global',
      packageName
    ])
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
    state.name = 'hermes'
    state.env = { FAIL_MIRROR: '1' }
    expect(await new LocalAgentInstallService().installCli({ name: 'hermes' })).toMatchObject({ ok: true })
    expect((await readFile(path.join(state.root, 'sources'), 'utf8')).trim().split('\n')).toEqual([
      'https://pypi.tuna.tsinghua.edu.cn/simple',
      'https://mirrors.cloud.tencent.com/pypi/simple',
      'original'
    ])
  })

  it.each(['env', 'file'])('preserves uv %s configuration', async (source) => {
    state.china = true
    state.name = 'hermes'
    if (source === 'env') state.env = { UV_DEFAULT_INDEX: 'https://packages.example.com/simple' }
    else
      await writeFile(
        application.getPath('external.uv.user_config_file'),
        'index-url = "https://packages.example.com/simple"'
      )
    expect(await new LocalAgentInstallService().installCli({ name: 'hermes' })).toMatchObject({ ok: true })
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

  it('preserves the OpenClaw installation when its Gateway cannot be safely stopped', async () => {
    state.name = 'openclaw'
    const executable = path.join(state.root, state.name)
    await writeFile(executable, 'installed')
    MockApplicationUtils.setService('OpenClawService', {
      stopGateway: async () => ({ success: false, message: 'external Gateway' })
    })
    expect(await new LocalAgentInstallService().uninstall('openclaw', executable)).toEqual({
      ok: false,
      reason: 'busy'
    })
    expect(await readFile(executable, 'utf8')).toBe('installed')
    expect(fs.existsSync(path.join(state.root, 'calls'))).toBe(false)
  })

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
    await writeFile(path.join(state.root, 'kilo'), 'keep')
    expect(await new LocalAgentInstallService().uninstall('kilo', path.join(state.root, 'kilo'))).toEqual({
      ok: false,
      reason: 'busy'
    })
    expect(await readFile(path.join(state.root, 'kilo'), 'utf8')).toBe('keep')
    expect(state.openSessions).toHaveLength(1)
  })

  it('closes only sessions belonging to the uninstalled local preset', async () => {
    const matching = createLocalSession('matching-kilo', 'kilo')
    const other = createLocalSession('other-agent', 'opencode')
    const additional = agentSessionService.create({
      agentId: 'matching-kilo',
      name: 'second Kilo session',
      workspace: { type: 'system' }
    }).id
    state.openSessions = [matching, other, additional]
    state.existing = path.join(state.root, 'managed-kilo')
    await writeFile(state.existing, 'managed')

    expect(await new LocalAgentInstallService().uninstall('kilo', state.existing)).toEqual({ ok: true })
    expect(state.openSessions).toEqual([other])
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

  // Removing an adapter must also remove its independently installed CLI, in either entry direction.
  it.skipIf(process.platform === 'win32').each([
    ['pi-acp', 'pi', '@earendil-works/pi-coding-agent', false],
    ['pi-acp', 'pi', '@earendil-works/pi-coding-agent', true],
    ['amp-acp', 'amp', '@ampcode/cli', false]
  ] as const)('removes both components of %s (native entry=%s)', async (presetId, native, nativePackage, viaCli) => {
    const adapter = await npmEntry(presetId, presetId)
    const cli = await npmEntry(native, nativePackage)
    const result = viaCli
      ? await new LocalAgentInstallService().uninstallCli(native, cli)
      : await new LocalAgentInstallService().uninstall(presetId, adapter)
    expect(result).toEqual({ ok: true })
    expect(fs.existsSync(adapter)).toBe(false)
    expect(fs.existsSync(cli)).toBe(false)
    expect(fs.existsSync(path.join(state.target, nativePackage))).toBe(false)
  })

  it.skipIf(process.platform === 'win32')(
    'retains all components when native CLI ownership cannot be verified',
    async () => {
      const adapter = await npmEntry('pi-acp', 'pi-acp')
      await writeFile(path.join(state.root, 'pi'), 'manual CLI')
      expect(await new LocalAgentInstallService().uninstall('pi-acp', adapter)).toMatchObject({
        ok: false,
        reason: 'unsupported'
      })
      expect(fs.existsSync(adapter)).toBe(true)
      expect(await readFile(path.join(state.root, 'pi'), 'utf8')).toBe('manual CLI')
      expect(fs.existsSync(path.join(state.root, 'calls'))).toBe(false)
    }
  )

  it.skipIf(process.platform === 'win32').each(['KEEP_PACKAGE', 'KEEP_PACKAGE_FILES'])(
    'reports partial removal when a successful package command leaves files behind (%s)',
    async (retention) => {
      const adapter = await npmEntry('pi-acp', 'pi-acp')
      const cli = await npmEntry('pi', '@earendil-works/pi-coding-agent')
      state.env[retention] = '@earendil-works/pi-coding-agent'
      expect(await new LocalAgentInstallService().uninstall('pi-acp', adapter)).toMatchObject({
        ok: false,
        reason: 'partial',
        removed: ['pi-acp'],
        remaining: ['pi']
      })
      expect(fs.existsSync(adapter)).toBe(false)
      expect(fs.existsSync(cli)).toBe(retention === 'KEEP_PACKAGE')
      expect(fs.existsSync(path.join(state.target, '@earendil-works/pi-coding-agent'))).toBe(true)
    }
  )

  it.skipIf(process.platform === 'win32')(
    'rejects a changed component list before deleting any confirmed installation',
    async () => {
      const adapter = await npmEntry('pi-acp', 'pi-acp')
      const service = new LocalAgentInstallService()
      const components = await service.getUninstallComponents('pi-acp', adapter)
      expect(components).toEqual([{ executable: 'pi-acp', path: adapter }])
      const cli = await npmEntry('pi', '@earendil-works/pi-coding-agent')
      expect(await service.uninstall('pi-acp', adapter, components)).toEqual({ ok: false, reason: 'changed' })
      expect(fs.existsSync(adapter)).toBe(true)
      expect(fs.existsSync(cli)).toBe(true)
      expect(fs.existsSync(path.join(state.target, '@earendil-works/pi-coding-agent'))).toBe(true)
    }
  )

  it.skipIf(process.platform === 'win32')(
    'removes Antigravity ACP and its verified standalone CLI without touching configuration',
    async () => {
      vi.mocked(application.getPath).mockImplementation((key, file) => {
        const directory = key === 'sys.home' || key === 'external.acp.bin' ? state.root : path.join(state.root, key)
        return key === 'external.antigravity.cli.file'
          ? path.join(state.root, 'agy')
          : file
            ? path.join(directory, file)
            : directory
      })
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => new Response('#!/bin/sh\necho acp\n'))
      )
      const adapter = await installBinaryAgent(
        'agy_acp_server.par',
        { manager: 'binary', version: '1.0', archive: 'https://example.com/adapter', cmd: 'adapter' },
        new AbortController().signal
      )
      const cli = path.join(state.root, 'agy')
      await writeFile(
        cli,
        '#!/usr/bin/env node\nconsole.log(process.argv.includes("--version") ? "1.2.3" : "Antigravity CLI")\n'
      )
      await chmod(cli, 0o755)
      const config = path.join(state.root, 'settings.json')
      await writeFile(config, '{"keep":true}')
      expect(await new LocalAgentInstallService().uninstall('antigravity-acp', adapter)).toEqual({ ok: true })
      expect(fs.existsSync(adapter)).toBe(false)
      expect(fs.existsSync(cli)).toBe(false)
      expect(await readFile(config, 'utf8')).toBe('{"keep":true}')
      expect(await fs.promises.readdir(path.join(state.root, 'feature.acp.agents'))).toEqual([])
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
