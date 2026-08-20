import crypto from 'node:crypto'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { zstdCompressSync } from 'node:zlib'

import type {
  BundledArtifactFile,
  BundledArtifactManifest,
  BundledFilesArtifact,
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

import { cleanupOtherArtifactVersions, ensureBundledFiles, ensureBundledTree } from '../bundledArtifact'

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
  return { schemaVersion: 2, platform: 'linux', arch: 'x64', artifacts }
}

function writeFileArtifact(payload: Buffer, output = 'tool'): BundledArtifactFile {
  const archive = `${output}.zst`
  const compressed = zstdCompressSync(payload)
  const platformDirectory = path.join(state.resourcesRoot, 'linux-x64')
  fs.mkdirSync(platformDirectory, { recursive: true })
  fs.writeFileSync(path.join(platformDirectory, archive), compressed)
  return {
    output,
    archive,
    compression: 'zstd',
    archiveSha256: sha256(compressed),
    sha256: sha256(payload),
    size: payload.length,
    mode: 0o755
  }
}

function writeRawFileArtifact(payload: Buffer, output = 'tool.exe'): BundledArtifactFile {
  const archive = output
  const platformDirectory = path.join(state.resourcesRoot, 'linux-x64')
  fs.mkdirSync(platformDirectory, { recursive: true })
  fs.writeFileSync(path.join(platformDirectory, archive), payload)
  return {
    output,
    archive,
    compression: 'none',
    archiveSha256: sha256(payload),
    sha256: sha256(payload),
    size: payload.length,
    mode: 0o755
  }
}

function filesArtifact(files: BundledArtifactFile[]): BundledFilesArtifact {
  return { kind: 'files', version: '1.2.3', files }
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
    compression: 'zstd',
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
  vi.clearAllMocks()
})

afterEach(() => {
  vi.restoreAllMocks()
  for (const directory of tmpDirs) fs.rmSync(directory, { recursive: true, force: true })
  tmpDirs.length = 0
})

describe('ensureBundledFiles', () => {
  it('installs a verified payload once and reuses the complete cache', async () => {
    const payload = Buffer.alloc(1024 * 1024, 0x5a)
    const file = writeFileArtifact(payload)
    const artifact = filesArtifact([file])
    const destinationDirectory = makeTmpDir('bundled-file-destination-')
    const archivePath = path.join(state.resourcesRoot, 'linux-x64', file.archive)
    const createReadStream = vi.mocked(fs.createReadStream)

    const installed = await ensureBundledFiles(makeManifest({ tool: artifact }), artifact, destinationDirectory)
    const ready = await ensureBundledFiles(makeManifest({ tool: artifact }), artifact, destinationDirectory)

    expect(installed.status).toBe('installed')
    expect(ready.status).toBe('ready')
    expect(fs.readFileSync(installed.paths.get('tool')!)).toEqual(payload)
    expect(createReadStream.mock.calls.filter(([candidate]) => candidate === archivePath)).toHaveLength(1)
    if (process.platform !== 'win32') expect(fs.statSync(installed.paths.get('tool')!).mode & 0o777).toBe(0o755)
  })

  it('repairs same-size tampering instead of trusting file size', async () => {
    const file = writeFileArtifact(Buffer.from('trusted'))
    const artifact = filesArtifact([file])
    const destinationDirectory = makeTmpDir('bundled-file-tampered-')
    const destination = path.join(destinationDirectory, file.output)
    fs.writeFileSync(destination, 'altered', 'utf8')
    if (process.platform !== 'win32') fs.chmodSync(destination, 0o755)

    const result = await ensureBundledFiles(makeManifest({ tool: artifact }), artifact, destinationDirectory)

    expect(result.status).toBe('installed')
    expect(fs.readFileSync(destination, 'utf8')).toBe('trusted')
  })

  it('installs a raw native payload after verifying its archive and content hashes', async () => {
    const payload = Buffer.from('raw-native-payload')
    const file = writeRawFileArtifact(payload)
    const artifact = filesArtifact([file])
    const destinationDirectory = makeTmpDir('bundled-file-raw-')

    const result = await ensureBundledFiles(makeManifest({ tool: artifact }), artifact, destinationDirectory)

    expect(result.status).toBe('installed')
    expect(fs.readFileSync(path.join(destinationDirectory, file.output))).toEqual(payload)
  })

  it('reads an archive from an explicit root and rejects traversal outside that root', async () => {
    const payload = Buffer.from('package-owned runtime')
    const archiveRoot = makeTmpDir('bundled-package-root-')
    const archive = 'runtime.tar.zst'
    const compressed = zstdCompressSync(payload)
    fs.writeFileSync(path.join(archiveRoot, archive), compressed)
    const file: BundledArtifactFile = {
      output: 'runtime.bin',
      archive,
      compression: 'zstd',
      archiveSha256: sha256(compressed),
      sha256: sha256(payload),
      size: payload.length,
      mode: 0o755
    }
    const destinationDirectory = makeTmpDir('bundled-package-destination-')

    await ensureBundledFiles(
      makeManifest({ runtime: filesArtifact([file]) }),
      filesArtifact([file]),
      destinationDirectory,
      {
        archiveRoot
      }
    )

    expect(fs.readFileSync(path.join(destinationDirectory, 'runtime.bin'))).toEqual(payload)
    const escaped = { ...file, archive: '../outside.zst' }
    const escapedDestinationDirectory = makeTmpDir('bundled-package-escaped-')
    await expect(
      ensureBundledFiles(
        makeManifest({ runtime: filesArtifact([escaped]) }),
        filesArtifact([escaped]),
        escapedDestinationDirectory,
        { archiveRoot }
      )
    ).rejects.toThrow(/escaped its source root/)
  })

  it('does not publish a raw payload whose archive hash changed', async () => {
    const payload = Buffer.from('raw-native-payload')
    const file = writeRawFileArtifact(payload)
    const artifact = filesArtifact([file])
    fs.appendFileSync(path.join(state.resourcesRoot, 'linux-x64', file.archive), 'damage')
    const destinationDirectory = makeTmpDir('bundled-file-raw-damaged-')
    const destination = path.join(destinationDirectory, file.output)
    fs.writeFileSync(destination, 'old payload', 'utf8')

    await expect(ensureBundledFiles(makeManifest({ tool: artifact }), artifact, destinationDirectory)).rejects.toThrow(
      /archive checksum mismatch/
    )

    expect(fs.readFileSync(destination, 'utf8')).toBe('old payload')
  })

  it.runIf(process.platform !== 'win32')('restores executable permission', async () => {
    const payload = Buffer.from('executable')
    const file = writeFileArtifact(payload)
    const artifact = filesArtifact([file])
    const destinationDirectory = makeTmpDir('bundled-file-permission-')
    const destination = path.join(destinationDirectory, file.output)
    fs.writeFileSync(destination, payload)
    fs.chmodSync(destination, 0o644)

    const result = await ensureBundledFiles(makeManifest({ tool: artifact }), artifact, destinationDirectory)

    expect(result.status).toBe('installed')
    expect(fs.statSync(destination).mode & 0o777).toBe(0o755)
  })

  it('does not publish an archive with an invalid raw hash', async () => {
    const file = { ...writeFileArtifact(Buffer.from('new payload')), sha256: '0'.repeat(64) }
    const artifact = filesArtifact([file])
    const destinationDirectory = makeTmpDir('bundled-file-invalid-')
    const destination = path.join(destinationDirectory, file.output)
    fs.writeFileSync(destination, 'old payload', 'utf8')

    await expect(ensureBundledFiles(makeManifest({ tool: artifact }), artifact, destinationDirectory)).rejects.toThrow(
      /payload checksum mismatch/
    )

    expect(fs.readFileSync(destination, 'utf8')).toBe('old payload')
    expect(fs.readdirSync(destinationDirectory)).toEqual(['tool'])
  })

  it('does not publish an archive whose compressed hash changed', async () => {
    const file = writeFileArtifact(Buffer.from('new payload'))
    const artifact = filesArtifact([file])
    fs.appendFileSync(path.join(state.resourcesRoot, 'linux-x64', file.archive), 'damage')
    const destinationDirectory = makeTmpDir('bundled-file-damaged-')
    const destination = path.join(destinationDirectory, file.output)
    fs.writeFileSync(destination, 'old payload', 'utf8')

    await expect(ensureBundledFiles(makeManifest({ tool: artifact }), artifact, destinationDirectory)).rejects.toThrow(
      /archive checksum mismatch/
    )

    expect(fs.readFileSync(destination, 'utf8')).toBe('old payload')
  })

  it('cleans staging when a checksum-valid archive is not valid Zstd', async () => {
    const damagedArchive = Buffer.from('not a zstd stream')
    const file = writeFileArtifact(Buffer.from('new payload'))
    const artifact = filesArtifact([file])
    const archivePath = path.join(state.resourcesRoot, 'linux-x64', file.archive)
    fs.writeFileSync(archivePath, damagedArchive)
    file.archiveSha256 = sha256(damagedArchive)
    const destinationDirectory = makeTmpDir('bundled-file-invalid-zstd-')

    await expect(ensureBundledFiles(makeManifest({ tool: artifact }), artifact, destinationDirectory)).rejects.toThrow()

    expect(fs.readdirSync(destinationDirectory)).toEqual([])
  })

  it('restores the prior file if atomic publication fails', async () => {
    const file = writeFileArtifact(Buffer.from('new payload'))
    const artifact = filesArtifact([file])
    const destinationDirectory = makeTmpDir('bundled-file-busy-')
    const destination = path.join(destinationDirectory, file.output)
    fs.writeFileSync(destination, 'old payload', 'utf8')
    const rename = fsp.rename.bind(fsp)
    vi.spyOn(fsp, 'rename').mockImplementation(async (source, target) => {
      if (String(source).includes('.tmp-') && target === destination) {
        throw Object.assign(new Error('busy'), { code: 'EBUSY' })
      }
      return rename(source, target)
    })

    await expect(ensureBundledFiles(makeManifest({ tool: artifact }), artifact, destinationDirectory)).rejects.toThrow(
      'busy'
    )

    expect(fs.readFileSync(destination, 'utf8')).toBe('old payload')
    expect(fs.readdirSync(destinationDirectory)).toEqual(['tool'])
  })

  it('rolls back when the published file fails post-install verification', async () => {
    const file = writeFileArtifact(Buffer.from('new payload'))
    const artifact = filesArtifact([file])
    const destinationDirectory = makeTmpDir('bundled-file-post-verify-')
    const destination = path.join(destinationDirectory, file.output)
    fs.writeFileSync(destination, 'old payload', 'utf8')
    const stat = fsp.stat.bind(fsp)
    let destinationChecks = 0
    vi.spyOn(fsp, 'stat').mockImplementation(async (target) => {
      const result = await stat(target)
      if (target === destination && ++destinationChecks === 2) {
        return { ...result, size: result.size + 1, isFile: () => true } as fs.Stats
      }
      return result
    })

    await expect(ensureBundledFiles(makeManifest({ tool: artifact }), artifact, destinationDirectory)).rejects.toThrow(
      /post-install verification/
    )

    expect(fs.readFileSync(destination, 'utf8')).toBe('old payload')
    expect(fs.readdirSync(destinationDirectory)).toEqual(['tool'])
  })

  it('recovers backups and removes abandoned staging paths before validation', async () => {
    const payload = Buffer.from('trusted')
    const file = writeFileArtifact(payload)
    const artifact = filesArtifact([file])
    const destinationDirectory = makeTmpDir('bundled-stale-paths-')
    const destination = path.join(destinationDirectory, file.output)
    const backup = `${destination}.old-123-dead`
    const abandonedGroupStaging = `${destinationDirectory}.tmp-123-dead`
    fs.writeFileSync(backup, payload)
    if (process.platform !== 'win32') fs.chmodSync(backup, 0o755)
    fs.writeFileSync(`${destination}.tmp-123-dead`, 'partial', 'utf8')
    fs.mkdirSync(abandonedGroupStaging)
    fs.writeFileSync(path.join(abandonedGroupStaging, 'tool'), 'partial', 'utf8')

    const result = await ensureBundledFiles(makeManifest({ tool: artifact }), artifact, destinationDirectory)

    expect(result.status).toBe('ready')
    expect(fs.readFileSync(destination)).toEqual(payload)
    expect(fs.readdirSync(destinationDirectory)).toEqual(['tool'])
    expect(fs.existsSync(abandonedGroupStaging)).toBe(false)
  })

  it('deduplicates concurrent first installs through the artifact lock', async () => {
    const file = writeFileArtifact(Buffer.from('concurrent'))
    const artifact = filesArtifact([file])
    const manifest = makeManifest({ tool: artifact })
    const destinationDirectory = makeTmpDir('bundled-concurrent-')
    const archivePath = path.join(state.resourcesRoot, 'linux-x64', file.archive)
    const createReadStream = vi.mocked(fs.createReadStream)

    const results = await Promise.all([
      ensureBundledFiles(manifest, artifact, destinationDirectory),
      ensureBundledFiles(manifest, artifact, destinationDirectory)
    ])

    expect(results.map(({ status }) => status).sort()).toEqual(['installed', 'ready'])
    expect(createReadStream.mock.calls.filter(([candidate]) => candidate === archivePath)).toHaveLength(1)
  })

  it('returns no paths when any file in an artifact fails', async () => {
    const first = writeFileArtifact(Buffer.from('first'), 'tool')
    const second = { ...writeFileArtifact(Buffer.from('second'), 'helper'), sha256: '0'.repeat(64) }
    const artifact = filesArtifact([first, second])
    const destinationDirectory = makeTmpDir('bundled-file-group-')

    await expect(ensureBundledFiles(makeManifest({ tool: artifact }), artifact, destinationDirectory)).rejects.toThrow(
      /payload checksum mismatch/
    )

    expect(fs.existsSync(path.join(destinationDirectory, first.output))).toBe(false)
    expect(fs.existsSync(path.join(destinationDirectory, second.output))).toBe(false)
  })
})

describe('ensureBundledTree', () => {
  it('repairs missing, changed, and undeclared inventory entries', async () => {
    const artifact = await writeTreeArtifact()
    const manifest = makeManifest({ mingit: artifact })
    const destination = path.join(makeTmpDir('bundled-tree-destination-'), 'current')

    expect((await ensureBundledTree(manifest, artifact, destination)).status).toBe('installed')
    fs.rmSync(path.join(destination, 'git', 'mingw64', 'bin', 'runtime.dll'))
    expect((await ensureBundledTree(manifest, artifact, destination)).status).toBe('installed')
    fs.writeFileSync(path.join(destination, 'git', 'cmd', 'git.exe'), 'evil-runtime', 'utf8')
    expect((await ensureBundledTree(manifest, artifact, destination)).status).toBe('installed')
    fs.writeFileSync(path.join(destination, 'git', 'cmd', 'injected.dll'), 'unexpected', 'utf8')
    expect((await ensureBundledTree(manifest, artifact, destination)).status).toBe('installed')

    expect(fs.readFileSync(path.join(destination, 'git', 'cmd', 'git.exe'), 'utf8')).toBe('git-runtime')
    expect(fs.existsSync(path.join(destination, 'git', 'cmd', 'injected.dll'))).toBe(false)
    expect((await ensureBundledTree(manifest, artifact, destination)).status).toBe('ready')
  })
})

describe('cleanupOtherArtifactVersions', () => {
  it('removes old versions after the current version is ready', async () => {
    const root = makeTmpDir('bundled-version-cleanup-')
    fs.mkdirSync(path.join(root, 'old-version'))
    fs.mkdirSync(path.join(root, 'current-version'))

    await cleanupOtherArtifactVersions(root, 'current-version')

    expect(fs.existsSync(path.join(root, 'old-version'))).toBe(false)
    expect(fs.existsSync(path.join(root, 'current-version'))).toBe(true)
  })

  it('does not fail when file occupancy prevents old-version cleanup', async () => {
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
