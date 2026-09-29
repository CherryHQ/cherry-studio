import fs from 'node:fs'
import { chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import { BaseService } from '@main/core/lifecycle'

import { LocalAgentInstallService } from '../LocalAgentInstallService'

const state = vi.hoisted(() => ({
  root: '',
  manager: '',
  target: '',
  existing: '',
  exit: '0',
  busy: false,
  removeBlocked: false
}))
vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  const fs = await import('node:fs')
  return mockApplicationFactory({
    BinaryManager: {
      removeTool: async ({ name }: { name: string }) => {
        if (name !== 'gemini' || state.removeBlocked) return { status: 'cleanup_blocked', reason: 'conflict' }
        fs.unlinkSync(state.existing)
        state.existing = ''
        return { status: 'removed' }
      },
      getToolSnapshots: async () => ({
        gemini: {
          name: 'gemini',
          availability: state.existing
            ? { source: 'mise', path: state.existing }
            : fs.existsSync(`${state.root}/gemini`)
              ? { source: 'system', path: `${state.root}/gemini` }
              : { source: 'none' }
        }
      })
    },
    AgentSessionRuntimeService: { closeLocalAgentForUninstall: async () => !state.busy },
    IpcApiService: { broadcast: () => {} }
  })
})
vi.mock('@main/utils/shellEnv', () => ({
  refreshShellEnv: async () => ({}),
  getRawShellEnv: async () => ({
    PATH: process.env.PATH!,
    INSTALL_ROOT: state.root,
    INSTALL_TARGET: state.target,
    INSTALL_EXIT: state.exit
  })
}))
vi.mock('@main/utils/commandResolver', () => ({ findExecutableInEnv: async () => state.manager || null }))

describe('local agent system installation', () => {
  beforeEach(async () => {
    BaseService.resetInstances()
    state.root = await mkdtemp(path.join(os.tmpdir(), 'agent system install '))
    state.manager = path.join(state.root, 'npm')
    state.target = state.root
    state.existing = ''
    state.exit = '0'
    state.busy = false
    state.removeBlocked = false
    vi.mocked(application.getPath).mockImplementation((key) =>
      key === 'sys.home' ? state.root : path.join(state.root, 'cherry')
    )
    await writeFile(
      state.manager,
      `#!/usr/bin/env node
const fs = require('fs'); const root = process.env.INSTALL_ROOT;
if (process.argv[2] === 'root' || process.argv[2] === 'prefix') { process.stdout.write(process.env.INSTALL_TARGET); }
else { fs.appendFileSync(root + '/calls', JSON.stringify(process.argv.slice(2)) + '\\n');
if (process.argv[2] === 'uninstall') { fs.unlinkSync(root + '/gemini'); fs.rmSync(root + '/@google/gemini-cli', {recursive:true}); }
else if (process.env.INSTALL_EXIT === '0') fs.writeFileSync(root + '/gemini', 'installed');
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
          agents: [{ id: 'gemini', distribution: { npx: { package: '@google/gemini-cli@0.61.0' } } }]
        })
      }))
    )
  })
  afterEach(async () => {
    vi.unstubAllGlobals()
    await rm(state.root, { recursive: true, force: true })
  })

  it('reuses a managed installation without downloading or invoking an installer', async () => {
    state.existing = '/managed/gemini'
    expect(await new LocalAgentInstallService().install('gemini')).toEqual({
      ok: true,
      reused: true,
      path: state.existing
    })
    expect(fs.existsSync(path.join(state.root, 'calls'))).toBe(false)
  })

  it('runs a persistent global install once for concurrent callers and requires rediscovery', async () => {
    const service = new LocalAgentInstallService()
    const results = await Promise.all([service.install('gemini'), service.install('gemini')])
    expect(results).toEqual(Array(2).fill({ ok: true, reused: false, path: path.join(state.root, 'gemini') }))
    expect(await readFile(path.join(state.root, 'calls'), 'utf8')).toBe(
      '["install","--global","@google/gemini-cli@0.61.0"]\n'
    )
  })

  it('blocks package managers configured to write to Cherry-managed directories', async () => {
    state.target = path.join(state.root, 'cherry', 'npm')
    expect(await new LocalAgentInstallService().install('gemini')).toMatchObject({
      ok: false,
      reason: 'managed_runtime'
    })
    expect(fs.existsSync(path.join(state.root, 'calls'))).toBe(false)
  })

  it('does not report success when the installer fails', async () => {
    state.exit = '1'
    expect(await new LocalAgentInstallService().install('gemini')).toMatchObject({ ok: false, reason: 'failed' })
    expect(fs.existsSync(path.join(state.root, 'gemini'))).toBe(false)
  })

  it('reports missing system prerequisites without silently installing managed runtimes', async () => {
    state.manager = ''
    expect(await new LocalAgentInstallService().install('gemini')).toEqual({
      ok: false,
      reason: 'missing_runtime',
      manager: 'npm'
    })
  })
  it.skipIf(process.platform === 'win32')('uninstalls only the npm package owning the detected CLI', async () => {
    const directory = path.join(state.root, '@google/gemini-cli')
    await mkdir(directory, { recursive: true })
    await writeFile(
      path.join(directory, 'package.json'),
      JSON.stringify({ name: '@google/gemini-cli', bin: { gemini: 'cli.js' } })
    )
    await writeFile(path.join(directory, 'cli.js'), 'installed')
    await symlink(path.join(directory, 'cli.js'), path.join(state.root, 'gemini'))
    const result = await new LocalAgentInstallService().uninstall('gemini', path.join(state.root, 'gemini'))
    expect(result).toEqual({ ok: true })
    expect(fs.existsSync(directory)).toBe(false)
    expect(fs.existsSync(path.join(state.root, 'gemini'))).toBe(false)
    expect(await readFile(path.join(state.root, 'calls'), 'utf8')).toContain(
      '["uninstall","--global","@google/gemini-cli"]'
    )
  })

  it('preserves commands whose installation owner cannot be verified', async () => {
    await writeFile(path.join(state.root, 'gemini'), 'manual installation')
    expect(await new LocalAgentInstallService().uninstall('gemini', path.join(state.root, 'gemini'))).toEqual({
      ok: false,
      reason: 'unsupported'
    })
    expect(await readFile(path.join(state.root, 'gemini'), 'utf8')).toBe('manual installation')
    expect(fs.existsSync(path.join(state.root, 'calls'))).toBe(false)
  })

  it('refuses to remove a different installation than the one confirmed', async () => {
    await writeFile(path.join(state.root, 'gemini'), 'keep')
    expect(await new LocalAgentInstallService().uninstall('gemini', '/old/gemini')).toEqual({
      ok: false,
      reason: 'changed'
    })
    expect(await readFile(path.join(state.root, 'gemini'), 'utf8')).toBe('keep')
  })

  it('blocks removal during an active agent session', async () => {
    state.busy = true
    await writeFile(path.join(state.root, 'gemini'), 'keep')
    expect(await new LocalAgentInstallService().uninstall('gemini', path.join(state.root, 'gemini'))).toEqual({
      ok: false,
      reason: 'busy'
    })
    expect(await readFile(path.join(state.root, 'gemini'), 'utf8')).toBe('keep')
  })

  it('serializes removal against pending installation', async () => {
    const service = new LocalAgentInstallService()
    const installing = service.install('gemini')
    expect(await service.uninstall('gemini', path.join(state.root, 'gemini'))).toEqual({ ok: false, reason: 'busy' })
    expect(await installing).toMatchObject({ ok: true })
  })
  it('removes a CodeMate installation through its existing manager', async () => {
    state.existing = path.join(state.root, 'managed-gemini')
    await writeFile(state.existing, 'managed')
    const command = state.existing
    expect(await new LocalAgentInstallService().uninstall('gemini', command)).toEqual({ ok: true })
    expect(fs.existsSync(command)).toBe(false)
    expect(fs.existsSync(path.join(state.root, 'calls'))).toBe(false)
  })

  it('preserves a CodeMate installation when its manager blocks cleanup', async () => {
    state.existing = path.join(state.root, 'managed-gemini')
    state.removeBlocked = true
    await writeFile(state.existing, 'managed')
    expect(await new LocalAgentInstallService().uninstall('gemini', state.existing)).toMatchObject({
      ok: false,
      reason: 'failed'
    })
    expect(await readFile(state.existing, 'utf8')).toBe('managed')
  })
})
