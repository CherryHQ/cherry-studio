import fsp from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { MockApplicationUtils } from '@test-mocks/main/application'
import { MockMainCacheServiceUtils } from '@test-mocks/main/CacheService'
import { MockMainPreferenceServiceUtils } from '@test-mocks/main/PreferenceService'
import { mockMainLoggerService } from '@test-mocks/MainLoggerService'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import { BaseService } from '@main/core/lifecycle'
import { binaryHandlers } from '@main/ipc/handlers/binary'
import { IpcRouter } from '@main/ipc/IpcRouter'
import { findCommandInShellEnv } from '@main/utils/commandResolver'
import type { CustomToolDefinition } from '@shared/data/preference/preferenceTypes'
import { binaryRequestSchemas } from '@shared/ipc/schemas/binary'

import { BinaryManager } from '../BinaryManager'

vi.mock('@main/utils/commandResolver', () => ({
  findCommandInShellEnv: vi.fn(async () => null),
  findExecutable: vi.fn(() => null),
  findMiseExecutable: vi.fn(async () => null)
}))
vi.mock('@main/utils/shellEnv', () => ({
  getRawShellEnv: vi.fn(async () => ({})),
  refreshShellEnv: vi.fn(async () => ({}))
}))

const CACHE_KEY = 'feature.binary.installed_sizes'
type Install = { active?: boolean; version?: string; install_path?: string }
const deferred = () => {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

describe('BinaryManager installed sizes', () => {
  let root: string
  let manager: BinaryManager
  let installed: Record<string, Install[]>
  let recipes: Map<string, string>
  let targets: Map<string, string>
  let runMise: ReturnType<typeof vi.fn>
  let failUse: boolean

  const definitions = (values: CustomToolDefinition[]) => {
    for (const definition of values) recipes.set(definition.name, definition.tool)
    MockMainPreferenceServiceUtils.setPreferenceValue('feature.binary.tools', values)
  }
  const install = async (name: string, tool = name, version = '1.0.0', size = 15) => {
    recipes.set(name, tool)
    const installation = path.join(root, 'installs', `fixture-${name}`, version)
    await fsp.mkdir(path.join(installation, 'one', 'two'), { recursive: true })
    await fsp.mkdir(path.join(installation, 'bin'), { recursive: true })
    const binary = path.join(installation, 'bin', name)
    await fsp.writeFile(binary, Buffer.alloc(size === 0 ? 0 : 3), { mode: 0o755 })
    if (size > 0) {
      await fsp.writeFile(path.join(installation, 'one', 'a'), Buffer.alloc(5))
      await fsp.writeFile(path.join(installation, 'one', 'two', 'b'), Buffer.alloc(size - 8))
    }
    await fsp.writeFile(path.join(root, 'shims', name), '', { mode: 0o755 })
    installed[tool] = [{ active: true, version, install_path: installation }]
    targets.set(name, binary)
    return installation
  }
  const bundled = async (name: string, size: number) => {
    await fsp.writeFile(path.join(root, 'bundled', name), Buffer.alloc(size), { mode: 0o755 })
  }
  const gateDirectories = (blocked: Set<string>) => {
    const reached = deferred()
    const release = deferred()
    const opendir = fsp.opendir.bind(fsp)
    const opened: string[] = []
    vi.spyOn(fsp, 'opendir').mockImplementation(async (...args) => {
      const candidate = String(args[0])
      opened.push(candidate)
      if (blocked.has(candidate)) {
        reached.resolve()
        await release.promise
      }
      return opendir(...args)
    })
    return { reached: reached.promise, release: release.resolve, opened }
  }

  beforeEach(async () => {
    BaseService.resetInstances()
    MockApplicationUtils.resetServices()
    MockMainCacheServiceUtils.resetMocks()
    MockMainPreferenceServiceUtils.resetMocks()
    vi.clearAllMocks()
    vi.mocked(findCommandInShellEnv).mockReset().mockResolvedValue(null)
    root = await fsp.realpath(await fsp.mkdtemp(path.join(tmpdir(), 'manager-sizes-')))
    await fsp.mkdir(path.join(root, 'shims'))
    await fsp.mkdir(path.join(root, 'bundled'))
    vi.mocked(application.getPath).mockImplementation((key: string, filename?: string) => {
      const base = key === 'feature.binary.data' ? root : path.join(root, key === 'cherry.bin' ? 'bundled' : key)
      return filename ? path.join(base, filename) : base
    })
    installed = {}
    recipes = new Map()
    targets = new Map()
    failUse = false
    manager = new BinaryManager()
    ;(manager as any).miseBin = '/fixture/mise'
    runMise = vi.spyOn(manager as any, 'runMise').mockImplementation(async (...input: unknown[]) => {
      const args = input[0] as string[]
      const command = args[0]
      if (command === 'ls') {
        const tool = args.at(-1) === '--json' ? undefined : args.at(-1)
        return { stdout: JSON.stringify(tool ? { [tool]: installed[tool] ?? [] } : installed) }
      }
      if (command === 'which') {
        const target = targets.get(args[1])
        if (!target) throw new Error('not installed')
        return { stdout: target }
      }
      if (command === 'bin-paths') return { stdout: '[]' }
      if (command === 'use') {
        const spec = args.at(-1)!
        const at = spec.lastIndexOf('@')
        const tool = spec.slice(0, at)
        const version = spec.slice(at + 1) === 'latest' ? '2.0.0' : spec.slice(at + 1)
        const name = [...recipes].find(([, recipe]) => recipe === tool)?.[0] ?? tool
        await install(name, tool, version, 21)
        if (failUse) throw new Error('partial backend failure')
      }
      if (command === 'uninstall') {
        const tool = args.at(-1)!
        delete installed[tool]
        const name = [...recipes].find(([, recipe]) => recipe === tool)?.[0] ?? tool
        targets.delete(name)
        await fsp.rm(path.join(root, 'shims', name), { force: true })
      }
      return { stdout: '' }
    })
    MockApplicationUtils.setService('BinaryManager', manager)
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    MockApplicationUtils.resetServices()
    await fsp.rm(root, { recursive: true, force: true })
  })

  it('M1 wires real router/handler/manager and never measures system, none, unknown or core Rust', async () => {
    definitions([
      { name: 'syscli', tool: 'github:example/sys' },
      { name: 'absent', tool: 'github:example/absent' },
      { name: 'rust', tool: 'core:rust' }
    ])
    await install('rust', 'core:rust')
    await bundled('uv', 7)
    await bundled('bun', 11)
    await bundled('uvx', 13)
    vi.mocked(findCommandInShellEnv).mockImplementation(async (name) =>
      name === 'syscli' ? '/usr/local/bin/syscli' : null
    )
    const lstat = vi.spyOn(fsp, 'lstat')
    const opendir = vi.spyOn(fsp, 'opendir')
    const router = new IpcRouter(binaryRequestSchemas, binaryHandlers)
    const actual = await router.dispatch(
      'binary.get_tool_installed_sizes',
      ['uv', 'syscli', 'absent', 'unknown', 'rust', 'uv'],
      { senderId: 'window' }
    )
    expect(actual).toEqual({ uv: 7, syscli: null, absent: null, unknown: null, rust: null })
    expect(binaryRequestSchemas['binary.get_tool_installed_sizes'].output.safeParse(actual).success).toBe(true)
    expect(lstat.mock.calls.map(([file]) => String(file))).toEqual([path.join(root, 'bundled', 'uv')])
    expect(opendir).not.toHaveBeenCalled()
    expect(await manager.getToolInstalledSizes(['uvx'])).toEqual({ uvx: 13 })
    expect(await manager.getToolInstalledSizes([])).toEqual({})
    expect(mockMainLoggerService.warn).not.toHaveBeenCalled()
  })

  it('M2 attributes aliases to only the unique active root, including entries without a version', async () => {
    const current = await install('lark-cli', 'github:larksuite/cli')
    const old = path.join(path.dirname(current), '0.1.0')
    await fsp.mkdir(old)
    await fsp.writeFile(path.join(old, 'large'), Buffer.alloc(100_000))
    await install('fd', 'core:fd', '1.0.0', 1000)
    const alias = path.join(path.dirname(current), 'latest')
    await fsp.symlink(current, alias, 'dir')
    installed['github:larksuite/cli'] = [
      { active: false, version: '0.1.0', install_path: old },
      { active: true, version: '1.0.0', install_path: alias }
    ]
    targets.set('lark-cli', path.join(alias, 'bin', 'lark-cli'))
    const before = runMise.mock.calls.length
    expect(await manager.getToolInstalledSizes(['lark-cli'])).toEqual({ 'lark-cli': 15 })
    expect(runMise.mock.calls.slice(before).filter(([args]) => args.join(' ') === 'ls --json')).toHaveLength(2)
    delete installed['github:larksuite/cli'][1].version
    expect(await manager.getToolInstalledSizes(['lark-cli'])).toEqual({ 'lark-cli': 15 })
  })

  it('M2 rejects missing, relative, escaped, shallow, ambiguous and foreign-runnable roots', async () => {
    const current = await install('fd')
    const outside = path.join(root, 'outside')
    await fsp.mkdir(outside)
    const alias = path.join(path.dirname(current), 'escape')
    await fsp.symlink(outside, alias, 'dir')
    const cases: Install[][] = [
      [{ active: true, version: '1' }],
      [{ active: true, install_path: 'relative/path' }],
      [{ active: true, install_path: `${root}-sibling/installs/fd/1` }],
      [{ active: true, install_path: path.join(root, 'installs') }],
      [{ active: true, install_path: alias }],
      [
        { active: true, install_path: current },
        { active: true, install_path: current }
      ]
    ]
    for (const entries of cases) {
      installed.fd = entries
      expect(await manager.getToolInstalledSizes(['fd'])).toEqual({ fd: null })
    }
    installed.fd = [{ active: true, install_path: current }]
    await fsp.writeFile(path.join(outside, 'fd'), '', { mode: 0o755 })
    targets.set('fd', path.join(outside, 'fd'))
    expect(await manager.getToolInstalledSizes(['fd'])).toEqual({ fd: null })
  })

  it('M3 expires positive and negative entries without confusing miss, null and zero', async () => {
    let now = Date.now()
    vi.spyOn(Date, 'now').mockImplementation(() => now)
    const current = await install('fd')
    expect(await manager.getToolInstalledSizes(['fd'])).toEqual({ fd: 15 })
    await fsp.writeFile(path.join(current, 'new'), '1234')
    expect(await manager.getToolInstalledSizes(['fd'])).toEqual({ fd: 15 })
    now += 300_000
    expect(await manager.getToolInstalledSizes(['fd'])).toEqual({ fd: 19 })
    await install('fd', 'fd', '2.0.0', 21)
    expect(await manager.getToolInstalledSizes(['fd'])).toEqual({ fd: 21 })
    await bundled('uv', 0)
    expect(await manager.getToolInstalledSizes(['uv'])).toEqual({ uv: 0 })
    await bundled('uv', 7)
    expect(await manager.getToolInstalledSizes(['uv'])).toEqual({ uv: 0 })

    const opendir = fsp.opendir.bind(fsp)
    const fail = vi.spyOn(fsp, 'opendir').mockRejectedValueOnce(Object.assign(new Error('blocked'), { code: 'EACCES' }))
    now += 300_000
    expect(await manager.getToolInstalledSizes(['fd'])).toEqual({ fd: null })
    fail.mockImplementation(opendir)
    expect(await manager.getToolInstalledSizes(['fd'])).toEqual({ fd: null })
    now += 30_000
    expect(await manager.getToolInstalledSizes(['fd'])).toEqual({ fd: 21 })
    expect(await manager.getToolInstalledSizes(['uv'])).toEqual({ uv: 7 })
  })

  it('M3 merges concurrent batches and preserves earlier entry expiry', async () => {
    let now = Date.now()
    vi.spyOn(Date, 'now').mockImplementation(() => now)
    const fd = await install('fd')
    await bundled('uv', 7)
    const gate = gateDirectories(new Set([fd]))
    const first = manager.getToolInstalledSizes(['fd'])
    await gate.reached
    expect(await manager.getToolInstalledSizes(['uv'])).toEqual({ uv: 7 })
    now += 100
    gate.release()
    expect(await first).toEqual({ fd: 15 })
    await bundled('uv', 11)
    expect(await manager.getToolInstalledSizes(['uv'])).toEqual({ uv: 7 })
    now += 299_900
    expect(await manager.getToolInstalledSizes(['uv'])).toEqual({ uv: 11 })
    await fsp.writeFile(path.join(fd, 'new'), '1234')
    expect(await manager.getToolInstalledSizes(['fd'])).toEqual({ fd: 15 })
  })

  it('M4 invalidates through fixed install, target update, remove fallback, custom add and definition-only removal', async () => {
    expect(await manager.getToolInstalledSizes(['fd'])).toEqual({ fd: null })
    await manager.installByName({ name: 'fd' })
    expect(await manager.getToolInstalledSizes(['fd'])).toEqual({ fd: 21 })
    const current = installed.fd[0].install_path!
    await fsp.writeFile(path.join(current, 'new'), '1234')
    await manager.installByName({ name: 'fd', targetVersion: '2.0.0' })
    expect(await manager.getToolInstalledSizes(['fd'])).toEqual({ fd: 25 })
    await install('uv')
    await bundled('uv', 7)
    expect(await manager.getToolInstalledSizes(['uv'])).toEqual({ uv: 15 })
    expect(await manager.removeTool({ name: 'uv' })).toEqual({ status: 'removed' })
    expect(await manager.getToolInstalledSizes(['uv'])).toEqual({ uv: 7 })
    recipes.set('custom', 'github:example/custom')
    await manager.addCustomTool({ name: 'custom', tool: 'github:example/custom' })
    expect(await manager.getToolInstalledSizes(['custom'])).toEqual({ custom: 21 })
    await fsp.writeFile(path.join(installed['github:example/custom'][0].install_path!, 'new'), '1234')
    await manager.addCustomTool({ name: 'custom', tool: 'github:example/custom' })
    expect(await manager.getToolInstalledSizes(['custom'])).toEqual({ custom: 25 })
    expect(await manager.removeTool({ name: 'custom', definitionOnly: true })).toEqual({ status: 'removed' })
    expect(await manager.getToolInstalledSizes(['custom'])).toEqual({ custom: null })
  })

  it('M4 invalidates partial backend failure even when either cache deletion throws', async () => {
    await install('fd')
    expect(await manager.getToolInstalledSizes(['fd'])).toEqual({ fd: 15 })
    const cache = application.get('CacheService')
    vi.mocked(cache.delete).mockImplementationOnce(() => {
      throw new Error('cache unavailable')
    })
    vi.mocked(cache.deleteShared).mockImplementationOnce(() => {
      throw new Error('shared unavailable')
    })
    failUse = true
    await expect(manager.installByName({ name: 'fd', targetVersion: '1.0.0' })).rejects.toThrow(
      'partial backend failure'
    )
    expect(await manager.getToolInstalledSizes(['fd'])).toEqual({ fd: 21 })
  })

  it('M5 returns immediately while busy and drops old scans without poisoning later reads', async () => {
    const fd = await install('fd')
    const gate = gateDirectories(new Set([fd]))
    const old = manager.getToolInstalledSizes(['fd'])
    await gate.reached
    const mutation = manager.installByName({ name: 'fd', targetVersion: '2.0.0' })
    expect(await manager.getToolInstalledSizes(['fd', 'uv'])).toEqual({ fd: null, uv: null })
    await mutation
    gate.release()
    expect(await old).toEqual({ fd: null })
    expect(MockMainCacheServiceUtils.getCacheValue(CACHE_KEY)).toBeUndefined()
    expect(await manager.getToolInstalledSizes(['fd'])).toEqual({ fd: 21 })
  })

  it('M5 invalidates the entire batch when an earlier sibling finished before mutation', async () => {
    const fd = await install('fd')
    await bundled('uv', 7)
    const gate = gateDirectories(new Set([fd]))
    const batch = manager.getToolInstalledSizes(['uv', 'fd'])
    await gate.reached
    await vi.waitFor(() =>
      expect(MockMainCacheServiceUtils.getCacheValue<any>(CACHE_KEY)?.entries.uv.sizeBytes).toBe(7)
    )
    await manager.installByName({ name: 'fd', targetVersion: '2.0.0' })
    gate.release()
    expect(await batch).toEqual({ uv: null, fd: null })
  })

  it('M6 caps scans across batches at two, dedupes flights and leaves snapshots and install unblocked', async () => {
    const fd = await install('fd')
    const gh = await install('gh')
    const rtk = await install('rtk')
    const release = deferred()
    const twoReached = deferred()
    const opendir = fsp.opendir.bind(fsp)
    let active = 0
    let maximum = 0
    const opened: string[] = []
    vi.spyOn(fsp, 'opendir').mockImplementation(async (...args) => {
      opened.push(String(args[0]))
      active++
      maximum = Math.max(maximum, active)
      if (active === 2) twoReached.resolve()
      await release.promise
      const handle = await opendir(...args)
      const close = handle.close.bind(handle)
      vi.spyOn(handle, 'close').mockImplementation(async () => {
        await close()
        active--
      })
      return handle
    })
    const first = manager.getToolInstalledSizes(['fd', 'gh'])
    await twoReached.promise
    const duplicate = manager.getToolInstalledSizes(['fd'])
    const queued = manager.getToolInstalledSizes(['rtk'])
    await vi.waitFor(() => expect((manager as any).installedSizeFlights.size).toBe(3))
    expect((await manager.getToolSnapshots(['fd'])).fd.availability.source).toBe('mise')
    await manager.installByName({ name: 'fd', targetVersion: '2.0.0' })
    release.resolve()
    expect(await first).toEqual({ fd: null, gh: null })
    expect(await duplicate).toEqual({ fd: null })
    expect(await queued).toEqual({ rtk: null })
    expect(maximum).toBe(2)
    expect(opened.filter((candidate) => candidate === fd)).toHaveLength(1)
    expect(opened).toContain(gh)
    expect(opened).not.toContain(rtk)
    expect(await manager.getToolInstalledSizes(['fd'])).toEqual({ fd: 21 })
  })

  it('M6 shares one stable scan across overlapping requests for the same identity', async () => {
    const fd = await install('fd')
    const gate = gateDirectories(new Set([fd]))
    const cache = application.get('CacheService')
    const first = manager.getToolInstalledSizes(['fd'])
    await gate.reached
    const duplicate = manager.getToolInstalledSizes(['fd'])
    await vi.waitFor(() =>
      expect(vi.mocked(cache.get).mock.calls.filter(([key]) => key === CACHE_KEY).length).toBeGreaterThanOrEqual(2)
    )
    gate.release()
    expect(await first).toEqual({ fd: 15 })
    expect(await duplicate).toEqual({ fd: 15 })
    expect(gate.opened.filter((candidate) => candidate === fd)).toHaveLength(1)
  })

  it('M6 permanently invalidates an old flight across stop and restart', async () => {
    const fd = await install('fd')
    const gate = gateDirectories(new Set([fd]))
    const old = manager.getToolInstalledSizes(['fd'])
    await gate.reached
    await manager._doStop()
    await manager._doInit()
    ;(manager as any).miseBin = '/fixture/mise'
    gate.release()
    expect(await old).toEqual({ fd: null })
    expect(await manager.getToolInstalledSizes(['fd'])).toEqual({ fd: 15 })
  })
})
