import type * as FsModule from 'node:fs'
import fs from 'node:fs'
import { mkdtemp, mkdir, rm, stat, utimes, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { MockMainPreferenceServiceUtils } from '@test-mocks/main/PreferenceService'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'

const fixture = vi.hoisted(() => ({
  files: { 'binding.node': 'binding!', 'runtime.dll': 'runtime!' },
  platform: 'test-platform',
  platforms: ['test-platform', 'darwin-arm64', 'linux-x64', 'linux-arm64', 'win32-x64', 'win32-arm64']
}))
vi.mock('node:fs', async (original) => {
  const actual = await original<typeof FsModule>()
  return { ...actual, createReadStream: vi.fn(actual.createReadStream) }
})
vi.mock('../../catalog/catalog', async (original) => {
  const actual = await original<typeof CatalogModule>()
  return {
    ...actual,
    getSharedArtifact: () => ({
      id: 'onnxruntime-node',
      version: '1.25.1',
      installDirKey: 'feature.onnxruntime.binary',
      platforms: Object.fromEntries(
        [...fixture.platforms, 'catalog-only'].map((key) => [
          key,
          {
            installSubdir: key,
            entryFile: 'binding.node',
            supportFiles: ['runtime.dll'],
            tarballSha256: 'archive'
          }
        ])
      )
    })
  }
})
vi.mock('../../catalog/types', async (original) => ({
  ...(await original<typeof CatalogTypesModule>()),
  currentPlatformKey: () => fixture.platform
}))
vi.mock('../../catalog/onnxRuntimeIntegrity.json', async () => {
  const { createHash } = await import('node:crypto')
  return {
    default: {
      artifact: 'onnxruntime-node',
      version: '1.25.1',
      tarballSha256: 'archive',
      platforms: Object.fromEntries(
        fixture.platforms.map((key) => [
          key,
          {
            files: Object.fromEntries(
              Object.entries(fixture.files).map(([name, bytes]) => [
                name,
                {
                  sizeBytes: bytes.length,
                  sha256: createHash('sha256').update(bytes).digest('hex')
                }
              ])
            )
          }
        ])
      )
    }
  }
})

import { createReadStream } from 'node:fs'

import type * as CatalogModule from '../../catalog/catalog'
import type * as CatalogTypesModule from '../../catalog/types'
import { verifyOnnxRuntimeIntegrity } from '../onnxRuntimeIntegrity'

let directory: string
beforeEach(async () => {
  fixture.platform = 'test-platform'
  MockMainPreferenceServiceUtils.setPreferenceValue('app.language', 'en-US')
  directory = await mkdtemp(path.join(os.tmpdir(), 'ort-integrity-'))
  vi.spyOn(application, 'getPath').mockReturnValue(directory)
  for (const [name, bytes] of Object.entries(fixture.files)) await writeFile(path.join(directory, name), bytes)
  vi.mocked(createReadStream).mockClear()
})
afterEach(async () => {
  vi.restoreAllMocks()
  await rm(directory, { recursive: true, force: true })
})

describe('ONNX Runtime pinned bytes', () => {
  it.each(fixture.platforms)(
    'accepts an unstamped %s runtime and skips hashing an unchanged repeat',
    async (platform) => {
      fixture.platform = platform
      const snapshot = await verifyOnnxRuntimeIntegrity(undefined)
      expect(snapshot.signature).toContain(directory)
      vi.mocked(createReadStream).mockClear()
      expect(await verifyOnnxRuntimeIntegrity(snapshot)).toBe(snapshot)
      expect(createReadStream).not.toHaveBeenCalled()
    }
  )

  it.each([
    ['binding.node', 'foreign!'],
    ['runtime.dll', 'foreign!'],
    ['runtime.dll', 'short'],
    ['runtime.dll', 'Runtime!']
  ])('rejects altered bytes in %s (%s)', async (file, bytes) => {
    await writeFile(path.join(directory, file), bytes)
    await expect(verifyOnnxRuntimeIntegrity(undefined)).rejects.toThrow(/does not match.*1.25.1/)
  })

  it.each(['missing', 'directory'])('rejects a %s expected file with recovery guidance', async (kind) => {
    const file = path.join(directory, 'runtime.dll')
    await rm(file)
    if (kind === 'directory') await mkdir(file)
    const error = await verifyOnnxRuntimeIntegrity(undefined).catch((error: Error) => error)
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toContain('runtime.dll')
    expect((error as Error).message).toContain(directory)
    expect((error as Error).message).toContain('remove only that runtime folder')
    if (kind === 'missing') expect(error).toHaveProperty('cause.code', 'ENOENT')
  })

  it('ignores sibling platform files', async () => {
    await mkdir(path.join(directory, 'sibling'))
    await writeFile(path.join(directory, 'sibling', 'runtime.dll'), 'foreign')
    await expect(verifyOnnxRuntimeIntegrity(undefined)).resolves.toHaveProperty('signature')
  })

  it.each(['changed size', 'same size', 'restored mtime'])(
    'invalidates a successful snapshot after %s replacement',
    async (mode) => {
      const snapshot = await verifyOnnxRuntimeIntegrity(undefined)
      const file = path.join(directory, 'runtime.dll')
      const before = await stat(file)
      await writeFile(file, mode === 'changed size' ? 'short' : 'foreign!')
      if (mode === 'restored mtime') await utimes(file, before.atime, before.mtime)
      await expect(verifyOnnxRuntimeIntegrity(snapshot)).rejects.toThrow(/does not match/)
    }
  )

  it('re-evaluates deletion and restoration after success', async () => {
    const snapshot = await verifyOnnxRuntimeIntegrity(undefined)
    const file = path.join(directory, 'runtime.dll')
    await rm(file)
    await expect(verifyOnnxRuntimeIntegrity(snapshot)).rejects.toThrow(/missing or cannot be verified/)
    await writeFile(file, fixture.files['runtime.dll'])
    await expect(verifyOnnxRuntimeIntegrity(snapshot)).resolves.toHaveProperty('signature')
  })

  it.each(['binding!', 'foreign!'])('rejects a file changed during hashing (%s) as unavailable', async (bytes) => {
    vi.mocked(createReadStream).mockImplementationOnce((filename, options) => {
      const stream = fs.createReadStream(filename, options)
      stream.on('end', () => fs.writeFileSync(filename, bytes))
      return stream
    })
    await expect(verifyOnnxRuntimeIntegrity(undefined)).rejects.toThrow(/missing or cannot be verified/)
  })

  it.each(['unknown', 'catalog-only'])('fails closed when %s has no complete catalog/table entry', async (platform) => {
    fixture.platform = platform
    await expect(verifyOnnxRuntimeIntegrity(undefined)).rejects.toThrow(/missing or cannot be verified/)
  })

  it('does not reuse a successful snapshot after changing the resolved directory', async () => {
    const previous = await verifyOnnxRuntimeIntegrity(undefined)
    const moved = path.join(directory, 'moved')
    await mkdir(moved)
    for (const [name, bytes] of Object.entries(fixture.files)) await writeFile(path.join(moved, name), bytes)
    vi.mocked(application.getPath).mockReturnValue(moved)
    vi.mocked(createReadStream).mockClear()
    const next = await verifyOnnxRuntimeIntegrity(previous)
    expect(next.signature).not.toBe(previous.signature)
    expect(createReadStream).toHaveBeenCalledTimes(2)
  })

  it.each(['mismatch', 'unavailable'])('resolves Chinese recovery instructions for %s', async (kind) => {
    MockMainPreferenceServiceUtils.setPreferenceValue('app.language', 'zh-CN')
    const file = path.join(directory, 'runtime.dll')
    if (kind === 'mismatch') await writeFile(file, 'foreign!')
    else await rm(file)
    const error = await verifyOnnxRuntimeIntegrity(undefined).catch((error: Error) => error)
    expect(error).toBeInstanceOf(Error)
    for (const text of [
      '1.25.1',
      directory,
      'runtime.dll',
      '完全退出',
      '仅删除该运行时文件夹',
      '下载',
      '重试或重新索引'
    ])
      expect((error as Error).message).toContain(text)
    expect((error as Error).message).not.toContain('{{')
  })

  it('keeps read failures as the cause of the localized unavailable error', async () => {
    const cause = Object.assign(new Error('permission denied'), { code: 'EACCES' })
    vi.mocked(createReadStream).mockImplementationOnce(() => {
      throw cause
    })
    const error = await verifyOnnxRuntimeIntegrity(undefined).catch((error: Error) => error)
    expect(error).toHaveProperty('cause', cause)
    expect((error as Error).message).toContain('missing or cannot be verified')
    expect((error as Error).message).toContain('binding.node')
  })

  it('preserves the original abort reason during hashing', async () => {
    const controller = new AbortController()
    const reason = new Error('cancel active hashing')
    vi.mocked(createReadStream).mockImplementationOnce((filename, options) => {
      const stream = fs.createReadStream(filename, options)
      stream.on('data', () => controller.abort(reason))
      return stream
    })
    await expect(verifyOnnxRuntimeIntegrity(undefined, controller.signal)).rejects.toBe(reason)
  })

  it('preserves the caller abort reason', async () => {
    const controller = new AbortController()
    const reason = new Error('cancel integrity scan')
    controller.abort(reason)
    await expect(verifyOnnxRuntimeIntegrity(undefined, controller.signal)).rejects.toBe(reason)
  })
})
