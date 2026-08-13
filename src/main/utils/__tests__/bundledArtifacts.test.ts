import crypto from 'node:crypto'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { zstdCompressSync } from 'node:zlib'

import type {
  BundledArtifactFile,
  BundledArtifactManifest,
  BundledTreeArtifact
} from '@main/utils/bundledArtifactManifest'
import { create as createTar } from 'tar'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ resourcesRoot: '' }))

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof fs & { default: typeof fs }>()
  return {
    ...actual,
    default: { ...actual, createReadStream: vi.fn(actual.createReadStream) }
  }
})

vi.mock('@application', () => ({
  application: {
    getPath: vi.fn(() => state.resourcesRoot)
  }
}))

import {
  cleanupOtherArtifactVersions,
  isBundledFileReady,
  isBundledTreeReady,
  materializeBundledFile,
  materializeBundledTree,
  withBundledArtifactLock
} from '../bundledArtifacts'

const tmpDirs: string[] = []

function makeTmpDir(prefix: string): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  tmpDirs.push(directory)
  return directory
}

function sha256(value: Buffer): string {
  return crypto.createHash('sha256').update(value).digest('hex')
}

function makeManifest(artifacts: BundledArtifactManifest['artifacts'] = {}): BundledArtifactManifest {
  return { schemaVersion: 1, platform: 'linux', arch: 'x64', artifacts }
}

function writeFileArtifact(payload: Buffer, archive = 'tool.zst'): BundledArtifactFile {
  const compressed = zstdCompressSync(payload)
  const platformDirectory = path.join(state.resourcesRoot, 'linux-x64')
  fs.mkdirSync(platformDirectory, { recursive: true })
  fs.writeFileSync(path.join(platformDirectory, archive), compressed)
  return {
    output: 'tool',
    archive,
    archiveSha256: sha256(compressed),
    sha256: sha256(payload),
    size: payload.length,
    mode: 0o755
  }
}

async function writeTreeArtifact(): Promise<BundledTreeArtifact> {
  const sourceDirectory = makeTmpDir('bundled-tree-source-')
  const treeRoot = path.join(sourceDirectory, 'git')
  const tarPath = path.join(sourceDirectory, 'mingit.tar')
  fs.mkdirSync(path.join(treeRoot, 'cmd'), { recursive: true })
  fs.mkdirSync(path.join(treeRoot, 'mingw64', 'bin'), { recursive: true })
  fs.writeFileSync(path.join(treeRoot, 'cmd', 'git.exe'), 'git-runtime', 'utf8')
  fs.writeFileSync(path.join(treeRoot, 'mingw64', 'bin', 'runtime.dll'), 'git-library', 'utf8')
  await createTar({ cwd: sourceDirectory, file: tarPath, noMtime: true, portable: true }, ['git'])
  const rawTar = fs.readFileSync(tarPath)
  const compressed = zstdCompressSync(rawTar)
  const platformDirectory = path.join(state.resourcesRoot, 'linux-x64')
  fs.mkdirSync(platformDirectory, { recursive: true })
  fs.writeFileSync(path.join(platformDirectory, 'mingit.tar.zst'), compressed)
  return {
    kind: 'tree',
    version: '2.54.0',
    archive: 'mingit.tar.zst',
    archiveSha256: sha256(compressed),
    sha256: sha256(rawTar),
    size: rawTar.length,
    entrypoints: ['git/cmd/git.exe'],
    files: [
      {
        path: 'git/cmd/git.exe',
        sha256: sha256(Buffer.from('git-runtime')),
        size: Buffer.byteLength('git-runtime'),
        mode: fs.statSync(path.join(treeRoot, 'cmd', 'git.exe')).mode & 0o777
      },
      {
        path: 'git/mingw64/bin/runtime.dll',
        sha256: sha256(Buffer.from('git-library')),
        size: Buffer.byteLength('git-library'),
        mode: fs.statSync(path.join(treeRoot, 'mingw64', 'bin', 'runtime.dll')).mode & 0o777
      }
    ]
  }
}

beforeEach(() => {
  state.resourcesRoot = makeTmpDir('bundled-resources-')
})

afterEach(() => {
  vi.restoreAllMocks()
  for (const directory of tmpDirs) fs.rmSync(directory, { recursive: true, force: true })
  tmpDirs.length = 0
})

describe('materializeBundledFile', () => {
  it('streams a verified payload into place and restores its executable mode', async () => {
    const payload = Buffer.alloc(1024 * 1024, 0x5a)
    const file = writeFileArtifact(payload)
    const destination = path.join(makeTmpDir('bundled-file-destination-'), 'tool')

    await materializeBundledFile(makeManifest(), file, destination)

    expect(fs.readFileSync(destination)).toEqual(payload)
    expect(await isBundledFileReady(file, destination)).toBe(true)
    if (process.platform !== 'win32') expect(fs.statSync(destination).mode & 0o777).toBe(0o755)
  })

  it('reads a valid compressed archive only once while hashing and decompressing it', async () => {
    const file = writeFileArtifact(Buffer.from('single-pass'))
    const archivePath = path.join(state.resourcesRoot, 'linux-x64', file.archive)
    const destination = path.join(makeTmpDir('bundled-file-single-pass-'), 'tool')
    const createReadStream = vi.mocked(fs.createReadStream)
    createReadStream.mockClear()

    await materializeBundledFile(makeManifest(), file, destination)

    expect(createReadStream.mock.calls.filter(([candidate]) => candidate === archivePath)).toHaveLength(1)
  })

  it.runIf(process.platform !== 'win32')('repairs a cache whose executable permission was removed', async () => {
    const payload = Buffer.from('executable')
    const file = writeFileArtifact(payload)
    const destination = path.join(makeTmpDir('bundled-file-permission-'), 'tool')
    fs.writeFileSync(destination, payload)
    fs.chmodSync(destination, 0o644)

    expect(await isBundledFileReady(file, destination)).toBe(false)
    await materializeBundledFile(makeManifest(), file, destination)

    expect(fs.statSync(destination).mode & 0o777).toBe(0o755)
  })

  it('rejects same-size cached content that no longer matches the manifest hash', async () => {
    const file = writeFileArtifact(Buffer.from('trusted'))
    const destination = path.join(makeTmpDir('bundled-file-tampered-'), 'tool')
    fs.writeFileSync(destination, 'altered', 'utf8')
    if (process.platform !== 'win32') fs.chmodSync(destination, 0o755)

    expect(await isBundledFileReady(file, destination)).toBe(false)
  })

  it('does not publish a payload whose original hash is wrong and removes its temporary file', async () => {
    const file = { ...writeFileArtifact(Buffer.from('new payload')), sha256: '0'.repeat(64) }
    const destinationDirectory = makeTmpDir('bundled-file-invalid-')
    const destination = path.join(destinationDirectory, 'tool')
    fs.writeFileSync(destination, 'old payload', 'utf8')

    await expect(materializeBundledFile(makeManifest(), file, destination)).rejects.toThrow(/checksum mismatch/)

    expect(fs.readFileSync(destination, 'utf8')).toBe('old payload')
    expect(fs.existsSync(path.join(state.resourcesRoot, 'linux-x64', file.archive))).toBe(true)
    expect(fs.readdirSync(destinationDirectory)).toEqual(['tool'])
  })

  it('rejects a damaged compressed archive before touching the installed file', async () => {
    const file = writeFileArtifact(Buffer.from('new payload'))
    const archivePath = path.join(state.resourcesRoot, 'linux-x64', file.archive)
    fs.appendFileSync(archivePath, 'damage')
    const destination = path.join(makeTmpDir('bundled-file-damaged-'), 'tool')
    fs.writeFileSync(destination, 'old payload', 'utf8')

    await expect(materializeBundledFile(makeManifest(), file, destination)).rejects.toThrow(/archive checksum mismatch/)

    expect(fs.readFileSync(destination, 'utf8')).toBe('old payload')
  })

  it('cleans its temporary file when a checksum-valid archive is not valid Zstd', async () => {
    const damagedArchive = Buffer.from('not a zstd stream')
    const file = writeFileArtifact(Buffer.from('new payload'))
    const archivePath = path.join(state.resourcesRoot, 'linux-x64', file.archive)
    fs.writeFileSync(archivePath, damagedArchive)
    file.archiveSha256 = sha256(damagedArchive)
    const destinationDirectory = makeTmpDir('bundled-file-invalid-zstd-')
    const destination = path.join(destinationDirectory, 'tool')

    await expect(materializeBundledFile(makeManifest(), file, destination)).rejects.toThrow()

    expect(fs.existsSync(destination)).toBe(false)
    expect(fs.readdirSync(destinationDirectory)).toEqual([])
  })

  it('restores the prior file if publishing the verified replacement fails', async () => {
    const file = writeFileArtifact(Buffer.from('new payload'))
    const destinationDirectory = makeTmpDir('bundled-file-busy-')
    const destination = path.join(destinationDirectory, 'tool')
    fs.writeFileSync(destination, 'old payload', 'utf8')
    const rename = fsp.rename.bind(fsp)
    vi.spyOn(fsp, 'rename').mockImplementation(async (source, target) => {
      if (String(source).startsWith(`${destination}.tmp-`) && target === destination) {
        throw Object.assign(new Error('busy'), { code: 'EBUSY' })
      }
      return rename(source, target)
    })

    await expect(materializeBundledFile(makeManifest(), file, destination)).rejects.toThrow('busy')

    expect(fs.readFileSync(destination, 'utf8')).toBe('old payload')
    expect(fs.readdirSync(destinationDirectory)).toEqual(['tool'])
  })
})

describe('tree payloads and version cleanup', () => {
  it('repairs a partial tree and publishes its marker only after extraction succeeds', async () => {
    const artifact = await writeTreeArtifact()
    const destination = path.join(makeTmpDir('bundled-tree-destination-'), 'current')
    fs.mkdirSync(path.join(destination, 'git'), { recursive: true })
    fs.writeFileSync(path.join(destination, 'git', 'partial.txt'), 'partial', 'utf8')

    expect(await isBundledTreeReady(artifact, destination)).toBe(false)
    await materializeBundledTree(makeManifest({ mingit: artifact }), artifact, destination)

    expect(fs.readFileSync(path.join(destination, 'git', 'cmd', 'git.exe'), 'utf8')).toBe('git-runtime')
    expect(fs.existsSync(path.join(destination, 'git', 'partial.txt'))).toBe(false)
    expect(await isBundledTreeReady(artifact, destination)).toBe(true)
  })

  it('rejects a marked cache when an internal runtime file is deleted or an entrypoint is changed', async () => {
    const artifact = await writeTreeArtifact()
    const destination = path.join(makeTmpDir('bundled-tree-integrity-'), 'current')
    await materializeBundledTree(makeManifest({ mingit: artifact }), artifact, destination)

    fs.rmSync(path.join(destination, 'git', 'mingw64', 'bin', 'runtime.dll'))
    expect(await isBundledTreeReady(artifact, destination)).toBe(false)

    await materializeBundledTree(makeManifest({ mingit: artifact }), artifact, destination)
    fs.writeFileSync(path.join(destination, 'git', 'cmd', 'git.exe'), 'evil-runtime', 'utf8')
    expect(await isBundledTreeReady(artifact, destination)).toBe(false)
  })

  it('rejects a marked cache containing a file absent from the declared inventory', async () => {
    const artifact = await writeTreeArtifact()
    const destination = path.join(makeTmpDir('bundled-tree-extra-file-'), 'current')
    await materializeBundledTree(makeManifest({ mingit: artifact }), artifact, destination)
    fs.writeFileSync(path.join(destination, 'git', 'cmd', 'injected.dll'), 'unexpected', 'utf8')

    expect(await isBundledTreeReady(artifact, destination)).toBe(false)
  })

  it('removes abandoned temporary siblings and preserves the published cache', async () => {
    const directory = makeTmpDir('bundled-stale-siblings-')
    const destination = path.join(directory, 'tool')
    fs.writeFileSync(destination, 'current', 'utf8')
    fs.writeFileSync(`${destination}.tmp-123-dead`, 'partial', 'utf8')
    fs.writeFileSync(`${destination}.old-123-dead`, 'previous', 'utf8')

    await withBundledArtifactLock(destination, async () => undefined)

    expect(fs.readFileSync(destination, 'utf8')).toBe('current')
    expect(fs.readdirSync(directory)).toEqual(['tool'])
  })

  it('recovers the previous cache when a crash happened between the two atomic renames', async () => {
    const directory = makeTmpDir('bundled-stale-backup-')
    const destination = path.join(directory, 'tool')
    fs.writeFileSync(`${destination}.old-123-dead`, 'previous', 'utf8')

    await withBundledArtifactLock(destination, async () => undefined)

    expect(fs.readFileSync(destination, 'utf8')).toBe('previous')
    expect(fs.readdirSync(directory)).toEqual(['tool'])
  })

  it('removes old versions only after the caller has installed the current version', async () => {
    const root = makeTmpDir('bundled-version-cleanup-')
    fs.mkdirSync(path.join(root, 'old-version'))
    fs.mkdirSync(path.join(root, 'current-version'))

    await cleanupOtherArtifactVersions(root, 'current-version')

    expect(fs.existsSync(path.join(root, 'old-version'))).toBe(false)
    expect(fs.existsSync(path.join(root, 'current-version'))).toBe(true)
  })

  it('keeps running when Windows-style file occupancy prevents old-version cleanup', async () => {
    const root = makeTmpDir('bundled-version-busy-')
    const oldVersion = path.join(root, 'old-version')
    fs.mkdirSync(oldVersion)
    fs.mkdirSync(path.join(root, 'current-version'))
    const rm = fsp.rm.bind(fsp)
    vi.spyOn(fsp, 'rm').mockImplementation(async (target, options) => {
      if (target === oldVersion) throw Object.assign(new Error('busy'), { code: 'EBUSY' })
      return rm(target, options)
    })

    await expect(cleanupOtherArtifactVersions(root, 'current-version')).resolves.toBeUndefined()
    expect(fs.existsSync(oldVersion)).toBe(true)
  })
})

describe('withBundledArtifactLock', () => {
  it('prevents a concurrent profile from recovering an active staging path', async () => {
    const directory = makeTmpDir('bundled-artifact-lock-')
    const destination = path.join(directory, 'tool')
    const stagingPath = `${destination}.tmp-${process.pid}-active`
    let releaseFirst!: () => void
    let markFirstEntered!: () => void
    const firstEntered = new Promise<void>((resolve) => {
      markFirstEntered = resolve
    })
    const firstCanFinish = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })

    const first = withBundledArtifactLock(destination, async () => {
      fs.writeFileSync(stagingPath, 'partial', 'utf8')
      markFirstEntered()
      await firstCanFinish
      expect(fs.existsSync(stagingPath)).toBe(true)
      fs.rmSync(stagingPath)
    })
    await firstEntered

    let secondEntered = false
    const second = withBundledArtifactLock(destination, async () => {
      secondEntered = true
    })
    await new Promise((resolve) => setTimeout(resolve, 20))

    expect(secondEntered).toBe(false)
    expect(fs.existsSync(stagingPath)).toBe(true)

    releaseFirst()
    await Promise.all([first, second])
    expect(secondEntered).toBe(true)
  })
})
