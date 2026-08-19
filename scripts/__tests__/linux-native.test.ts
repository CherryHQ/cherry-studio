import * as crypto from 'node:crypto'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  ARCH_TO_ELF_MACHINE,
  getNativeArtifactPaths,
  parseVersionRequirements,
  readProjectBuildMetadata,
  replacePackagedBetterSqlite3,
  verifyNativeArtifact
} from '../linux-native/compat'
import { ensureLinuxNativeArtifact, readReleaseConfig } from '../linux-native/download'

type Arch = 'x64' | 'arm64'

const projectRoot = path.resolve(__dirname, '..', '..')
const metadata = {
  electronVersion: '41.8.0',
  electronAbi: '145',
  betterSqlite3Version: '12.11.1'
}

let tmpDirs: string[] = []

function sha256(buffer: Buffer): string {
  return crypto.createHash('sha256').update(buffer).digest('hex')
}

function makeTmpDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'linux-native-test-'))
  tmpDirs.push(dir)
  return dir
}

function fakeAddon(arch: Arch, requirements = ['GLIBC_2.28', 'GLIBCXX_3.4.20', 'CXXABI_1.3.9']): Buffer {
  const header = Buffer.alloc(64)
  Buffer.from([0x7f, 0x45, 0x4c, 0x46]).copy(header)
  header[4] = 2
  header[5] = 1
  header.writeUInt16LE(ARCH_TO_ELF_MACHINE[arch], 18)
  return Buffer.concat([header, Buffer.from(`\0${requirements.join('\0')}\0`)])
}

function manifestFor(addon: Buffer, arch: Arch) {
  return {
    schemaVersion: 2,
    platform: 'linux',
    arch,
    ...metadata,
    sha256: sha256(addon),
    requirements: parseVersionRequirements(addon.toString('latin1'))
  }
}

function writeArtifact(root: string, arch: Arch, requirements?: string[]): ReturnType<typeof getNativeArtifactPaths> {
  const paths = getNativeArtifactPaths(root, arch)
  const addon = fakeAddon(arch, requirements)
  fs.mkdirSync(paths.outputDir, { recursive: true })
  fs.writeFileSync(paths.addonPath, addon)
  fs.writeFileSync(paths.manifestPath, `${JSON.stringify(manifestFor(addon, arch), null, 2)}\n`)
  return paths
}

function downloadFixture(arch: Arch) {
  const addon = fakeAddon(arch)
  const manifest = Buffer.from(`${JSON.stringify(manifestFor(addon, arch), null, 2)}\n`)
  const assets = {
    addon: { name: `better_sqlite3-linux-${arch}.node`, sha256: sha256(addon) },
    manifest: { name: `better_sqlite3-linux-${arch}.manifest.json`, sha256: sha256(manifest) }
  }
  const config = {
    schemaVersion: 1,
    repository: 'CherryHQ/cherry-studio-better-sqlite3',
    tag: 'better-sqlite3-v12.11.1-electron-v41.8.0-r1',
    metadata,
    artifacts: { [arch]: assets }
  }
  const files = new Map([
    [assets.addon.name, addon],
    [assets.manifest.name, manifest]
  ])
  const downloadImpl = vi.fn((url: string, destination: string) => {
    const name = decodeURIComponent(url.slice(url.lastIndexOf('/') + 1))
    const body = files.get(name)
    if (!body) throw new Error(`Missing download fixture: ${name}`)
    fs.writeFileSync(destination, body)
  })
  return { config, downloadImpl }
}

afterEach(() => {
  for (const dir of tmpDirs) fs.rmSync(dir, { recursive: true, force: true })
  tmpDirs = []
})

describe('Linux native compatibility manifest', () => {
  it('records the highest requirement for each ABI family', () => {
    expect(parseVersionRequirements('GLIBC_2.17 GLIBC_2.28 GLIBCXX_3.4.18 GLIBCXX_3.4.20 CXXABI_1.3.9')).toEqual({
      glibc: '2.28',
      glibcxx: '3.4.20',
      cxxabi: '1.3.9'
    })
  })

  it.each(['x64', 'arm64'] as const)('accepts a compatible %s artifact', (arch) => {
    const paths = writeArtifact(makeTmpDir(), arch)
    expect(verifyNativeArtifact({ ...paths, expected: { ...metadata, arch } }).inspection).toMatchObject({
      arch,
      requirements: {
        glibc: '2.28',
        glibcxx: '3.4.20',
        cxxabi: '1.3.9'
      }
    })
  })

  it('rejects an artifact requiring a newer GLIBC', () => {
    const paths = writeArtifact(makeTmpDir(), 'x64', ['GLIBC_2.29', 'GLIBCXX_3.4.20', 'CXXABI_1.3.9'])
    expect(() => verifyNativeArtifact({ ...paths, expected: { ...metadata, arch: 'x64' } })).toThrow(/GLIBC_2\.29/)
  })

  it('rejects the wrong architecture, stale metadata, and modified bytes', () => {
    const paths = writeArtifact(makeTmpDir(), 'x64')
    expect(() => verifyNativeArtifact({ ...paths, expected: { ...metadata, arch: 'arm64' } })).toThrow(
      /manifest field arch/
    )
    expect(() =>
      verifyNativeArtifact({ ...paths, expected: { ...metadata, electronVersion: '42.0.0', arch: 'x64' } })
    ).toThrow(/manifest field electronVersion/)

    fs.appendFileSync(paths.addonPath, 'modified')
    expect(() => verifyNativeArtifact({ ...paths, expected: { ...metadata, arch: 'x64' } })).toThrow(
      /checksum mismatch/
    )
  })
})

describe('Linux native release download', () => {
  it.each(['x64', 'arm64'] as const)('downloads and then reuses the verified %s artifact', (arch) => {
    const root = makeTmpDir()
    const { config, downloadImpl } = downloadFixture(arch)

    const downloaded = ensureLinuxNativeArtifact({ projectRoot: root, arch, config, metadata, downloadImpl })
    expect(downloaded.cached).toBe(false)
    expect(downloadImpl).toHaveBeenCalledTimes(2)
    expect(downloadImpl.mock.calls[0][0]).toContain(`/releases/download/${config.tag}/`)

    downloadImpl.mockClear()
    const cached = ensureLinuxNativeArtifact({ projectRoot: root, arch, config, metadata, downloadImpl })
    expect(cached.cached).toBe(true)
    expect(downloadImpl).not.toHaveBeenCalled()
  })

  it('rejects a stale release before downloading', () => {
    const root = makeTmpDir()
    const { config, downloadImpl } = downloadFixture('x64')
    config.metadata = { ...metadata, electronVersion: '42.0.0' }

    expect(() => ensureLinuxNativeArtifact({ projectRoot: root, arch: 'x64', config, metadata, downloadImpl })).toThrow(
      /field electronVersion is stale/
    )
    expect(downloadImpl).not.toHaveBeenCalled()
  })

  it('rejects a release asset whose pinned checksum is wrong', () => {
    const root = makeTmpDir()
    const { config, downloadImpl } = downloadFixture('x64')
    config.artifacts.x64.addon.sha256 = '0'.repeat(64)

    expect(() => ensureLinuxNativeArtifact({ projectRoot: root, arch: 'x64', config, metadata, downloadImpl })).toThrow(
      /checksum mismatch/
    )
  })
})

describe('Linux package replacement', () => {
  it('replaces the packaged addon and verifies the copied bytes', () => {
    const root = makeTmpDir()
    const appOutDir = path.join(root, 'linux-unpacked')
    const paths = writeArtifact(root, 'x64')
    const destination = path.join(
      appOutDir,
      'resources',
      'app.asar.unpacked',
      'node_modules',
      'better-sqlite3',
      'build',
      'Release',
      'better_sqlite3.node'
    )
    fs.mkdirSync(path.dirname(destination), { recursive: true })
    fs.writeFileSync(destination, fakeAddon('x64', ['GLIBC_2.34']))

    expect(replacePackagedBetterSqlite3({ projectRoot: root, appOutDir, arch: 'x64', metadata }).destination).toBe(
      destination
    )
    expect(fs.readFileSync(destination)).toEqual(fs.readFileSync(paths.addonPath))
  })

  it('fails when the compatible artifact or packaged destination is missing', () => {
    const root = makeTmpDir()
    const appOutDir = path.join(root, 'linux-unpacked')
    expect(() => replacePackagedBetterSqlite3({ projectRoot: root, appOutDir, arch: 'x64', metadata })).toThrow(
      /Missing compatible/
    )

    writeArtifact(root, 'x64')
    expect(() => replacePackagedBetterSqlite3({ projectRoot: root, appOutDir, arch: 'x64', metadata })).toThrow(
      /Packaged better-sqlite3 artifact is missing/
    )
  })
})

describe('pinned Linux native release', () => {
  it('matches the installed Cherry Studio build inputs', () => {
    const config = readReleaseConfig()
    expect(config.metadata).toEqual(readProjectBuildMetadata(projectRoot))
    expect(config.repository).toBe('CherryHQ/cherry-studio-better-sqlite3')
    expect(config.tag).not.toContain('latest')
  })
})
