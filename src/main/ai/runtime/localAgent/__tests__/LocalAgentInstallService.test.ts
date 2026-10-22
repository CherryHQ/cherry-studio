import fs from 'node:fs'
import { chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import { BaseService } from '@main/core/lifecycle'

import { LocalAgentInstallService } from '../LocalAgentInstallService'

const state = vi.hoisted(() => ({
  runtimeAvailable: true,
  root: '',
  name: 'kilo',
  manager: '',
  target: '',
  existing: '',
  exit: '0',
  busy: false,
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
      getToolSnapshots: async () => ({
        [state.name]: {
          name: state.name,
          availability: fs.existsSync(`${state.root}/${state.name}`)
            ? { source: 'system', path: `${state.root}/${state.name}` }
            : state.existing
              ? { source: 'mise', path: state.existing }
              : { source: 'none' }
        }
      })
    },
    AgentSessionRuntimeService: { closeLocalAgentForUninstall: async () => !state.busy },
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
    name === 'bun' ? (state.runtimeAvailable ? '/user/bin/bun' : null) : state.manager || null
}))

describe('local agent system installation', () => {
  beforeEach(async () => {
    BaseService.resetInstances()
    state.runtimeAvailable = true
    state.name = 'kilo'
    state.root = await mkdtemp(path.join(os.tmpdir(), 'agent system install '))
    state.manager = path.join(state.root, 'npm')
    state.target = state.root
    state.existing = ''
    state.exit = '0'
    state.busy = false
    state.removeBlocked = false
    state.china = false
    state.registry = 'https://registry.npmjs.org/'
    state.env = {}
    vi.mocked(application.getPath).mockImplementation((key) =>
      key === 'sys.home' ? state.root : path.join(state.root, 'cherry')
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
if (process.argv[2] === 'uninstall') { fs.unlinkSync(root + '/' + process.env.INSTALL_NAME); fs.rmSync(root + '/' + process.argv[4], {recursive:true}); }
else if (process.env.INSTALL_EXIT === '0') fs.writeFileSync(root + '/' + process.env.INSTALL_NAME, 'installed');
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
          agents: [{ id: 'kilo', distribution: { npx: { package: '@kilocode/cli@7.8.1' } } }]
        })
      }))
    )
  })
  afterEach(async () => {
    vi.unstubAllGlobals()
    await rm(state.root, { recursive: true, force: true })
  })

  it('reports missing Bun before installing an unusable omp executable', async () => {
    state.name = 'omp'
    state.runtimeAvailable = false
    expect(await new LocalAgentInstallService().install('omp')).toMatchObject({
      ok: false,
      reason: 'missing_runtime',
      manager: 'bun'
    })
    await expect(readFile(path.join(state.root, 'calls'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
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
    state.target = path.join(state.root, 'cherry', 'npm')
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

  it('refuses to remove a different installation than the one confirmed', async () => {
    await writeFile(path.join(state.root, 'kilo'), 'keep')
    expect(await new LocalAgentInstallService().uninstall('kilo', '/old/kilo')).toEqual({
      ok: false,
      reason: 'changed'
    })
    expect(await readFile(path.join(state.root, 'kilo'), 'utf8')).toBe('keep')
  })

  it('blocks removal during an active agent session', async () => {
    state.busy = true
    await writeFile(path.join(state.root, 'kilo'), 'keep')
    expect(await new LocalAgentInstallService().uninstall('kilo', path.join(state.root, 'kilo'))).toEqual({
      ok: false,
      reason: 'busy'
    })
    expect(await readFile(path.join(state.root, 'kilo'), 'utf8')).toBe('keep')
  })

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
