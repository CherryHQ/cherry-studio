import { createHash } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import type { UpdateInfo, VelopackAsset } from 'velopack'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  getVelopackChannel,
  getVelopackFeedUrl,
  validateAsset,
  VelopackBackend,
  verifyPackage
} from '../velopackBackend'

const sdk = vi.hoisted(() => ({ resolve: vi.fn(), download: vi.fn(), sourceUrl: '' }))
vi.mock('velopack', () => ({
  HttpSource: class {
    constructor(public url: string) {}
  },
  UpdateManager: class {
    constructor(source: { url: string }) {
      sdk.sourceUrl = source.url
    }
    getAppId() {
      return 'CherryStudio-global'
    }
    getCurrentVersion() {
      return '2.0.0'
    }
    checkForUpdatesAsync = sdk.resolve
    downloadUpdateAsync = sdk.download
  }
}))

describe('Velopack package boundary', () => {
  let directory: string
  const contents = Buffer.from('complete package content')
  const asset: VelopackAsset = {
    PackageId: 'CherryStudio-global',
    Version: '2.1.0',
    Type: 'Full',
    FileName: 'CherryStudio-global-2.1.0-win-x64-global-full.nupkg',
    SHA256: createHash('sha256').update(contents).digest('hex'),
    SHA1: '',
    Size: contents.length,
    NotesMarkdown: '',
    NotesHtml: ''
  }
  beforeEach(async () => {
    vi.resetAllMocks()
    directory = await mkdtemp(path.join(tmpdir(), 'cherry-update-test-'))
  })

  async function backend(delta: boolean, host = 'github.com') {
    const target: UpdateInfo = {
      TargetFullRelease: asset,
      BaseRelease: delta ? { ...asset, Version: '2.0.0', FileName: 'base-full.nupkg' } : undefined,
      DeltasToTarget: delta ? [{ ...asset, Type: 'Delta' }] : [],
      IsDowngrade: false
    }
    sdk.resolve.mockResolvedValue(target)
    const instance = new VelopackBackend(
      {
        RootAppDir: directory,
        CurrentBinaryDir: directory,
        UpdateExePath: path.join(directory, 'Update.exe'),
        ManifestPath: path.join(directory, 'sq.version'),
        PackagesDir: directory,
        IsPortable: false
      },
      'global',
      'win-x64-global',
      '2.0.0'
    )
    await instance.resolve('2.1.0', [
      new URL(`https://${host}/CherryHQ/cherry-studio/releases/download/v2.1.0/setup.exe`)
    ])
    return instance
  }

  it.each([false, true])('prepares a verified GitCode package (delta: %s) without switching source', async (delta) => {
    sdk.download.mockImplementation(async () => {
      if (sdk.sourceUrl !== 'https://gitcode.com/CherryHQ/cherry-studio/releases/download/v2.1.0/') {
        throw new Error('Wrong download source')
      }
      await writeFile(path.join(directory, asset.FileName), contents)
    })
    const instance = await backend(delta, 'gitcode.com')
    expect(sdk.sourceUrl).toBe('https://gitcode.com/CherryHQ/cherry-studio/releases/download/v2.1.0/')
    await instance.prepare(() => {})
    await expect(instance.verify()).resolves.toBeUndefined()
  })

  it('accepts an SDK-reconstructed ZIP but rejects a subsequent same-size mutation', async () => {
    const rebuilt = Buffer.from('equivalent package with different ZIP encoding')
    sdk.download.mockImplementation(() => writeFile(path.join(directory, asset.FileName), rebuilt))
    const instance = await backend(true)
    await instance.prepare(() => {})
    await expect(instance.verify()).resolves.toBeUndefined()
    await writeFile(path.join(directory, asset.FileName), Buffer.alloc(rebuilt.length))
    await expect(instance.verify()).rejects.toThrow('CHECKSUM_MISMATCH')
  })

  it('does not bless an unverified cached ZIP just because a delta is available', async () => {
    await writeFile(path.join(directory, asset.FileName), 'untrusted cached reconstruction')
    sdk.download.mockRejectedValue(new Error('NETWORK'))
    const instance = await backend(true)
    await expect(instance.prepare(() => {})).rejects.toThrow('NETWORK')
    await expect(instance.verify()).rejects.toThrow('STALE_CANDIDATE')
    expect(() => instance.createHandoff()).toThrow('STALE_CANDIDATE')
  })

  it('does not prepare output from a failed SDK reconstruction', async () => {
    sdk.download.mockImplementation(async () => {
      await writeFile(path.join(directory, asset.FileName), 'incomplete reconstruction')
      throw new Error('PATCH_FAILED')
    })
    const instance = await backend(true)
    await expect(instance.prepare(() => {})).rejects.toThrow('PATCH_FAILED')
    await expect(instance.verify()).rejects.toThrow('STALE_CANDIDATE')
  })

  it('still requires the published digest for a full download', async () => {
    sdk.download.mockImplementation(() =>
      writeFile(path.join(directory, asset.FileName), Buffer.alloc(contents.length))
    )
    const instance = await backend(false)
    await expect(instance.prepare(() => {})).rejects.toThrow('CHECKSUM_MISMATCH')
    await expect(instance.verify()).rejects.toThrow('STALE_CANDIDATE')
  })
  afterEach(async () => {
    await rm(directory, { recursive: true, force: true })
  })

  it('rejects a same-sized corrupt cached package before installation', async () => {
    await writeFile(path.join(directory, asset.FileName), contents)
    await expect(verifyPackage(directory, asset)).resolves.toBeUndefined()
    await writeFile(path.join(directory, asset.FileName), Buffer.alloc(contents.length))
    await expect(verifyPackage(directory, asset)).rejects.toThrow('CHECKSUM_MISMATCH')
  })

  it('rejects missing and truncated packages', async () => {
    await expect(verifyPackage(directory, asset)).rejects.toThrow()
    await writeFile(path.join(directory, asset.FileName), 'short')
    await expect(verifyPackage(directory, asset)).rejects.toThrow('INVALID_PACKAGE')
  })

  it('rejects traversal, a different edition and a different selected version', () => {
    expect(() => validateAsset({ ...asset, FileName: '../outside-full.nupkg' }, '2.1.0', asset.PackageId)).toThrow()
    expect(() => validateAsset(asset, '2.1.0', 'CherryStudio-cn')).toThrow()
    expect(() => validateAsset(asset, '2.2.0', asset.PackageId)).toThrow()
  })

  it('isolates platforms, architectures and editions in static feeds', () => {
    expect(getVelopackChannel('win32', 'x64', 'global')).toBe('win-x64-global')
    expect(getVelopackChannel('darwin', 'arm64', 'cn')).toBe('osx-arm64-cn')
    expect(getVelopackChannel('linux', 'arm64', 'global')).toBe('linux-arm64-global')
    expect(() => getVelopackChannel('win32', 'ia32', 'global')).toThrow('UNSUPPORTED_INSTALL')
  })

  it.each(['github.com', 'gitcode.com'])('keeps the selected %s host and exact prerelease tag', (host) => {
    const url = new URL(`https://${host}/CherryHQ/cherry-studio/releases/download/v2.2.0-rc.1/setup.exe?download=1`)
    expect(getVelopackFeedUrl('2.2.0-rc.1', [url])).toBe(
      `https://${host}/CherryHQ/cherry-studio/releases/download/v2.2.0-rc.1/`
    )
  })

  it.each([
    'https://gitcode.com/CherryHQ/cherry-studio/releases/download/v2.2.0/setup.exe',
    'https://gitcode.com/other/repo/releases/download/v2.1.0/setup.exe',
    'https://gitcode.com.evil.test/CherryHQ/cherry-studio/releases/download/v2.1.0/setup.exe',
    'http://gitcode.com/CherryHQ/cherry-studio/releases/download/v2.1.0/setup.exe',
    'https://token@gitcode.com/CherryHQ/cherry-studio/releases/download/v2.1.0/setup.exe'
  ])('rejects a mismatched or untrusted selected URL: %s', (url) => {
    expect(() => getVelopackFeedUrl('2.1.0', [new URL(url)])).toThrow('INVALID_PACKAGE')
  })

  it('rejects missing and conflicting mirror decisions instead of falling back to GitHub', () => {
    expect(() => getVelopackFeedUrl('2.1.0', [])).toThrow('INVALID_PACKAGE')
    expect(() =>
      getVelopackFeedUrl(
        '2.1.0',
        ['github.com', 'gitcode.com'].map(
          (host) => new URL(`https://${host}/CherryHQ/cherry-studio/releases/download/v2.1.0/setup.exe`)
        )
      )
    ).toThrow('INVALID_PACKAGE')
  })
})
