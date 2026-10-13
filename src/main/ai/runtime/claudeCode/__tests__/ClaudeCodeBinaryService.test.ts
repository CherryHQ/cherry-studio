import { createHash } from 'node:crypto'
import type * as FsPromises from 'node:fs/promises'
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { net } from 'electron'
import { create } from 'tar'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import { BaseService } from '@main/core/lifecycle'
import { regionService } from '@main/services/RegionService'

import { claudeCodeBinaryManifest } from '../binaryManifest'
import { claudeBinaryTarget, ClaudeCodeBinaryService } from '../ClaudeCodeBinaryService'

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof FsPromises>()
  return { ...actual, rm: vi.fn(actual.rm), mkdtemp: vi.fn(actual.mkdtemp) }
})

vi.mock('../binaryManifest', () => ({ claudeCodeBinaryManifest: { version: '1.2.3', packages: {} } }))
vi.mock('@main/services/RegionService', () => ({ regionService: { isInChina: vi.fn() } }))

let root: string
let archive: Buffer
let service: ClaudeCodeBinaryService
const filename = process.platform === 'win32' ? 'claude.exe' : 'claude'

async function settled(instance = service) {
  await vi.waitFor(() => expect(['ready', 'error']).toContain(instance.getStatus().phase))
  return instance.getStatus()
}

beforeEach(async () => {
  BaseService.resetInstances()
  root = await mkdtemp(path.join(os.tmpdir(), 'claude-install-'))
  await mkdir(path.join(root, 'fixture/package'), { recursive: true })
  await writeFile(path.join(root, 'fixture/package', filename), 'native-cli-fixture')
  await writeFile(path.join(root, 'fixture/package', 'unexpected.txt'), 'must not extract')
  await create({ gzip: true, file: path.join(root, 'fixture.tgz'), cwd: path.join(root, 'fixture') }, ['package'])
  archive = await readFile(path.join(root, 'fixture.tgz'))
  for (const target of [
    'darwin-arm64',
    'darwin-x64',
    'linux-arm64',
    'linux-arm64-musl',
    'linux-x64',
    'linux-x64-musl',
    'win32-arm64',
    'win32-x64'
  ]) {
    claudeCodeBinaryManifest.packages[target] = {
      name: `@anthropic-ai/claude-agent-sdk-${target}`,
      integrity: `sha512-${createHash('sha512').update(archive).digest('base64')}`
    }
  }
  claudeCodeBinaryManifest.version = '1.2.3'
  vi.mocked(application.getPath).mockReturnValue(root)
  vi.mocked(regionService.isInChina).mockResolvedValue(false)
  vi.mocked(net.fetch)
    .mockReset()
    .mockImplementation(
      async () => new Response(new Uint8Array(archive), { headers: { 'content-length': String(archive.length) } })
    )
  service = new ClaudeCodeBinaryService()
})
afterEach(async () => {
  await service._doStop()
  await rm(root, { recursive: true, force: true })
})

describe('Claude runtime acquisition', () => {
  it.each([
    ['darwin', 'arm64', undefined, 'darwin-arm64'],
    ['win32', 'x64', undefined, 'win32-x64'],
    ['linux', 'arm64', '2.36', 'linux-arm64'],
    ['linux', 'x64', undefined, 'linux-x64-musl']
  ])('selects the native ABI for %s/%s', (platform, arch, glibc, expected) => {
    expect(claudeBinaryTarget(platform, arch, glibc)).toBe(expected)
  })

  it('starts downloading after application startup without waiting for the network or opening an agent', async () => {
    let release!: () => void
    const network = new Promise<void>((resolve) => {
      release = resolve
    })
    vi.mocked(net.fetch).mockImplementation(async () => {
      await network
      return new Response(new Uint8Array(archive))
    })
    try {
      await service._doAllReady()
      expect(service.getStatus().phase).toBe('downloading')
      expect(() => service.requireExecutable()).toThrow()
      service.ensure()
    } finally {
      release()
    }
    expect((await settled()).phase).toBe('ready')
    expect(await readFile(service.requireExecutable(), 'utf8')).toBe('native-cli-fixture')
    expect(vi.mocked(net.fetch).mock.calls).toHaveLength(1)
  })

  it('installs a verified exact version once, rejects use before completion, and survives restart', async () => {
    expect(() => service.requireExecutable()).toThrow()
    service.ensure()
    service.ensure()
    expect(service.getStatus().phase).toBe('downloading')
    expect((await settled()).phase).toBe('ready')
    const executable = service.requireExecutable()
    expect(executable).toContain(`${path.sep}1.2.3${path.sep}`)
    expect(await readFile(executable, 'utf8')).toBe('native-cli-fixture')
    expect(await readdir(path.dirname(executable))).toEqual(expect.arrayContaining([filename, 'installed.json']))
    expect(await readdir(path.dirname(executable))).not.toContain('unexpected.txt')
    expect(vi.mocked(net.fetch).mock.calls).toHaveLength(1)
    expect(String(vi.mocked(net.fetch).mock.calls[0][0])).toContain('-1.2.3.tgz')
    BaseService.resetInstances()
    const restarted = new ClaudeCodeBinaryService()
    await restarted._doAllReady()
    expect(restarted.getStatus().phase).toBe('ready')
    expect(vi.mocked(net.fetch).mock.calls).toHaveLength(1)
    expect(restarted.requireExecutable()).toBe(executable)
    await restarted._doStop()
    claudeCodeBinaryManifest.version = '1.2.4'
    BaseService.resetInstances()
    expect(new ClaudeCodeBinaryService().getStatus().phase).toBe('missing')
  })

  it('prepares the runtime without a renderer and shares an in-flight download with concurrent callers', async () => {
    let release!: () => void
    const downloading = new Promise<void>((resolve) => {
      release = resolve
    })
    vi.mocked(net.fetch).mockImplementation(async () => {
      await downloading
      return new Response(new Uint8Array(archive))
    })
    let completed = 0
    const prepare = () =>
      service.ensureExecutable().then((executable) => {
        completed++
        return executable
      })
    const first = prepare()
    const second = prepare()
    await vi.waitFor(() => expect(service.getStatus().phase).toBe('downloading'))
    expect(completed).toBe(0)
    expect(() => service.requireExecutable()).toThrow()
    release()
    const executables = await Promise.all([first, second])
    expect(executables[0]).toBe(executables[1])
    expect(await readFile(executables[0], 'utf8')).toBe('native-cli-fixture')
    expect(vi.mocked(net.fetch).mock.calls).toHaveLength(1)
    expect(service.getStatus().phase).toBe('ready')
  })

  it('rejects background preparation on failure and joins an explicit retry', async () => {
    vi.mocked(net.fetch).mockRejectedValue(new Error('offline'))
    await expect(service.ensureExecutable()).rejects.toThrow()
    expect(service.getStatus()).toMatchObject({ phase: 'error', error: 'network' })
    await expect(service.ensureExecutable()).rejects.toThrow()
    expect(vi.mocked(net.fetch).mock.calls).toHaveLength(2)
    vi.mocked(net.fetch).mockImplementation(async () => new Response(new Uint8Array(archive)))
    service.ensure(true)
    const executable = await service.ensureExecutable()
    expect(await readFile(executable, 'utf8')).toBe('native-cli-fixture')
  })

  it('removes other versions only after a successful install, preserving unrelated entries', async () => {
    await mkdir(path.join(root, '1.2.2'))
    await writeFile(path.join(root, '1.2.2', 'old-cli'), 'old')
    await mkdir(path.join(root, 'notes'))
    await mkdir(path.join(root, '.download-other'))
    await symlink(path.join(root, 'notes'), path.join(root, '1.0.0'), 'junction')
    vi.mocked(net.fetch).mockRejectedValue(new Error('offline'))
    service.ensure()
    expect((await settled()).phase).toBe('error')
    expect(await readFile(path.join(root, '1.2.2', 'old-cli'), 'utf8')).toBe('old')
    vi.mocked(net.fetch).mockImplementation(async () => new Response(new Uint8Array(archive)))
    service.ensure(true)
    expect((await settled()).phase).toBe('ready')
    await service._doStop()
    expect(await readdir(root)).not.toContain('1.2.2')
    expect(await readdir(root)).toEqual(expect.arrayContaining(['1.2.3', 'notes', '.download-other', '1.0.0']))
    expect(await readFile(service.requireExecutable(), 'utf8')).toBe('native-cli-fixture')
  })

  it('cleans leftover versions when the current version is already installed without downloading again', async () => {
    service.ensure()
    await settled()
    await service._doStop()
    await mkdir(path.join(root, '1.2.2'))
    vi.mocked(net.fetch).mockRejectedValue(new Error('must remain usable offline'))
    BaseService.resetInstances()
    const restarted = new ClaudeCodeBinaryService()
    expect(restarted.ensure().phase).toBe('ready')
    await restarted._doStop()
    expect(await readdir(root)).not.toContain('1.2.2')
    expect(await readFile(restarted.requireExecutable(), 'utf8')).toBe('native-cli-fixture')
  })

  it('keeps the current version usable when an old version cannot be removed, and retries cleanup later', async () => {
    await mkdir(path.join(root, '1.2.2'))
    const { rm: realRm } = await vi.importActual<typeof FsPromises>('node:fs/promises')
    vi.mocked(rm).mockImplementation(async (entry, options) => {
      if (entry === path.join(root, '1.2.2')) throw Object.assign(new Error('locked'), { code: 'EPERM' })
      return realRm(entry, options)
    })
    try {
      service.ensure()
      expect((await settled()).phase).toBe('ready')
      await service._doStop()
      expect(await readdir(root)).toContain('1.2.2')
      expect(await readFile(service.requireExecutable(), 'utf8')).toBe('native-cli-fixture')
    } finally {
      vi.mocked(rm).mockImplementation(realRm)
    }
    service.ensure()
    await service._doStop()
    expect(await readdir(root)).not.toContain('1.2.2')
  })

  it.each([false, true])(
    'preserves the installation outcome when staging cleanup fails (corrupt=%s)',
    async (corrupt) => {
      const { rm: realRm } = await vi.importActual<typeof FsPromises>('node:fs/promises')
      vi.mocked(rm).mockImplementation(async (entry, options) => {
        if (path.basename(String(entry)).startsWith('.download-')) {
          throw Object.assign(new Error('staging file locked'), { code: 'EPERM' })
        }
        return realRm(entry, options)
      })
      try {
        if (corrupt) vi.mocked(net.fetch).mockImplementation(async () => new Response('corrupt'))
        if (corrupt) {
          await expect(service.ensureExecutable()).rejects.toThrow()
          expect(service.getStatus()).toMatchObject({ phase: 'error', error: 'integrity' })
        } else {
          const executable = await service.ensureExecutable()
          expect(service.getStatus().phase).toBe('ready')
          expect(await readFile(executable, 'utf8')).toBe('native-cli-fixture')
          expect(await service.ensureExecutable()).toBe(executable)
          expect(vi.mocked(net.fetch).mock.calls).toHaveLength(1)
        }
      } finally {
        vi.mocked(rm).mockImplementation(realRm)
      }
    }
  )

  it.each([true, false])('falls back from the regional source (%s) to a verified download', async (china) => {
    vi.mocked(regionService.isInChina).mockResolvedValue(china)
    vi.mocked(net.fetch).mockRejectedValueOnce(new Error('offline'))
    service.ensure()
    expect((await settled()).phase).toBe('ready')
    const urls = vi.mocked(net.fetch).mock.calls.map(([url]) => String(url))
    expect(urls[0]).toContain(china ? 'npmmirror.com' : 'npmjs.org')
    expect(urls[1]).toContain(china ? 'npmjs.org' : 'npmmirror.com')
  })

  it('does not publish corrupt bytes or automatically restart a failed attempt; explicit retry repairs it', async () => {
    vi.mocked(net.fetch).mockImplementation(async () => new Response('corrupt'))
    service.ensure()
    expect(await settled()).toMatchObject({ phase: 'error', error: 'integrity' })
    expect(() => service.requireExecutable()).toThrow()
    service.ensure()
    expect(vi.mocked(net.fetch).mock.calls).toHaveLength(2)
    vi.mocked(net.fetch).mockImplementation(async () => new Response(new Uint8Array(archive)))
    service.ensure(true)
    expect((await settled()).phase).toBe('ready')
    expect((await readdir(root)).filter((name) => name.startsWith('.download-'))).toEqual([])
  })

  it('rejects a truncated stream and leaves no ready installation', async () => {
    vi.mocked(net.fetch).mockImplementation(
      async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new Uint8Array([1, 2]))
              controller.error(new Error('interrupted'))
            }
          })
        )
    )
    service.ensure()
    expect(await settled()).toMatchObject({ phase: 'error', error: 'network' })
    expect(() => service.requireExecutable()).toThrow()
  })

  it('times out a stalled source and completes through the fallback', async () => {
    vi.useFakeTimers()
    try {
      vi.mocked(net.fetch).mockImplementationOnce(
        (_url, options) =>
          new Promise((_resolve, reject) => {
            options?.signal?.addEventListener('abort', () => reject(options.signal?.reason), { once: true })
          })
      )
      service.ensure()
      await vi.waitFor(() => expect(vi.mocked(net.fetch).mock.calls.length).toBe(1))
      await vi.advanceTimersByTimeAsync(30_000)
      expect((await settled()).phase).toBe('ready')
      expect(await readFile(service.requireExecutable(), 'utf8')).toBe('native-cli-fixture')
    } finally {
      vi.useRealTimers()
    }
  })

  it('aborts an in-flight stream on shutdown without publishing an executable', async () => {
    vi.mocked(net.fetch).mockImplementation(
      async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new Uint8Array([1]))
            }
          })
        )
    )
    service.ensure()
    await vi.waitFor(() => expect(service.getStatus().receivedBytes).toBe(1))
    await service._doStop()
    expect(service.getStatus().phase).toBe('error')
    expect(() => service.requireExecutable()).toThrow()
    expect((await readdir(root)).filter((name) => name.startsWith('.download-'))).toEqual([])
  })

  it('does not download an unsupported architecture', () => {
    claudeCodeBinaryManifest.packages = {}
    expect(service.ensure()).toMatchObject({ phase: 'error', error: 'unsupported' })
    expect(() => service.requireExecutable()).toThrow()
    expect(vi.mocked(net.fetch).mock.calls).toHaveLength(0)
  })

  it.each(['ENOENT', 'EINVAL', 'EEXIST'])('reports staging directory failures as storage errors (%s)', async (code) => {
    vi.mocked(mkdtemp).mockRejectedValueOnce(Object.assign(new Error('Cannot create staging directory'), { code }))
    service.ensure()
    expect(await settled()).toMatchObject({ phase: 'error', error: 'storage' })
    expect(() => service.requireExecutable()).toThrow()
    expect(vi.mocked(net.fetch).mock.calls).toHaveLength(0)
  })

  it('reports storage failures without treating them as a complete installation', async () => {
    const file = path.join(root, 'not-a-directory')
    await writeFile(file, '')
    vi.mocked(application.getPath).mockReturnValue(file)
    service.ensure()
    expect(await settled()).toMatchObject({ phase: 'error', error: 'storage' })
    expect(() => service.requireExecutable()).toThrow()
  })
})
